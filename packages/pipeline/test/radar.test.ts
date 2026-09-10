import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coreEarnings, type AssetInfo, type Candle, type Card, type CardInput, type CardWriter, type ClassifiedEvent, type EtfConfig, type EventClassifier, type FinnhubMetrics, type NewsItem, type QuarterStatement, type RadarPolicy, type SnapshotLite, type Statements, type SymbolProfile, type TaxonomyConfig } from "@thesis/core";
import { MemoryStore, applyTaxonomy, buildContributionPlan, measureRadar, rankRadar, refreshRadar, scanUniverse, withStatements, type RadarDeps } from "../src/index.js";

const policy: RadarPolicy = {
  weights: { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 },
  quality: { minMcapUsd: 500e6, minDollarVolumeUsd: 5e6, minPrice: 5 },
  prefilter: { minPrice: 5, minIexDollarVolume: 500_000 },
  technical: { maxReturn21dPct: 15, earningsWithinDays: 10 },
  sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 },
  candidates: { top: 5, preselect: 20, chronicWeeks: 4 },
  contribution: { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50 },
};
const taxonomy: TaxonomyConfig = { sectors: ["Tecnología", "Energía", "Otros"], themes: ["IA", "semiconductores", "petroleo_gas"], industryToSector: { Semiconductors: "Tecnología", Energy: "Energía" }, industryToThemes: { Semiconductors: ["semiconductores"] }, symbolToThemes: {}, symbolToAssetClass: {} };
const etfs: EtfConfig[] = [
  { symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 1 },
  { symbol: "XLE", name: "XLE", role: "satelite", exposure: "sector", ter: 0.09, themes: ["petroleo_gas"] },
];

