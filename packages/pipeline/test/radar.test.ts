import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { clasificarHecho, computeTrailingStop, coreEarnings, entryStop, verificationOrder, type AssetInfo, type Candle, type Card, type CardInput, type CardWriter, type ClassifiedEvent, type EtfConfig, type EventClassifier, type FinnhubMetrics, type NewsItem, type QuarterStatement, type RadarPolicy, type SnapshotLite, type Statements, type SymbolProfile, type TaxonomyConfig } from "@thesis/core";
import { MemoryStore, applyTaxonomy, buildContributionPlan, explorarMercado, measureRadar, rankRadar, refreshRadar, replan, reviewPending, scanUniverse, withStatements, type RadarDeps } from "../src/index.js";

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
  const d: RadarDeps = { store, assets: { list: async () => assets, snapshots }, fundamentals, history, cardWriter, taxonomy, etfs, policy, filings: async () => ["8-K algo"], filingsDeOferta: async () => [], ...over };
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
    // 16/9: además de las `top` (5) por puntaje entran TODAS las COMPRAR de la preselección, que antes se caían del
    // corte. En este fixture eso son 10 filas, y las 5 que se agregan son todas COMPRAR.
    expect(stocks).toHaveLength(10);
    expect(stocks.slice(5).every((c) => c.verdict === "COMPRAR")).toBe(true);
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
    expect((await store.latestCandidates()).length).toBe(12);
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

