import { describe, expect, it } from "vitest";
import type { Candle, CandidateRow, Fundamentals } from "@thesis/core";
import { MemoryStore, refreshWatchlist, type RadarDeps } from "../src/index.js";

const series = (n: number, from: number, to: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = from + ((to - from) * i) / (n - 1);
    return { date: new Date(Date.parse("2025-08-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 2_000_000 };
  });
const today = "2026-09-08";
const policy = { weights: { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 }, quality: { minMcapUsd: 5e8, minDollarVolumeUsd: 5e6, minPrice: 5 }, prefilter: { minPrice: 5, minIexDollarVolume: 1e5 }, technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 }, contribution: { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50 } };
const fund = (symbol: string, pe: number, peers: string[]): Fundamentals => ({ symbol, asOf: today, metrics: { peTTM: pe, evEbitdaTTM: pe / 2, psTTM: 2, roeTTM: 15, operatingMarginTTM: 20, netProfitMarginTTM: 10, revenueGrowthTTMYoy: 10, revenueGrowth5Y: 8, epsGrowthTTMYoy: 12, "totalDebt/totalEquityAnnual": 0.5, currentRatioAnnual: 1.5, beta: 1 }, peers, industry: "Utilities", mcapUsd: 50e9, dollarVolumeUsd: 500e6, priceUsd: 100, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });

function setup() {
  const store = new MemoryStore();
  const deps = {
    store,
    history: { candles: async (s: string) => (s === "SPY" ? series(300, 500, 600) : s === "VST" ? series(300, 100, 200) : s === "MP" ? series(300, 80, 40) : s === "USAR" ? series(300, 10, 12) : []) },
    taxonomy: { sectors: ["Servicios públicos", "Otros"], themes: ["energia_ia", "infraestructura"], industryToSector: { Utilities: "Servicios públicos" }, industryToThemes: {}, symbolToThemes: { VST: ["energia_ia"] }, symbolToAssetClass: {} },
    etfs: [],
    policy,
    fundamentals: {} as never,
    assets: {} as never,
    cardWriter: null,
    filings: async () => [],
  } as unknown as RadarDeps;
  return { store, deps };
}

describe("refreshWatchlist", () => {
  it("cada ticker de la lista recibe veredicto técnico, stop, objetivo y su rank contra pares si está en el universo", async () => {
    const { store, deps } = setup();
    const peers = ["VST", "CEG", "NRG", "AES", "SO"];
    for (const p of peers) await store.saveFundamentals(fund(p, p === "VST" ? 12 : 25, peers.filter((x) => x !== p)));
    await store.addWatch("VST");
    await store.addWatch("mp"); // se normaliza
    await store.addWatch("USAR");
    const r = await refreshWatchlist(deps, { today, portfolioUsd: 150_000 });
    expect(r.errors).toEqual([]);
    expect(r.rows).toBe(3);
    const rows = (await store.latestCandidates()).filter((x) => x.kind === "watch");
    const vst = rows.find((x) => x.symbol === "VST")!;
    expect(vst.verdict).toBe("COMPRAR");
    expect(vst.score).not.toBeNull();
    expect(vst.rankInGroup).toBe(1);
    expect(vst.groupSize).toBe(5);
    expect(vst.stop).not.toBeNull();
    expect(vst.target).toBeGreaterThan(vst.close);
    expect(vst.sizeQty).toBeGreaterThan(0);
    expect(vst.spyClose).toBe(600);
    expect((await store.tags("VST"))?.themes).toContain("energia_ia");
    const mp = rows.find((x) => x.symbol === "MP")!;
    expect(mp.verdict).toBe("OBSERVAR");
    expect(mp.flags).toContain("bajo_sma200");
    expect(mp.score).toBeNull(); // no está en el universo: sin rank, pero con veredicto técnico
    expect(mp.target).toBeNull();
    const usar = rows.find((x) => x.symbol === "USAR")!;
    expect(usar.verdict).toBe("COMPRAR");
    expect(usar.riskScore).toBeGreaterThanOrEqual(1);
    expect((await store.candles("MP", "2020-01-01")).length).toBe(300);
    // No pisa a las familias US ni Argentina y cuenta apariciones.
    const again = await refreshWatchlist(deps, { today: "2026-09-09", portfolioUsd: 150_000 });
    expect(again.rows).toBe(3);
    expect((await store.latestCandidates()).find((x) => x.symbol === "VST")?.nthAppearance).toBe(2);
  });
  it("APH el 14/9: seguir algo que el ranking ya eligió no pisa su fila del Radar (era 1° por convicción y pasó a seguimiento)", async () => {
    const { store, deps } = setup();
    const peers = ["VST", "CEG", "NRG", "AES", "SO"];
    for (const p of peers) await store.saveFundamentals(fund(p, p === "VST" ? 12 : 25, peers.filter((x) => x !== p)));
    // La corrida de la mañana: VST es candidata del ranking, con su score y su lugar entre pares.
    const delRanking = { candidateDate: today, symbol: "VST", kind: "stock", verdict: "COMPRAR", score: 1.7, axes: {}, peerGroup: peers, rankInGroup: 1, groupSize: 5, close: 200, entryLow: 200, entryHigh: 204, stop: 185, target: 242, sizeUsd: 10_000, sizeQty: 50, riskScore: 3, flags: ["verificacion_apta"], nthAppearance: 3, summary: "ficha", whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: 600, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null } satisfies CandidateRow;
    await store.upsertCandidates([delRanking]);
    await store.addWatch("VST", { entryPrice: 150, targetPrice: null, stopLoss: null, horizonDays: 30 });
    await store.addWatch("USAR");
    const r = await refreshWatchlist(deps, { today, portfolioUsd: 150_000 });
    expect(r.errors).toEqual([]);
    const filas = await store.latestCandidates();
    const vst = filas.filter((x) => x.symbol === "VST");
    expect(vst).toHaveLength(1);
    expect(vst[0]).toMatchObject({ kind: "stock", score: 1.7, nthAppearance: 3, summary: "ficha" });
    // El seguimiento igual se evalúa contra el precio de hoy.
    expect((await store.watchlist()).find((i) => i.symbol === "VST")).toMatchObject({ status: "live", lastPrice: 200 });
    // Lo que el ranking no eligió sí tiene su fila de seguimiento.
    expect(filas.find((x) => x.symbol === "USAR")?.kind).toBe("watch");
  });
  it("lista vacía: no hace nada; sin velas: error por símbolo y sigue", async () => {
    const { store, deps } = setup();
    expect(await refreshWatchlist(deps, { today, portfolioUsd: null })).toEqual({ symbols: 0, rows: 0, errors: [] });
    await store.addWatch("NADA");
    await store.addWatch("VST");
    const r = await refreshWatchlist(deps, { today, portfolioUsd: null });
    expect(r.errors.map((e) => e.symbol)).toEqual(["NADA"]);
    expect(r.rows).toBe(1);
  });
});

describe("ciclo de vida del seguimiento", () => {
  it("evalúa cada ítem contra el precio de hoy: viva, gatillada al tocar el objetivo, invalidada al tocar el stop, expirada al vencer", async () => {
    const { store, deps } = setup();
    await store.addWatch("VST", { entryPrice: 150, targetPrice: 190, stopLoss: 140, thesis: "energía IA", horizonDays: 30 }); // hoy cierra 200 → gatillada
    await store.addWatch("MP", { entryPrice: 60, targetPrice: 80, stopLoss: 50, horizonDays: 30 }); // hoy cierra 40 → invalidada
    await store.addWatch("USAR", { entryPrice: 10, targetPrice: null, stopLoss: null, horizonDays: 30 }); // sin niveles: viva, con retorno
    await refreshWatchlist(deps, { today, portfolioUsd: null });
    const items = Object.fromEntries((await store.watchlist()).map((i) => [i.symbol, i]));
    expect(items["VST"]).toMatchObject({ status: "triggered", lastPrice: 200, lastReturn: 33.33, resolutionPrice: 200, resolutionReturn: 33.33 });
    expect(items["VST"]!.resolvedAt).not.toBeNull();
    expect(items["MP"]).toMatchObject({ status: "invalidated", lastReturn: -33.33 });
    expect(items["USAR"]).toMatchObject({ status: "live", lastPrice: 12, lastReturn: 20, resolvedAt: null });
    // Los resueltos no se vuelven a evaluar: el estado queda fijo.
    await refreshWatchlist({ ...deps, history: { candles: async (s: string) => (s === "VST" ? series(300, 100, 100) : deps.history.candles(s, 400)) } }, { today: "2026-09-09", portfolioUsd: null });
    expect((await store.watchlist()).find((i) => i.symbol === "VST")?.status).toBe("triggered");
  });
  it("sin precio de alta (alta vieja) toma el cierre de hoy como entrada la primera vez", async () => {
    const { store, deps } = setup();
    await store.addWatch("USAR");
    await refreshWatchlist(deps, { today, portfolioUsd: null });
    const it = (await store.watchlist())[0]!;
    expect(it.entryPrice).toBe(12);
    expect(it.status).toBe("live");
  });
});