/** 12 acciones en 2 industrias; S1 es "mejor en todo", S12 "peor en todo". */
const symbols = Array.from({ length: 12 }, (_, i) => `S${String.fromCharCode(65 + i)}`); // SA..SL
const idx = (s: string) => s.charCodeAt(1) - 64; // SA → 1
const industryOf = (s: string) => (idx(s) <= 6 ? "Semiconductors" : "Energy");
const metricsOf = (s: string): FinnhubMetrics => {
  const k = idx(s);
  const good = k === 1 ? 2 : k === 12 ? 0.5 : 1 + (k % 3) * 0.05;
  return { peTTM: 20 / good, evEbitdaTTM: 12 / good, psTTM: 3 / good, roeTTM: 15 * good, operatingMarginTTM: 20 * good, netProfitMarginTTM: 12 * good, revenueGrowthTTMYoy: 10 * good, revenueGrowth5Y: 8 * good, epsGrowthTTMYoy: 10 * good, "totalDebt/totalEquityAnnual": 0.5 / good, currentRatioAnnual: 1.5 * good, beta: 1, "3MonthAverageTradingVolume": 5, dividendYieldIndicatedAnnual: 1 };
};
const series = (closes: number[], start = "2025-09-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
const ramp = (from: number, to: number, n = 260) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
const TODAY = "2026-05-19"; // última vela 2026-05-18
let priceLevel = 100;

function deps(over: Partial<RadarDeps> = {}) {
  const store = new MemoryStore();
  const finnhubCalls: string[] = [];
  const assets: AssetInfo[] = [...symbols.map((s) => ({ symbol: s, name: `${s} Corp`, exchange: "NASDAQ", tradable: true })), { symbol: "BADW", name: "Bad Warrant", exchange: "NYSE", tradable: true }, { symbol: "PENNY", name: "Penny", exchange: "NYSE", tradable: true }];
  const snapshots = async (syms: string[]): Promise<SnapshotLite[]> => syms.map((s) => ({ symbol: s, price: s === "PENNY" ? 2 : 100, iexVolume: 100_000 }));
  const fundamentals = {
    profile: async (s: string): Promise<SymbolProfile | null> => { finnhubCalls.push(`profile:${s}`); return { symbol: s, name: `${s} Corp`, country: "US", industry: industryOf(s), marketCap: null, currency: "USD", shareOutstanding: 100 }; },
    metrics: async (s: string) => { finnhubCalls.push(`metrics:${s}`); return metricsOf(s); },
    peers: async (s: string) => symbols.filter((x) => x !== s && industryOf(x) === industryOf(s)),
    recommendation: async () => ({ strongBuy: 5, buy: 5, hold: 2, sell: 0, strongSell: 0, period: "2026-05" }),
    earningsSurprises: async () => [{ period: "2026-03-31", surprisePercent: 8 }],
    insiders: async () => ({ buys: 1, sells: 0 }),
    nextEarnings: async () => null,
  };
  // ^TNX (10 años) sin historia: sin régimen macro, para que el plan de estos tests no lleve reserva.
  const history = { candles: async (s: string) => (s === "^TNX" ? [] : series(s === "XLE" ? ramp(80, priceLevel * 1.25) : ramp(80, priceLevel).map((c) => (s === "SPY" ? c * 5 : c)))) };
  const cardWriter: CardWriter = { promptVersion: "card-test", write: async (i: CardInput): Promise<Card> => ({ summary: `${i.symbol} hace cosas`, whyRanks: "rankea", mainRisk: "riesgo", moat: "moderado", themes: ["IA"], degrade: i.symbol === "SB", ...(i.symbol === "SB" ? { degradeReason: "6-K: guidance recortado" } : {}) }) };
  const d: RadarDeps = { store, assets: { list: async () => assets, snapshots }, fundamentals, history, cardWriter, taxonomy, etfs, policy, filings: async () => ["8-K algo"], ...over };
  return { store, d, finnhubCalls };
}

describe("scanUniverse", () => {
  it("filtra, pre-filtra, pide fundamentals y guarda etiquetas; es reanudable sin repetir llamadas", async () => {
    const { store, d, finnhubCalls } = deps();
    let seen = 0;
    const r1 = await scanUniverse({ ...d, shouldStop: () => ++seen > 6 }, { scanDate: "2026-05-17", today: TODAY });
    expect(r1.stopped).toBe(true);
    expect(r1.listed).toBe(14);
    expect(r1.prefiltered).toBe(12); // BADW (warrant) y PENNY (precio) afuera
    const callsAfterStop = finnhubCalls.length;
    const r2 = await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    expect(r2.stopped).toBe(false);
    expect(r2.fundamentalsOk).toBe(6);
    expect(finnhubCalls.length).toBe(24); // 2 llamadas por símbolo, ninguna repetida
    expect(finnhubCalls.length).toBeGreaterThan(callsAfterStop);
    expect((await store.scanStatus("2026-05-17")).finnhub_ok).toBe(12);
    expect((await store.tags("SA"))?.sector).toBe("Tecnología");
    expect((await store.tags("SA"))?.themes).toEqual(["semiconductores"]);
    const r3 = await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    expect(finnhubCalls.length).toBe(24); // fundamentals frescos: no vuelve a pedir
    expect(r3.fundamentalsOk).toBe(0);
  });
});

describe("scanUniverse con ADRs", () => {
  it("perfil en moneda local sin volumen de Finnhub: usa el volumen de Yahoo y deja la capitalización desconocida", async () => {
    const { store, d } = deps({
      assets: { list: async () => [{ symbol: "GGAL", name: "Grupo Financiero Galicia", exchange: "NASDAQ", tradable: true }], snapshots: async (s) => s.map((x) => ({ symbol: x, price: 44.36, iexVolume: 100_000 })) },
      fundamentals: { ...deps().d.fundamentals, profile: async (s) => ({ symbol: s, name: "GGAL", country: "AR", industry: "Banking", marketCap: null, currency: "ARS", shareOutstanding: 1325 }), metrics: async () => ({ peTTM: 10 }) },
      history: { candles: async () => series(Array(99).fill(44.36)).map((c) => ({ ...c, volume: 830_000 })) },
    });
    const r = await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    expect(r.fundamentalsOk).toBe(1);
    const f = await store.fundamentals("GGAL");
    expect(f?.mcapUsd).toBeNull();
    expect(f?.dollarVolumeUsd).toBeCloseTo(830_000 * 44.36, -3);
    expect((await store.tags("GGAL"))?.assetClass).toBe("adr");
  });
});

describe("scanUniverse con listado extranjero en USD", () => {
  it("volumen de Finnhub bajo el umbral → usa el mayor entre Finnhub y Yahoo; país no US → capitalización desconocida", async () => {
    const { store, d } = deps({
      assets: { list: async () => [{ symbol: "VIST", name: "Vista Energy", exchange: "NYSE", tradable: true }], snapshots: async (s) => s.map((x) => ({ symbol: x, price: 73.73, iexVolume: 100_000 })) },
      fundamentals: { ...deps().d.fundamentals, profile: async (s) => ({ symbol: s, name: "Vista", country: "MX", industry: "Energy", marketCap: null, currency: "USD", shareOutstanding: 111 }), metrics: async () => ({ peTTM: 9, "3MonthAverageTradingVolume": 0.0165 }) },
      history: { candles: async () => series(Array(99).fill(73.73)).map((c) => ({ ...c, volume: 700_000 })) },
    });
    const r = await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    expect(r.fundamentalsOk).toBe(1);
    const f = await store.fundamentals("VIST");
    expect(f?.mcapUsd).toBeNull();
    expect(f?.dollarVolumeUsd).toBeCloseTo(700_000 * 73.73, -3);
  });
});

describe("rankRadar", () => {
  it("rankea, filtra, decide, escribe ficha (solo degrada) y guarda ETFs", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    const stocks = r.candidates.filter((c) => c.kind === "stock");
    expect(stocks).toHaveLength(5);
    expect(stocks[0]!.symbol).toBe("SA");
    expect(stocks[0]!.verdict).toBe("COMPRAR");
    expect(stocks[0]!.summary).toContain("SA");
    expect(stocks[0]!.sizeQty).toBeGreaterThan(0);
    expect(stocks[0]!.flags).toContain("insiders_compran");
    const s2 = stocks.find((c) => c.symbol === "SB")!;
    expect(s2.verdict).toBe("OBSERVAR");
    expect(s2.degradedBy).toBe("narrator");
    expect((await store.tags("SA"))?.themes).toEqual(["semiconductores", "IA"]);
    const etf = r.candidates.filter((c) => c.kind === "etf");
    expect(etf.map((c) => [c.symbol, c.verdict])).toEqual([["VTI", "NUCLEO"], ["XLE", "COMPRAR"]]);
    expect((await store.latestCandidates()).length).toBe(7);
  });
  it("cuarta semana seguida → residente crónico → OBSERVAR", async () => {
    const { d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    for (const day of ["2026-04-26", "2026-05-03", "2026-05-10"]) await rankRadar(d, { today: day, portfolioUsd: null });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: null });
    const s1 = r.candidates.find((c) => c.symbol === "SA")!;
    expect(s1.nthAppearance).toBe(4);
    expect(s1.verdict).toBe("OBSERVAR");
    expect(s1.flags).toContain("residente_cronico");
  });
});