describe("stop de cada fila (13/9)", () => {
  // TSM estaba en cartera y en el Radar: una posición tiene un solo stop, el que muestra Cartera. Lo que no
  // tenés es una compra nueva y su stop lleva el aire de `entryStop`.
  it("lo que ya tenés usa el de seguimiento; lo demás, el de compra nueva, en el ranking y en el refresco", async () => {
    const { store, d } = deps();
    await store.upsertPosition({ symbol: "SA", quantity: 10, avgCost: 50, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const velas = series(ramp(80, 100));
    for (const run of [() => rankRadar(d, { today: TODAY, portfolioUsd: null }), () => refreshRadar(d, { today: "2026-05-20", portfolioUsd: null })]) {
      await run();
      const rows = await store.latestCandidates();
      const sa = rows.find((c) => c.symbol === "SA" && c.verdict === "COMPRAR");
      const otra = rows.find((c) => c.kind === "stock" && c.symbol !== "SA" && c.verdict === "COMPRAR");
      if (!sa || !otra) expect.fail(`el fixture no dejó a SA y a otra en COMPRAR: ${rows.map((r) => `${r.symbol}:${r.verdict}`).join(" ")}`);
      expect(sa.stop).toBe(computeTrailingStop(velas));
      expect(otra.stop).toBe(entryStop(velas, otra.entryLow!));
      expect(otra.stop).not.toBe(sa.stop);
    }
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
    // 12 y no 7 desde el 16/9: el Radar guarda las `top` por puntaje MÁS las COMPRAR que quedaban fuera del corte.
    expect(r.refreshed).toBe(12);
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
    await store.saveRisk(TODAY, { totalValue: 100_000, weights: [{ symbol: "SL", value: 1000, weightPct: 1 }, { symbol: "VTI", value: 45_000, weightPct: 45 }], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, risk: { portfolioVolPct: null, spyVolPct: null, r2VsSpy: null, worstDayPct: null, sessions: 0 }, liquidity: [], notes: [] });
    await store.upsertVerdicts([{ verdictDate: TODAY, symbol: "SL", verb: "SUMAR", reason: "r", narrative: null, warning: null, close: 100, spot: null, stop: 90, target: 120, gainPct: 0, weightPct: 1, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    // Las velas sintéticas son la misma rampa para todos: correlación 1 con SL, que es tuya, y la regla de
    // diversificación (14/9) sacaría a todas las candidatas. Acá SL se mueve distinto, como en la vida real.
    const fechas = (await store.candles("SA", "2000-01-01")).map((c) => c.date);
    await store.upsertCandles("SL", fechas.map((date, i) => { const c = 50 + (i % 2 ? 1.5 : -1.5); return { date, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }; }));
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    // VTI también es tuya y se mueve igual que las candidatas, pero es el núcleo: parecerse al mercado no es duplicar una apuesta.
    expect(plan.leftOut?.some((x) => /como VTI/.test(x.reason))).toBe(false);
    // Regla v2: SUMAR hasta el 30% del resto; las dos nuevas (máximo por mes) se reparten parejo lo que queda.
    // Las dos nuevas se reparten por convicción (peso 1 + convicción): SA rankea mejor que SH y se lleva más.
    // Hasta el 14/9 las dos pagaban una penalidad por "moverse como VTI" (el núcleo) y el reparto era 2935/1615.
    expect(plan.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["SL", "sumar", 1950], ["SA", "comprar", 2862], ["SH", "comprar", 1688]]);
    // De qué rueda es cada precio (15/9: "candidatos del 15/9" con cierres del 14/9 y nada lo decía).
    for (const l of plan.lines) {
      const vela = (await store.candles(l.symbol, "2000-01-01")).filter((c) => c.close === l.close).at(-1);
      // SL lleva el cierre sintético de su veredicto (100), que no es de ninguna vela: sin fecha, en vez de inventarla.
      expect(l.closeDate ?? null, l.symbol).toBe(vela?.date ?? null);
    }
    expect(plan.lines.find((l) => l.symbol === "SA")?.closeDate).toBe("2026-05-18");
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

describe("plan: el ATR y la correlación de cada compra llegan al plan (14/9)", () => {
  it("con las velas de SL iguales a las de las candidatas (correlación 1), ninguna entra por no diversificar; el SUMAR lleva su precio mínimo", async () => {
    const { store, d } = deps();
    await store.upsertPosition({ symbol: "SL", quantity: 10, avgCost: 50, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.saveRisk(TODAY, { totalValue: 100_000, weights: [{ symbol: "SL", value: 1000, weightPct: 1 }], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, risk: { portfolioVolPct: null, spyVolPct: null, r2VsSpy: null, worstDayPct: null, sessions: 0 }, liquidity: [], notes: [] });
    await store.upsertVerdicts([{ verdictDate: TODAY, symbol: "SL", verb: "SUMAR", reason: "r", narrative: null, warning: null, close: 100, spot: null, stop: 90, target: 120, gainPct: 0, weightPct: 1, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    const compras = (await store.latestCandidates()).filter((c) => c.kind === "stock" && c.verdict === "COMPRAR").map((c) => c.symbol);
    if (!compras.length) expect.fail("el fixture necesita COMPRAR");
    // Ninguna entra, que es lo que se está probando. El motivo no es el mismo para todas: el bucle de compra tiene
    // un orden fijo y una convicción negativa frena antes de llegar a medir la correlación (16/9, con el corte
    // nuevo entran más COMPRAR al plan y aparece ese caso). Lo que tiene que seguir pasando es que la regla de
    // correlación sea la que saca a las que sí llegan hasta ahí.
    for (const s of compras) {
      expect(plan.lines.some((l) => l.symbol === s && l.kind !== "sumar")).toBe(false);
      expect(plan.leftOut!.find((x) => x.symbol === s)).toBeDefined();
    }
    expect(compras.some((s) => /se mueve como SL que ya tenés .*no diversifica/.test(plan.leftOut!.find((x) => x.symbol === s)?.reason ?? ""))).toBe(true);
    const sumar = plan.lines.find((l) => l.symbol === "SL" && l.kind === "sumar");
    if (!sumar) expect.fail(`SL no quedó como SUMAR: ${plan.lines.map((l) => `${l.symbol}:${l.kind}`).join(" ")}`);
    expect(sumar.minPrice).not.toBeNull();
    expect(sumar.minPrice!).toBeGreaterThan(sumar.stop!);
  });
});

describe("plan: el ruido se mide contra el piso de la franja (15/9)", () => {
  it("PAM: esperando un retroceso con el piso pegado al stop, no entra aunque el cierre esté lejos", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const antes = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    const compra = antes.lines.find((l) => l.kind === "comprar");
    if (!compra) expect.fail(`el fixture necesita una compra: ${antes.lines.map((l) => `${l.symbol}:${l.kind}`).join(" ")}`);
    const fila = (await store.latestCandidates()).find((c) => c.symbol === compra.symbol)!;
    await store.upsertCandidates([{ ...fila, entryLow: fila.stop! + 0.01 }]);
    const despues = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    expect(despues.lines.some((l) => l.symbol === compra.symbol)).toBe(false);
    expect(despues.leftOut!.find((x) => x.symbol === compra.symbol)?.reason).toMatch(/el piso de la franja .* está a 0,0 ATR del stop/);
  });
});

describe("verificación: no se gasta en lo que una regla fija igual deja afuera (15/9)", () => {
  it("SNDK (+100% en 12 meses) no se verifica en la corrida: el plan no la compra con o sin verificación", async () => {
    // La cuota gratuita es de 20 búsquedas por día y la corrida de la mañana las repartía por convicción: SNDK y los
    // bancos sin estados se llevaban las primeras.
    priceLevel = 200;
    try {
      const { store, d } = deps();
      const llamadas: string[] = [];
      const verifier = { promptVersion: "v-test", verify: async ({ symbol }: { symbol: string }) => { llamadas.push(symbol); return { verdict: "apto" as const, reason: "ok", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "DICTAMEN: APTO — ok", model: "m" }; } };
      await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
      await rankRadar({ ...d, verifier }, { today: TODAY, portfolioUsd: 100_000 });
      const bloqueadas = (await store.latestCandidates()).filter((c) => c.flags.includes("subio_mucho_12m"));
      if (!bloqueadas.length) expect.fail("el fixture necesita filas que subieron más de 100%");
      for (const b of bloqueadas) expect(llamadas, b.symbol).not.toContain(b.symbol);
    } finally {
      priceLevel = 100;
    }
  });
});

describe("refresco: la verificación de la fila es la última guardada (15/9)", () => {
  it("BLBD: verificada 'con reservas' y después OBSERVAR; la fila no puede seguir diciendo 'pendiente'", async () => {
    // El refresco usaba la verificación de la fila anterior cuando la acción quedaba en OBSERVAR: la ficha (que lee la
    // tabla de verificaciones) decía "con reservas" y la fila del Radar "verificación pendiente".
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const fila = (await store.latestCandidates()).find((c) => c.kind === "stock" && c.verdict === "COMPRAR");
    if (!fila) expect.fail("el fixture necesita un COMPRAR");
    const verifier = { promptVersion: "v-test", verify: async () => { throw new Error("no hace falta verificar de nuevo"); } };
    await store.saveVerification({ symbol: fila.symbol, date: TODAY, verdict: "con_reservas", reason: "valuación alta", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "DICTAMEN: CON RESERVAS — valuación alta", promptVersion: "v-test", model: "m", detectedAt: `${TODAY}T20:24:35.036Z` });
    // Reporta en 3 días: el refresco la deja en OBSERVAR, el caso en que no se volvía a leer la verificación.
    const f = (await store.fundamentals(fila.symbol))!;
    await store.saveFundamentals({ ...f, nextEarnings: "2026-05-22" });
    await refreshRadar({ ...d, verifier }, { today: TODAY, portfolioUsd: 100_000, only: [fila.symbol] });
    const despues = (await store.latestCandidates()).find((c) => c.symbol === fila.symbol)!;
    expect(despues.verdict).toBe("OBSERVAR");
    expect(despues.verification).toMatchObject({ verdict: "con_reservas", reason: "valuación alta" });
    expect(despues.flags).toContain("verificacion_reservas");
    expect(despues.flags).not.toContain("verificacion_pendiente");
  });
});

describe("plan: por qué cambió (15/9)", () => {
  it("NVDA el 15/9: si el Radar pasa una compra a OBSERVAR, el plan rearmado dice que salió y por qué; el primero no tiene cambios", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const primero = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    expect(primero.changes).toEqual([]);
    const compra = primero.lines.find((l) => l.kind === "comprar");
    if (!compra) expect.fail(`el fixture necesita una compra: ${primero.lines.map((l) => `${l.symbol}:${l.kind}`).join(" ")}`);
    expect(primero.inputs?.[compra.symbol]).toMatchObject({ verdict: "COMPRAR" });
    const fila = (await store.latestCandidates()).find((c) => c.symbol === compra.symbol)!;
    await store.upsertCandidates([{ ...fila, verdict: "OBSERVAR", flags: [...fila.flags, "bajo_stop"] }]);
    const segundo = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    const cambio = segundo.changes?.find((c) => c.symbol === compra.symbol);
    expect(cambio).toMatchObject({ change: "sale", source: "mercado" });
    expect(cambio!.cause).toMatch(/de COMPRAR a OBSERVAR/);
    // Dice contra qué versión se comparó.
    expect(segundo.previousBuiltAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await store.latestPlan())?.changes?.some((c) => c.symbol === compra.symbol)).toBe(true);
  });
});

describe("plan: revisión antes de comprar (15/9)", () => {
  it("18/9: lo que el plan compra sin revisar entra con el aviso y queda anotado; cuando se revisa, sin objeciones pierde el aviso, con objeción sale, y el cambio dice por qué", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const revisados: string[] = [];
    const reviewer = {
      promptVersion: "r-test",
      review: async (i: { symbol: string }) => {
        revisados.push(i.symbol);
        return i.symbol === "SA"
          ? { verdict: "objecion" as const, reason: "vence su licencia en abril", sources: [{ title: "x", url: "https://x" }], researchText: "REVISIÓN: OBJECIÓN — vence su licencia en abril", model: "m" }
          : { verdict: "sin_objeciones" as const, reason: "nada material", sources: [], researchText: "REVISIÓN: SIN OBJECIONES — nada material", model: "m" };
      },
    };
    const conRevisor = { ...d, reviewer };
    const antes = await buildContributionPlan(conRevisor, { month: "2026-05", portfolioUsd: 100_000, today: TODAY });
    expect(antes.reviewsPending?.length).toBeGreaterThan(0);
    // Hasta el 17/9 acá no entraba ninguna: la revisión nunca corrió (cero filas en la base real) y el plan compró solo
    // núcleo cuatro días. Ahora entran, cada una con su aviso, y son exactamente las que quedan anotadas para revisar.
    const sinRevisar = antes.lines.filter((l) => l.kind === "comprar" || l.kind === "seguimiento" || l.kind === "sumar").filter((l) => l.avisos?.includes("revisión antes de comprar pendiente")).map((l) => l.symbol);
    expect(sinRevisar.sort()).toEqual([...antes.reviewsPending!].sort());
    // `reviewPending` revisa de a 6 por corrida (tope por defecto, para no quemar cuota de Gemini). Con el corte
    // nuevo entran más COMPRAR al plan, así que la lista de pendientes puede pasar de 6 y hay que pedirlas por
    // tanda: el test pide el total explícito para revisarlas todas de una.
    const r = await reviewPending(conRevisor, { today: TODAY, budget: antes.reviewsPending!.length });
    expect(r.reviewed.sort()).toEqual([...antes.reviewsPending!].sort());
    expect(revisados.sort()).toEqual([...antes.reviewsPending!].sort());
    const despues = await buildContributionPlan(conRevisor, { month: "2026-05", portfolioUsd: 100_000, today: TODAY });
    if (antes.reviewsPending!.includes("SA")) {
      expect(despues.lines.some((l) => l.symbol === "SA")).toBe(false);
      expect(despues.leftOut!.find((x) => x.symbol === "SA")?.reason).toMatch(/objeción: vence su licencia en abril/);
    }
    const entro = despues.lines.find((l) => l.kind === "comprar");
    if (!entro) expect.fail(`nada quedó después de revisar: ${JSON.stringify(despues.leftOut)}`);
    // Revisada y sin objeciones: la línea sigue y ya no lleva el aviso.
    expect(entro.avisos ?? []).not.toContain("revisión antes de comprar pendiente");
    // Lo único que puede quedar sin revisar es lo que entró recién ahora (el lugar que dejó la de la objeción): también
    // con su aviso, y anotado para la próxima vuelta.
    for (const sym of despues.reviewsPending ?? []) {
      expect(antes.reviewsPending).not.toContain(sym);
      expect(despues.lines.find((l) => l.symbol === sym)?.avisos).toContain("revisión antes de comprar pendiente");
    }
    // La que salió por la objeción queda explicada en "por qué cambió".
    if (antes.reviewsPending!.includes("SA")) expect(despues.changes?.find((c) => c.symbol === "SA")?.cause).toMatch(/revisión antes de comprar/);
    // Si la búsqueda falla, no revienta ni inventa una revisión: queda el error y sigue pendiente.
    const caido = { ...d, reviewer: { promptVersion: "r-test-2", review: async () => { throw new Error("gemini: 429"); } } };
    const pendientesCaido = (await buildContributionPlan(caido, { month: "2026-05", portfolioUsd: 100_000, today: TODAY })).reviewsPending!;
    const fallo = await reviewPending(caido, { today: TODAY, budget: pendientesCaido.length });
    expect(fallo.reviewed).toEqual([]);
    expect(fallo.errors.map((e) => e.symbol).sort()).toEqual([...pendientesCaido].sort());
    expect(fallo.errors[0]!.error).toMatch(/429/);
    // Sin revisor, no se exige (y nada queda pendiente).
    const sinRevisor = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000, today: TODAY });
    expect(sinRevisor.reviewsPending ?? []).toEqual([]);
  });
});

describe("refresco parcial (15/9): solo los símbolos recién verificados", () => {
  it("con la corrida del día hecha, refresca solo esos y el resto sigue en el Radar", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const antes = await store.latestCandidates();
    const uno = antes.find((c) => c.kind === "stock")!.symbol;
    const r = await refreshRadar(d, { today: TODAY, portfolioUsd: 100_000, only: [uno] });
    expect(r.refreshed).toBe(1);
    expect((await store.latestCandidates()).map((c) => c.symbol).sort()).toEqual(antes.map((c) => c.symbol).sort());
  });
  it("si la última corrida no es de hoy, no toca nada: una fila con fecha nueva dejaría sola a esa en el Radar", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const antes = await store.latestCandidates();
    const r = await refreshRadar(d, { today: "2026-05-20", portfolioUsd: 100_000, only: [antes[0]!.symbol] });
    expect(r.refreshed).toBe(0);
    expect((await store.latestCandidates()).length).toBe(antes.length);
    expect((await store.latestCandidates()).every((c) => c.candidateDate === TODAY)).toBe(true);
  });
});

describe("universo del ranking (15/9)", () => {
  /*
   * El 15/9 un ranking a mitad de semana tomó 37 empresas en vez de 2.724. Las fundamentales eran del barrido del 7/9
   * (el del 13/9 no las volvió a pedir porque tenían 6 días) y el ranking exigía 7 días contados desde HOY. El Radar
   * pasó de 38 acciones a 5, y el plan quedó todo en núcleo.
   */
  it("a mitad de semana, las fundamentales del último barrido siguen siendo el universo (la frescura se cuenta desde el barrido)", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-10", today: "2026-05-10" });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 }); // 9 días después del barrido
    expect(r.candidates.filter((c) => c.kind === "stock").length).toBeGreaterThan(2);
    expect((await store.latestCandidates()).some((c) => c.kind === "stock")).toBe(true);
  });
  it("si el universo rankeable cae a menos de la mitad del barrido, el ranking no pisa el Radar y lo dice", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const antes = (await store.latestCandidates()).filter((c) => c.kind === "stock").map((c) => c.symbol).sort();
    // Las fundamentales de casi todo el universo quedan viejas: el barrido dijo que estaban bien, pero no hay datos frescos.
    for (const s of symbols.slice(2)) {
      const f = (await store.fundamentals(s))!;
      await store.saveFundamentals({ ...f, asOf: "2026-04-01" });
    }
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    expect(r.candidates).toEqual([]);
    expect(r.errors[0]?.error).toMatch(/universo rankeable: 2 de 12/);
    expect((await store.latestCandidates()).filter((c) => c.kind === "stock").map((c) => c.symbol).sort()).toEqual(antes);
  });
});

describe("plan: la línea SUMAR de algo que el Radar también tiene", () => {
  it("TSM del 13/9: stop y objetivo salen de la misma fila del Radar, no el stop de un lado y el objetivo del otro", async () => {
    const { store, d } = deps();
    await store.upsertPosition({ symbol: "SA", quantity: 10, avgCost: 50, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.saveRisk(TODAY, { totalValue: 100_000, weights: [{ symbol: "SA", value: 1000, weightPct: 1 }], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, risk: { portfolioVolPct: null, spyVolPct: null, r2VsSpy: null, worstDayPct: null, sessions: 0 }, liquidity: [], notes: [] });
    // Cartera calculó su objetivo aparte (472,46 en el caso real); el Radar tiene otro.
    await store.upsertVerdicts([{ verdictDate: TODAY, symbol: "SA", verb: "SUMAR", reason: "r", narrative: null, warning: null, close: 100, spot: null, stop: 95.05, target: 111.11, gainPct: 0, weightPct: 1, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const radar = (await store.latestCandidates()).find((c) => c.symbol === "SA")!;
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000 });
    const linea = plan.lines.find((l) => l.symbol === "SA" && l.kind === "sumar");
    if (!linea) expect.fail(`SA no quedó como SUMAR: ${plan.lines.map((l) => `${l.symbol}:${l.kind}`).join(" ")}`);
    expect(radar.target).not.toBe(111.11);
    expect(linea.stop).toBe(radar.stop);
    expect(linea.target).toBe(radar.target);
  });
});

describe("refresco: el presupuesto de verificación va primero a lo de más convicción (13/9)", () => {
  it("con una sola verificación por corrida, la usa la COMPRAR de más convicción, no la de más score ni la primera guardada", async () => {
    // El 13/9 las 8 búsquedas se gastaron por score y TSM (2ª por convicción, 10ª por score) quedó sin verificar.
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: null });
    const compras = verificationOrder(await store.latestCandidates(), await store.allTags()).filter((c) => c.kind === "stock" && c.verdict === "COMPRAR");
    if (compras.length < 2) expect.fail("el fixture necesita dos COMPRAR");
    const llamadas: string[] = [];
    const verifier = { promptVersion: "v-test", verify: async (i: { symbol: string }) => { llamadas.push(i.symbol); return { verdict: "apto" as const, reason: "ok", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [{ title: "x", url: "https://x" }], researchText: "DICTAMEN: APTO", model: "m" }; } };
    await refreshRadar({ ...d, verifier, policy: { ...policy, candidates: { ...policy.candidates, verifyPerRun: 1 } } }, { today: "2026-05-20", portfolioUsd: null });
    expect(llamadas).toEqual([compras[0]!.symbol]);
  });
});

describe("replan: el plan se rearma solo con el último monto (14/9)", () => {
  it("después de una corrida, el plan es de hoy y conserva los 40.000 que pidió el dueño", async () => {
    // El plan es la única fuente de COMPRAR en todas las pantallas: si queda atrás del Radar, una pantalla dice COMPRAR
    // con la selección de ayer (ORRF y HSBC entraron al Radar el 13/9 a la noche y el plan era de las 16:37).
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 100_000, amountUsd: 40_000 });
    const antes = await store.latestPlan();
    const p = await replan(d, { today: "2026-05-20", portfolioUsd: 100_000 });
    expect(p?.totalUsd).toBe(40_000);
    expect((await store.latestPlan())?.totalUsd).toBe(40_000);
    expect(antes).not.toBeNull();
  });
  it("sin plan previo no inventa uno", async () => {
    const { d } = deps();
    expect(await replan(d, { today: "2026-05-20", portfolioUsd: null })).toBeNull();
  });
});

describe("plan: calendario de la Fed (13/9)", () => {
  it("con config/fomc.json cargado, el plan del 13/9 dice que el primer tramo va desde el 17/9", async () => {
    const { d } = deps();
    const plan = await buildContributionPlan({ ...d, fomc: ["2026-09-16"] }, { month: "2026-09", portfolioUsd: 100_000, amountUsd: 40_000, today: "2026-09-13" });
    expect(plan.notes.join(" ")).toMatch(/La Fed decide el 16\/9/);
    const sin = await buildContributionPlan(d, { month: "2026-09", portfolioUsd: 100_000, amountUsd: 40_000, today: "2026-09-13" });
    expect(sin.notes.join(" ")).not.toMatch(/La Fed/);
  });
});

describe("plan: verificación con el cuestionario vigente (13/9)", () => {
  it("18/9: una acción verificada con el cuestionario anterior entra con el aviso y queda anotada para verificarse; una con el vigente entra limpia", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await rankRadar(d, { today: TODAY, portfolioUsd: 100_000 });
    const compras = (await store.latestCandidates()).filter((r) => r.kind === "stock" && r.verdict === "COMPRAR");
    if (compras.length < 2) expect.fail("el fixture necesita dos COMPRAR");
    await store.upsertCandidates(compras.map((r, i) => ({ ...r, verification: { date: TODAY, verdict: "apto" as const, reason: "ok", consensusTarget: null, promptVersion: i === 0 ? "v1-viejo" : "v2-nuevo" } })));
    // Solo se usa su versión: el plan no verifica nada, decide con lo guardado.
    const verifier = { promptVersion: "v2-nuevo", verify: async () => { throw new Error("el plan no verifica"); } };
    const plan = await buildContributionPlan({ ...d, verifier }, { month: "2026-05", portfolioUsd: 100_000 });
    // Hasta el 17/9 la del cuestionario anterior quedaba afuera. El 18/9 cambió el estructurador y TODAS las vigentes
    // pasaban a "anterior" de un día para el otro: con la regla vieja el plan volvía a comprar solo núcleo.
    const vieja = plan.lines.find((l) => l.symbol === compras[0]!.symbol);
    const nueva = plan.lines.find((l) => l.symbol === compras[1]!.symbol);
    if (vieja) {
      expect(vieja.avisos).toContain("verificación hecha con el cuestionario anterior");
      expect(plan.verificationsPending).toContain(compras[0]!.symbol);
    } else expect(plan.leftOut?.find((x) => x.symbol === compras[0]!.symbol)?.reason).not.toMatch(/cuestionario anterior/);
    if (nueva) expect(nueva.avisos ?? []).not.toContain("verificación hecha con el cuestionario anterior");
    expect(vieja ?? nueva).toBeDefined();
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

/**
 * `/mercado` (16/9): el mismo embudo de la app sobre TODO el universo, no sobre las 40 que muestra el Radar, y de solo
 * lectura: no pisa el Radar ni el plan, así se puede correr con el mercado abierto. Las reglas son las mismas funciones
 * del núcleo (puntaje contra pares, filtro técnico, niveles): una sola vara, o serían dos apps diciendo cosas distintas.
 */
describe("explorarMercado", () => {
  it("recorre el universo entero con las reglas de la app, dice por qué cae cada una y no toca el Radar", async () => {
    const { store, d } = deps();
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const m = await explorarMercado(d, { today: TODAY, portfolioUsd: 100_000, preselect: 12, top: 4 });
    expect(m.universo.conFundamentales).toBe(12);
    expect(m.filas.length).toBeGreaterThan(0);
    expect(m.filas.length).toBeLessThanOrEqual(4);
    // Ordenadas por puntaje contra pares, con sus niveles y sin inventar nada.
    expect(m.filas.map((f) => f.score)).toEqual([...m.filas.map((f) => f.score)].sort((a, b) => (b ?? -Infinity) - (a ?? -Infinity)));
    const primera = m.filas[0]!;
    expect(primera.verdict).toMatch(/COMPRAR|OBSERVAR/);
    expect(primera.stop).toBeLessThan(primera.close!);
    expect(primera.rankInGroup).not.toBeNull();
    // El puesto en el ranking general explica por qué la app la ve o no: corta en `candidates.preselect`.
    expect(m.filas.map((f) => f.posicionRanking)).toEqual([...m.filas.map((f) => f.posicionRanking)].sort((a, b) => (a ?? 1e9) - (b ?? 1e9)));
    expect(primera.posicionRanking).toBeGreaterThan(0);
    // Cada exclusión con su motivo, la regla de la casa.
    expect(m.descartadas.every((x) => !!x.motivo)).toBe(true);
    // De solo lectura: el Radar sigue vacío (nadie corrió el ranking).
    expect(await store.latestCandidates()).toEqual([]);
    expect(await store.latestPlan()).toBeNull();
  });

  it("la pasada ancha puede ir sin estados de la SEC: miles de pedidos para elegir 600 no se justifican", async () => {
    const pedidos: string[] = [];
    const statements = { quarters: async (sym: string) => { pedidos.push(sym); return null; } };
    const { d } = deps({ statements });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    await explorarMercado(d, { today: TODAY, portfolioUsd: 100_000, preselect: 12, conEstados: false });
    expect(pedidos).toEqual([]);
    // Con estados (la pasada angosta), sí los pide.
    await explorarMercado(d, { today: TODAY, portfolioUsd: 100_000, symbols: ["SA"] });
    expect(pedidos.length).toBeGreaterThan(0);
  });

  it("por defecto no escribe una sola fila: ni velas, ni estados, ni fundamentales", async () => {
    // 16/9, el dueño: "que no modifique nada, la idea es que la app llegue hasta el output de ese reporte, idéntico".
    // El informe es en paralelo y no deja rastro; guardar la caché es explícito (`guardar: true`).
    const escrituras: string[] = [];
    const statements = { quarters: async () => null };
    const { store, d } = deps({ statements });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const velasAntes = (await store.candles("SA", "2000-01-01")).length;
    const fundAntes = JSON.stringify(await store.fundamentals("SA"));
    const espiado = { ...d, store: new Proxy(store, { get(t, p, r) { if (p === "upsertCandles" || p === "saveStatements" || p === "saveFundamentals") { escrituras.push(String(p)); } const v = Reflect.get(t, p, r); return typeof v === "function" ? v.bind(t) : v; } }) } as unknown as RadarDeps;
    const m = await explorarMercado(espiado, { today: TODAY, portfolioUsd: 100_000, preselect: 12 });
    expect(m.filas.length).toBeGreaterThan(0);
    expect(escrituras).toEqual([]);
    expect((await store.candles("SA", "2000-01-01")).length).toBe(velasAntes);
    expect(JSON.stringify(await store.fundamentals("SA"))).toBe(fundAntes);
    // Con `guardar: true` sí deja la caché, que es lo único que puede querer guardarse.
    await explorarMercado(espiado, { today: TODAY, portfolioUsd: 100_000, preselect: 12, guardar: true });
    expect(escrituras.length).toBeGreaterThan(0);
  });

  it("evalúa símbolos sueltos con las mismas reglas, incluso fuera del universo, y avisa del que no tiene datos", async () => {
    const base = deps();
    // ZZZ no existe para la fuente de precios, como cualquier símbolo mal escrito que traiga una búsqueda.
    const { store, d } = deps({ history: { candles: async (sym: string) => { if (sym === "ZZZ") throw new Error("sin datos"); return base.d.history.candles(sym, 260); } }, store: base.store });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const m = await explorarMercado(d, { today: TODAY, portfolioUsd: 100_000, symbols: ["SA", "ZZZ"] });
    const sa = m.filas.find((f) => f.symbol === "SA");
    if (!sa) expect.fail(`SA tendría que estar: ${JSON.stringify(m.descartadas)}`);
    expect(sa.entryHigh).toBeGreaterThan(0);
    expect(sa.sizeUsd).not.toBeNull();
    // ZZZ no existe para las fuentes: queda descartada con el motivo, no se inventa una fila.
    expect(m.descartadas.some((x) => x.symbol === "ZZZ" && /sin velas|sin datos/.test(x.motivo))).toBe(true);
    expect(await store.latestCandidates()).toEqual([]);
  });
});

describe("rankRadar con ofertas y hechos externos (17/9)", () => {
  it("una empresa bajo oferta en la preselección queda OBSERVAR y el plan no la compra", async () => {
    const { store, d } = deps({ filingsDeOferta: async (s) => (s === "SA" ? ["DEFM14A — SA CORP"] : []) });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("OBSERVAR");
    expect(sa.flags).toContain("bajo_oferta_de_compra");
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 150_000 });
    expect(plan.lines.map((l) => l.symbol)).not.toContain("SA");
    expect(await store.latestCandidates()).not.toHaveLength(0);
  });
  it("la oferta se mira antes de elegir las filas: no le roba el lugar de desborde a la COMPRAR siguiente", async () => {
    // Primero, el orden real del ranking sin ofertas, con todo el universo guardado.
    const ancho = { ...policy, candidates: { top: 12, preselect: 12, chronicWeeks: 4, maxRows: 12 } };
    const base = deps({ policy: ancho });
    await scanUniverse(base.d, { scanDate: "2026-05-17", today: TODAY });
    const orden = (await rankRadar(base.d, { today: TODAY, portfolioUsd: 150_000 })).candidates.filter((c) => c.kind === "stock").sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)).map((c) => c.symbol);
    expect(orden.length).toBeGreaterThanOrEqual(4);
    const bajoOferta = orden[2]!; // puesto top+1: fuera de los 2 que entran por puntaje, primero en la cola de COMPRAR
    const siguiente = orden[3]!; // la COMPRAR que tiene que quedarse con el único lugar de desborde
    // Después, la corrida angosta: 2 por puntaje + 1 lugar de desborde para COMPRAR.
    const angosto = { ...policy, candidates: { top: 2, preselect: 5, chronicWeeks: 4, maxRows: 3 } };
    const { d } = deps({ policy: angosto, filingsDeOferta: async (s) => (s === bajoOferta ? [`DEFM14A — ${bajoOferta} CORP`] : []) });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const guardados = (await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 })).candidates.filter((c) => c.kind === "stock").map((c) => c.symbol);
    expect(guardados).toHaveLength(3);
    expect(guardados).toContain(siguiente); // con el orden viejo, bajoOferta contaba como COMPRAR y se llevaba este lugar
    expect(guardados).not.toContain(bajoOferta);
  });
  it("la puerta: un hecho verificado de guía subida hace evaluar y guardar a un símbolo fuera de la preselección; uno no verificado, no", async () => {
    const chico = { ...policy, candidates: { top: 2, preselect: 3, chronicWeeks: 4, maxRows: 2 } };
    const { store, d } = deps({ policy: chico });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${TODAY}T00:00:00.000Z` };
    const hecho = (symbol: string, url: string) => clasificarHecho({ tipo: "guia", symbol, fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: "8", despues: "10" }, fuente: { url, titulo: "8-K" } }, o);
    await store.saveHechos([hecho("SF", "https://www.sec.gov/sf"), hecho("SE", "https://finance.yahoo.com/se")]);
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    const guardados = r.candidates.filter((c) => c.kind === "stock").map((c) => c.symbol);
    expect(guardados).toContain("SF"); // puesto 6 de 12, fuera de la preselección de 3 y del tope de 2
    expect(guardados).not.toContain("SE"); // el hecho no es verificado
    expect(guardados.length).toBe(3); // el tope de 2 más la puerta
    expect(r.candidates.find((c) => c.symbol === "SF")!.flags).toContain("guia_subida");
  });
  it("la consulta a EDGAR que falla no pierde la fila, pero queda contada y anotada (17/9): antes fallaba abierta y en silencio", async () => {
    const { store, d } = deps({ filingsDeOferta: async (s) => { if (s === "SA") throw new Error("EDGAR caído"); return []; } });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    // La fila de SA no se pierde: la falla se traga por símbolo, como siempre.
    expect(r.candidates.some((c) => c.symbol === "SA")).toBe(true);
    const aviso = r.errors.find((e) => e.symbol === "*");
    expect(aviso?.error).toMatch(/^formularios de oferta: 1 de \d+ consultas fallaron$/);
    expect(await store.latestCandidates()).not.toHaveLength(0);
    // Y en `refreshRadar`, lo mismo.
    priceLevel = 104;
    const rf = await refreshRadar({ ...d, filingsDeOferta: async (s) => { if (s === "SA") throw new Error("EDGAR caído"); return []; } }, { today: "2026-05-20", portfolioUsd: 150_000 });
    priceLevel = 100;
    expect(rf.errors.find((e) => e.symbol === "*")?.error).toMatch(/^formularios de oferta: 1 de \d+ consultas fallaron$/);
  });
  it("explorarMercado pide los formularios de oferta y los hechos, y los devuelve en la fila", async () => {
    const { store, d } = deps({ filingsDeOferta: async (s) => (s === "SB" ? ["PREM14A — SB CORP"] : []) });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${TODAY}T00:00:00.000Z` };
    await store.saveHechos([clasificarHecho({ tipo: "guia", symbol: "SA", fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "10" }, fuente: { url: "https://www.sec.gov/sa", titulo: "8-K" } }, o)]);
    const m = await explorarMercado(d, { today: TODAY, portfolioUsd: 150_000, preselect: 12, conEstados: false });
    expect(m.filas.find((f) => f.symbol === "SB")).toMatchObject({ verdict: "OBSERVAR" });
    expect(m.filas.find((f) => f.symbol === "SB")!.flags).toContain("bajo_oferta_de_compra");
    const sa = m.filas.find((f) => f.symbol === "SA")!;
    expect(sa.flags).toContain("guia_subida");
    expect(sa.hechos.map((h) => h.tipo)).toEqual(["guia"]);
    expect(m.avisos).toEqual([]);
  });
  it("explorarMercado también avisa cuando la consulta a EDGAR falla, sin perder la fila", async () => {
    const { d } = deps({ filingsDeOferta: async (s) => { if (s === "SA") throw new Error("EDGAR caído"); return []; } });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const m = await explorarMercado(d, { today: TODAY, portfolioUsd: 150_000, preselect: 12, conEstados: false });
    expect(m.filas.some((f) => f.symbol === "SA")).toBe(true);
    expect(m.avisos).toHaveLength(1);
    expect(m.avisos[0]).toMatch(/^formularios de oferta: 1 de \d+ consultas fallaron/);
  });
});

