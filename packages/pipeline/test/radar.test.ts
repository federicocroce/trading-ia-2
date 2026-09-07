import { describe, expect, it } from "vitest";
import type { AssetInfo, Candle, Card, CardInput, CardWriter, EtfConfig, FinnhubMetrics, RadarPolicy, SnapshotLite, SymbolProfile, TaxonomyConfig } from "@thesis/core";
import { MemoryStore, applyTaxonomy, buildContributionPlan, measureRadar, rankRadar, refreshRadar, scanUniverse, type RadarDeps } from "../src/index.js";

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
  const history = { candles: async (s: string) => series(s === "XLE" ? ramp(80, priceLevel * 1.25) : ramp(80, priceLevel).map((c) => (s === "SPY" ? c * 5 : c))) };
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

describe("refreshRadar", () => {
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
    expect(plan.lines.map((l) => [l.symbol, l.kind, l.amountUsd])).toEqual([["SL", "sumar", 3250], ["SA", "comprar", 3250]]);
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