describe("rankRadar solo con el último barrido", () => {
  it("un símbolo con fundamentals frescos pero excluido en el último barrido no rankea", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    // Segundo barrido: SA queda excluida (p. ej. por el filtro de fondos) aunque sus fundamentals sigan frescos.
    await store.scanUpsert(symbols.map((s) => ({ scanDate: "2026-05-18", symbol: s, stage: s === "SA" ? "excluded" : "finnhub_ok", reason: s === "SA" ? "fondo" : null })));
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: null });
    expect(r.candidates.some((c) => c.symbol === "SA")).toBe(false);
    expect(r.candidates.filter((c) => c.kind === "stock").length).toBeGreaterThan(0);
  });
});

describe("refreshRadar", () => {
  it("completa las fichas que faltan (cuota agotada en el ranking)", async () => {
    const { store, d } = deps({ cardWriter: null });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: null });
    expect((await store.latestCandidates()).every((c) => c.summary === null)).toBe(true);
    const withWriter = { ...d, cardWriter: deps().d.cardWriter };
    await refreshRadar(withWriter, { today: "2026-05-20", portfolioUsd: null });
    const after = await store.latestCandidates();
    expect(after.filter((c) => c.kind === "stock").every((c) => c.summary !== null)).toBe(true);
    expect(after.find((c) => c.symbol === "SB")?.verdict).toBe("OBSERVAR"); // la ficha degrada también en el refresco
  });
  it("actualiza cierre y stop, conserva score, ficha y nthAppearance", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const before = (await rankRadar(d, { today: TODAY, portfolioUsd: null })).candidates.find((c) => c.symbol === "SA")!;
    priceLevel = 104;
    const r = await refreshRadar(d, { today: "2026-05-20", portfolioUsd: null });
    priceLevel = 100;
    expect(r.refreshed).toBe(7);
    const after = (await store.latestCandidates()).find((c) => c.symbol === "SA")!;
    expect(after.candidateDate).toBe("2026-05-20");
    expect(after.close).toBeGreaterThan(before.close);
    expect(after.score).toBe(before.score);
    expect(after.summary).toBe(before.summary);
    expect(after.nthAppearance).toBe(before.nthAppearance);
  });
});

