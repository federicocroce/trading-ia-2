import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { radarRoutes } from "./radar.js";
import { taxonomyRoutes } from "./taxonomy.js";
import { state, type Container } from "../container.js";

const series = (n: number, from: number, to: number): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse("2025-09-01") + i * 86_400_000).toISOString().slice(0, 10), open: from, high: from * 1.01, low: from * 0.99, close: from + ((to - from) * i) / (n - 1), volume: 1_000_000 }));
const today = "2026-05-19";

function app() {
  const store = new MemoryStore();
  const taxonomy = { sectors: ["Tecnología", "Otros"], themes: ["IA", "semiconductores"], industryToSector: { Semiconductors: "Tecnología" }, industryToThemes: { Semiconductors: ["semiconductores"] }, symbolToThemes: {}, symbolToAssetClass: {} };
  const radarDeps = {
    store,
    assets: { list: async () => [{ symbol: "AAA", name: "Aaa", exchange: "NASDAQ", tradable: true }], snapshots: async (s: string[]) => s.map((x) => ({ symbol: x, price: 100, iexVolume: 100_000 })) },
    fundamentals: { profile: async (s: string) => ({ symbol: s, name: s, country: "US", industry: "Semiconductors", marketCap: null, currency: "USD", shareOutstanding: 100 }), metrics: async () => ({ "3MonthAverageTradingVolume": 5 }), peers: async () => [], recommendation: async () => null, earningsSurprises: async () => null, insiders: async () => ({ buys: 0, sells: 0 }), nextEarnings: async () => null },
    history: { candles: async () => series(260, 80, 100) },
    cardWriter: null,
    taxonomy,
    etfs: [{ symbol: "VTI", name: "VTI", role: "nucleo" as const, exposure: "rv_us" as const, ter: 0.03, themes: [], coreWeight: 1 }],
    policy: { weights: { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 }, quality: { minMcapUsd: 500e6, minDollarVolumeUsd: 5e6, minPrice: 5 }, prefilter: { minPrice: 5, minIexDollarVolume: 500_000 }, technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 }, contribution: { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50 } },
    filings: async () => [],
  };
  const c = { store, radarDeps, carteraDeps: { store } } as unknown as Container;
  const a = new Hono();
  a.route("/", radarRoutes(c));
  a.route("/", taxonomyRoutes(c));
  return { a, store };
}
const post = (a: Hono, path: string, body?: unknown) => a.request(path, { method: "POST", ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

describe("/taxonomy", () => {
  it("opciones, lectura y edición manual", async () => {
    const { a } = app();
    const opts = await (await a.request("/taxonomy/options")).json();
    expect(opts.themes).toContain("IA");
    expect((await a.request("/taxonomy/AAA")).status).toBe(404);
    const put = await a.request("/taxonomy/aaa", { method: "PUT", body: JSON.stringify({ assetClass: "accion_us", sector: "Tecnología", themes: ["IA", "inventado"] }), headers: { "content-type": "application/json" } });
    expect(put.status).toBe(200);
    const t = await (await a.request("/taxonomy/AAA")).json();
    expect(t.themes).toEqual(["IA"]);
    expect(t.themesSource).toBe("manual");
    expect((await a.request("/taxonomy/AAA", { method: "PUT", body: JSON.stringify({ assetClass: "nave" }), headers: { "content-type": "application/json" } })).status).toBe(400);
  });
});

describe("/radar", () => {
  it("scan en segundo plano con estado; 409 si ya corre; rank, refresh, plan, candidates con filtro, measurement", async () => {
    const { a } = app();
    state.scan = { running: false, stopRequested: false, startedAt: null, progress: null, last: null };
    expect((await post(a, "/radar/scan")).status).toBe(202);
    for (let i = 0; i < 50 && state.scan.running; i++) await new Promise((r) => setTimeout(r, 10));
    const st = await (await a.request("/radar/scan-status")).json();
    expect(st.running).toBe(false);
    expect(st.last.fundamentalsOk).toBe(1);
    state.scan.running = true;
    expect((await post(a, "/radar/scan")).status).toBe(409);
    state.scan.running = false;

    const rank = await (await post(a, `/radar/rank?today=${today}`)).json();
    expect(rank.candidates.some((c: { symbol: string }) => c.symbol === "VTI")).toBe(true);
    const list = await (await a.request("/radar/candidates?kind=etf")).json();
    expect(list.map((c: { symbol: string }) => c.symbol)).toEqual(["VTI"]);
    expect((await (await a.request("/radar/candidates?theme=IA")).json()).length).toBe(0);
    expect((await (await a.request("/radar/etfs")).json()).length).toBe(1);
    expect((await (await post(a, `/radar/refresh?today=${today}`)).json()).refreshed).toBe(1);
    const plan = await (await post(a, "/radar/plan?month=2026-05")).json();
    expect(plan.month).toBe("2026-05");
    expect((await (await a.request("/radar/plan")).json()).month).toBe("2026-05");
    const m = await (await a.request("/radar/measurement")).json();
    expect(m.byVerdict.NUCLEO.h7.n).toBe(0);
    expect((await a.request("/radar/candidates/VTI")).status).toBe(200);
    expect((await a.request("/radar/candidates/ZZZ")).status).toBe(404);
  });
});
