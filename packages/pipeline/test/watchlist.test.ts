import { describe, expect, it } from "vitest";
import type { Candle, Fundamentals } from "@thesis/core";
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