describe("plan y medición", () => {
  it("arma el plan con núcleo, SUMAR de cartera y COMPRAR del radar; mide candidatos y líneas", async () => {
    const { store, d } = deps();
    await store.upsertPosition({ symbol: "SL", quantity: 10, avgCost: 50, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.upsertPosition({ symbol: "VTI", quantity: 150, avgCost: 280, currency: "USD", market: "us", layer: "nucleo", notes: null });
    await store.saveRisk(TODAY, { totalValue: 100_000, weights: [{ symbol: "SL", value: 1000, weightPct: 1 }, { symbol: "VTI", value: 45_000, weightPct: 45 }], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] });
    await store.upsertVerdicts([{ verdictDate: TODAY, symbol: "SL", verb: "SUMAR", reason: "r", narrative: null, warning: null, close: 100, spot: null, stop: 90, target: 120, gainPct: 0, weightPct: 1, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    // Regla v2: SUMAR hasta el 30% del resto; las dos nuevas (máximo por mes) se reparten parejo lo que queda.
    // Las dos nuevas se reparten por convicción (peso 1 + convicción): SA rankea mejor que SH y se lleva más.
    expect(plan.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["SL", "sumar", 1950], ["SA", "comprar", 2935], ["SH", "comprar", 1615]]);
    expect((await store.latestPlan())?.month).toBe("2026-05");

    // medición: velas hasta 2026-05-18 → un candidato del 2026-04-01 tiene 7 y 30 días de vela posterior
    const old = (await store.latestCandidates())[0]!;
    await store.upsertCandidates([{ ...old, candidateDate: "2026-04-01", close: 90, spyClose: 450 }]);
    const m = await measureRadar(d, { today: TODAY });
    expect(m.candidates["7"]).toBe(1);
    expect(m.candidates["30"]).toBe(1);
    expect(m.candidates["90"]).toBe(0);
  });
});

describe("applyTaxonomy", () => {
  it("regla no pisa manual", async () => {
    const { store, d } = deps();
    await store.saveTags("SA", { assetClass: "accion_us", sector: "Tecnología", industry: "Semiconductors", themes: ["IA"], themesSource: "manual" });
    await store.saveFundamentals({ symbol: "SA", asOf: TODAY, metrics: {}, peers: [], industry: "Semiconductors", mcapUsd: 1e9, dollarVolumeUsd: 1e7, priceUsd: 100, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
    await applyTaxonomy(d, ["SA"]);
    expect((await store.tags("SA"))?.themes).toEqual(["IA"]);
  });
});

describe("MemoryStore: estados", () => {
  it("guarda y devuelve estados por símbolo; fundamentals conserva metricsRaw y statementsAsOf", async () => {
    const store = new MemoryStore();
    expect(await store.statements("ZVRA")).toBeNull();
    await store.saveStatements({ symbol: "zvra", cik: "1434647", asOf: "2026-09-09", quarters: [], core: null });
    expect((await store.statements("ZVRA"))?.cik).toBe("1434647");
    await store.saveFundamentals({ symbol: "ZVRA", asOf: "2026-09-09", metrics: { peTTM: 23.4 }, metricsRaw: { peTTM: 12.8 }, statementsAsOf: "2026-06-30", peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 1, priceUsd: 12.57, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
    const f = await store.fundamentals("ZVRA");
    expect(f?.metricsRaw?.["peTTM"]).toBe(12.8);
    expect(f?.statementsAsOf).toBe("2026-06-30");
  });
});

/** 4 trimestres sintéticos: operativo 60M con una ganancia por venta de 35M adentro → núcleo 25M; 1M de acciones → EPS núcleo alto → P/E ≈ 5. */
const syntheticQuarters = (): QuarterStatement[] => ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((end, i) => ({ start: end, end, fp: `Q${i + 1}`, revenue: 100e6, operatingIncome: 60e6, netIncome: 60e6, pretaxIncome: 60e6, taxExpense: 12e6, nonoperatingIncome: null, operatingCashFlow: 20e6, capex: 1e6, dilutedShares: 1e6, equity: 200e6, noncontrolling: null, receivables: null, extraordinary: [{ tag: "GainLossOnDispositionOfAssets1", value: 35e6 }] }));

describe("rankRadar con estados de la SEC", () => {
  it("segunda pasada con ganancia núcleo: bandera, metricsRaw, caché de 7 días y estados en la ficha", async () => {
    const calls: string[] = [];
    const inputs: CardInput[] = [];
    const qs = syntheticQuarters();
    const statements = { quarters: async (s: string, today: string): Promise<Statements | null> => { calls.push(s); return s === "SC" ? { symbol: s, cik: "1", asOf: today, quarters: qs, core: coreEarnings(qs) } : null; } };
    const cardWriter: CardWriter = { promptVersion: "card-test", write: async (i) => { inputs.push(i); return { summary: "x", whyRanks: "y", mainRisk: "z", moat: "moderado", themes: [], degrade: false }; } };
    const { store, d } = deps({ statements, cardWriter });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    expect(new Set(calls)).toEqual(new Set(symbols)); // pre-selección (20 > 12) más pares: todos
    const sc = r.candidates.find((c) => c.symbol === "SC")!;
    expect(sc.flags).toContain("resultado_extraordinario");
    expect(sc.flags).not.toContain("sin_estados");
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.flags).toContain("sin_estados");
    const f = (await store.fundamentals("SC"))!;
    expect(f.metricsRaw?.["peTTM"]).toBe(20);
    expect(f.metrics["peTTM"]!).toBeLessThan(10);
    expect(f.statementsAsOf).toBe("2026-06-30");
    expect((await store.fundamentals("SA"))!.statementsAsOf).toBeNull();
    const scInput = inputs.find((i) => i.symbol === "SC")!;
    expect(scInput.core?.deviationPct).toBeGreaterThan(0.25);
    expect(scInput.quarters).toHaveLength(4);
    calls.length = 0;
    await rankRadar(d, { today: "2026-05-20", portfolioUsd: 150_000 });
    expect(calls).toEqual([]); // frescos: no vuelve a pedir
  });
  it("estados guardados en el formato anterior a la enmienda de calidad (sin minoritarios) se piden de nuevo aunque estén frescos, también en el refresco", async () => {
    const calls: string[] = [];
    const qs = syntheticQuarters();
    const statements = { quarters: async (s: string, today: string): Promise<Statements | null> => { calls.push(s); return { symbol: s, cik: "1", asOf: today, quarters: qs, core: coreEarnings(qs) }; } };
    const { store, d } = deps({ statements });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const old = qs.map(({ noncontrolling: _n, receivables: _r, ...q }) => q) as unknown as QuarterStatement[];
    for (const s of symbols) await store.saveStatements({ symbol: s, cik: "1", asOf: TODAY, quarters: old, core: null });
    await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    expect(new Set(calls)).toEqual(new Set(symbols));
    // Ya guardados con el formato nuevo: el refresco no vuelve a pedir.
    calls.length = 0;
    await refreshRadar(d, { today: "2026-05-20", portfolioUsd: 150_000 });
    expect(calls).toEqual([]);
    // Formato viejo otra vez: el refresco también repide.
    for (const s of symbols) await store.saveStatements({ symbol: s, cik: "1", asOf: "2026-05-20", quarters: old, core: null });
    await refreshRadar(d, { today: "2026-05-21", portfolioUsd: 150_000 });
    expect(calls.length).toBeGreaterThan(0);
  });
});

describe("MemoryStore: eventos, analistas y barridos", () => {
  it("dedupe por url, filtro por fecha, fecha del último barrido, y la fila del candidato conserva events/analystTargets", async () => {
    const store = new MemoryStore();
    const ev = { symbol: "zvra", date: "2026-07-24", kind: "regulatorio" as const, severity: "grave" as const, headline: "EMA", url: "https://n/1", source: "Benzinga", why: "x", detectedAt: "2026-09-09T00:00:00Z", promptVersion: "e1" };
    expect(await store.upsertEvents([ev, { ...ev, headline: "otra vez" }])).toBe(1);
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.headline)).toEqual(["EMA"]);
    expect(await store.eventsFor("ZVRA", "2026-08-01")).toEqual([]);
    const act = { symbol: "ZVRA", date: "2026-07-27", firm: "BTIG", action: "mantiene" as const, rating: "Buy", target: 24, url: "https://n/2" };
    expect(await store.upsertAnalystActions([act, act])).toBe(1);
    expect(await store.analystActions("zvra", "2026-06-11")).toEqual([act]);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    await store.setNewsScannedTo("zvra", "2026-09-09");
    expect(await store.newsScannedTo("ZVRA")).toBe("2026-09-09");
    const row = { candidateDate: "2026-09-09", symbol: "ZVRA", kind: "stock" as const, verdict: "OBSERVAR" as const, score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 5, close: 12.57, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: ["evento_grave"], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, events: [{ date: "2026-07-24", kind: "regulatorio" as const, severity: "grave" as const, headline: "EMA" }], analystTargets: { n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" } };
    await store.upsertCandidates([row]);
    const back = (await store.latestCandidates())[0]!;
    expect(back.events).toEqual(row.events);
    expect(back.analystTargets?.median).toBe(24);
  });
});

describe("rankRadar y refreshRadar con noticias", () => {
  const T = "2026-09-09";
  const fixture = (JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[]).map((n) => ({ ...n, symbol: "SA" }));
  const classifier: EventClassifier = { promptVersion: "e-test", classify: async (i): Promise<ClassifiedEvent[]> => i.items.map((x) => ({ date: x.date, kind: x.kind, severity: /Negative Opinion From EMA CHMP/.test(x.headline) ? "grave" : "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" })) };
  it("SA con rechazo regulatorio → OBSERVAR por evento_grave, con eventos y objetivos en la fila y en la ficha; el refresco lo mantiene", async () => {
    const inputs: CardInput[] = [];
    const cardWriter: CardWriter = { promptVersion: "card-test", write: async (i) => { inputs.push(i); return { summary: "x", whyRanks: "y", mainRisk: "z", moat: "moderado", themes: [], degrade: false }; } };
    const news = { companyNews: async (s: string) => (s === "SA" ? fixture : []) };
    const { store, d } = deps({ news, eventClassifier: classifier, cardWriter });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    const r = await rankRadar(d, { today: T, portfolioUsd: 150_000 });
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("OBSERVAR");
    expect(sa.flags).toContain("evento_grave");
    expect(sa.events).toHaveLength(1);
    expect(sa.events![0]).toMatchObject({ date: "2026-07-24", severity: "grave" });
    expect(sa.analystTargets?.median).toBe(24);
    expect(inputs.find((i) => i.symbol === "SA")!.events).toHaveLength(1);
    const sb = r.candidates.find((c) => c.symbol === "SB")!;
    expect(sb.events).toEqual([]);
    expect(sb.flags).not.toContain("evento_grave");
    const rf = await refreshRadar(d, { today: "2026-09-10", portfolioUsd: 150_000 });
    expect(rf.errors).toEqual([]);
    const after = (await store.latestCandidates()).find((c) => c.symbol === "SA")!;
    expect(after.verdict).toBe("OBSERVAR");
    expect(after.events).toHaveLength(1);
  });
  it("clasificador caído → eventos_sin_clasificar y sigue COMPRAR", async () => {
    const failing: EventClassifier = { promptVersion: "e", classify: async () => { throw new Error("cuota"); } };
    const { d } = deps({ news: { companyNews: async (s: string) => (s === "SA" ? fixture : []) }, eventClassifier: failing });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    const sa = (await rankRadar(d, { today: T, portfolioUsd: 150_000 })).candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("COMPRAR");
    expect(sa.flags).toContain("eventos_sin_clasificar");
  });
  it("una falla del store en un símbolo durante el refresco no aborta a los demás", async () => {
    const news = { companyNews: async (s: string) => (s === "SA" ? fixture : []) };
    const { store, d } = deps({ news, eventClassifier: classifier });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    const ranked = await rankRadar(d, { today: T, portfolioUsd: 150_000 });
    // SB revienta al pedir su fecha de barrido; los demás símbolos (incluida SA, con su evento) no deberían perderse.
    const failingStore = new Proxy(store, {
      get(target, prop, receiver) {
        if (prop === "newsScannedTo") return async (s: string) => { if (s === "SB") throw new Error("db"); return target.newsScannedTo(s); };
        return Reflect.get(target, prop, receiver);
      },
    }) as typeof store;
    const rf = await refreshRadar({ ...d, store: failingStore }, { today: "2026-09-10", portfolioUsd: 150_000 });
    expect(rf.errors).toEqual([{ symbol: "SB", error: expect.stringContaining("db") }]);
    expect(rf.refreshed).toBe(ranked.candidates.length); // el error no baja la fila: se cuentan todos los stock+etf
    const after = await store.latestCandidates();
    const sb = after.find((c) => c.symbol === "SB");
    expect(sb).toBeDefined(); // SB sigue en pie pese a la falla: la corrida no lo pierde
    expect(sb!.candidateDate).toBe("2026-09-10");
    expect(sb!.flags).toContain("eventos_sin_clasificar");
    const sa = after.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("OBSERVAR");
    expect(sa.events).toHaveLength(1);
  });
  it("velas vacías para un símbolo durante el refresco no abortan a los demás", async () => {
    const news = { companyNews: async (s: string) => (s === "SA" ? fixture : []) };
    const { store, d } = deps({ news, eventClassifier: classifier });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    await rankRadar(d, { today: T, portfolioUsd: 150_000 });
    // SB no trae velas (proveedor sin datos para ese símbolo); los demás (incluida SA) no deberían perderse.
    const history = { candles: async (s: string, days: number) => (s === "SB" ? [] : d.history.candles(s, days)) };
    const rf = await refreshRadar({ ...d, history }, { today: "2026-09-10", portfolioUsd: 150_000 });
    expect(rf.errors).toEqual([]); // no revienta: la vela vacía se salta, no llega a leer c[c.length - 1]
    const after = await store.latestCandidates();
    expect(after.find((c) => c.symbol === "SB")).toBeUndefined(); // sin velas: se omite esa fila (queda con la fecha vieja)
    const sa = after.find((c) => c.symbol === "SA")!;
    expect(sa).toBeDefined();
  });
});
