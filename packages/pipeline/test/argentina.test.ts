import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore, measureRadar, refreshArgentina, type ArgentinaDeps } from "../src/index.js";

const series = (n: number, from: number, to: number, start = "2025-06-01"): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = n === 1 ? to : from + ((to - from) * i) / (n - 1);
    return { date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 100_000 };
  });
const today = "2026-09-07";
const policy = { weights: { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 }, quality: { minMcapUsd: 5e8, minDollarVolumeUsd: 5e6, minPrice: 5 }, prefilter: { minPrice: 5, minIexDollarVolume: 1e5 }, technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 }, contribution: { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50 } };
const config = {
  benchmark: "^MERV",
  acciones: [
    { symbol: "GGAL.BA", name: "Galicia", adr: "GGAL", sector: "Financiero", themes: ["bancos"] },
    { symbol: "ALUA.BA", name: "Aluar", adr: null, sector: "Materiales", themes: [] },
  ],
  cedears: [{ symbol: "AAPL.BA", us: "AAPL", ratio: 20 }],
};

function setup() {
  const store = new MemoryStore();
  const calls: string[] = [];
  const deps: ArgentinaDeps = {
    store,
    history: { candles: async (s) => { calls.push(`history:${s}`); return s === "^MERV" ? series(260, 1000, 1500) : s === "GGAL.BA" ? series(260, 1000, 2000) : s === "ALUA.BA" ? series(260, 2000, 1000) : s === "AAPL.BA" ? series(10, 25000, 25320) : []; } },
    macro: { dolares: async () => ({ oficial: 1530, mep: 1533.7, ccl: 1583.2, blue: 1545, mayorista: 1511.5 }), riesgoPais: async () => ({ value: 490, date: today }) },
    usPrices: async (symbols) => { calls.push(`us:${symbols.join(",")}`); return { AAPL: 319.8 }; },
    config,
    policy,
  };
  return { store, deps, calls };
}

describe("refreshArgentina", () => {
  it("guarda el macro del día, rankea las acciones contra el Merval, chequea CEDEARs y etiqueta todo", async () => {
    const { store, deps, calls } = setup();
    await store.saveTags("ALUA.BA", { assetClass: "accion_ar", sector: "Materiales", industry: null, themes: ["a_mano"], themesSource: "manual" });
    const r = await refreshArgentina(deps, { today });
    expect(r.errors).toEqual([]);
    expect(r.acciones).toBe(2);
    expect(r.cedears).toBe(1);

    const macro = await store.latestMacroAr();
    expect(macro?.ccl).toBe(1583.2);
    expect(macro?.brechaPct).toBeCloseTo(3.48, 1);
    expect(macro?.riesgoPais).toBe(490);
    expect(macro?.mervalUsd).toBeCloseTo(1500 / 1583.2, 2);

    const rows = await store.latestCandidates();
    const ggal = rows.find((x) => x.symbol === "GGAL.BA")!;
    expect(ggal.kind).toBe("ar");
    expect(ggal.verdict).toBe("COMPRAR");
    expect(ggal.close).toBe(2000);
    expect(ggal.axes["closeUsd"]).toBeCloseTo(1.2633, 3);
    expect(ggal.peerGroup).toEqual(["GGAL"]);
    expect(ggal.spyClose).toBe(1500); // cierre del Merval, la referencia para medir
    const alua = rows.find((x) => x.symbol === "ALUA.BA")!;
    expect(alua.verdict).toBe("OBSERVAR");
    expect(alua.flags).toContain("bajo SMA200");
    const aapl = rows.find((x) => x.symbol === "AAPL.BA")!;
    expect(aapl.kind).toBe("cedear");
    expect(aapl.flags).toEqual(["en_linea"]);
    expect(aapl.axes["impliedCcl"]).toBeCloseTo(1583.5, 0);
    expect(aapl.axes["ratio"]).toBe(20);
    expect(aapl.peerGroup).toEqual(["AAPL"]);

    expect((await store.tags("GGAL.BA"))).toEqual({ assetClass: "accion_ar", sector: "Financiero", industry: null, themes: ["argentina", "bancos"], themesSource: "regla" });
    expect((await store.tags("ALUA.BA"))?.themes).toEqual(["a_mano"]); // lo manual no se pisa
    expect((await store.tags("AAPL.BA"))?.assetClass).toBe("cedear");
    expect((await store.candles("GGAL.BA", "2020-01-01")).length).toBe(260);
    expect((await store.candles("^MERV", "2020-01-01")).length).toBe(260);
    expect(calls.filter((c) => c.startsWith("us:"))).toEqual(["us:AAPL"]);
  });

  it("si el dólar o el riesgo país fallan, las acciones salen igual (sin precio en dólares) y los CEDEARs se saltean con error", async () => {
    const { store, deps } = setup();
    const roto: ArgentinaDeps = { ...deps, macro: { dolares: async () => { throw new Error("dolarapi caído"); }, riesgoPais: async () => null } };
    const r = await refreshArgentina(roto, { today });
    expect(r.acciones).toBe(2);
    expect(r.cedears).toBe(0);
    expect(r.errors.map((e) => e.symbol)).toEqual(["macro", "AAPL.BA"]);
    const macro = await store.latestMacroAr();
    expect(macro?.ccl).toBeNull();
    expect(macro?.merval).toBe(1500);
    expect((await store.latestCandidates()).find((x) => x.symbol === "GGAL.BA")?.axes["closeUsd"]).toBeNull();
  });

  it("la medición compara las acciones argentinas contra el Merval y no mide CEDEARs", async () => {
    const { store, deps } = setup();
    await refreshArgentina(deps, { today: "2026-08-01" });
    const history = { candles: async (s: string) => (s === "^MERV" ? series(300, 1000, 1500, "2025-11-01") : s === "GGAL.BA" ? series(300, 1000, 2500, "2025-11-01") : s === "AAPL.BA" ? series(300, 25000, 30000, "2025-11-01") : series(300, 2000, 1000, "2025-11-01")) };
    const m = await measureRadar({ store, history }, { today: "2026-09-07" });
    expect(m.candidates["7"]).toBe(2);
    const rows = await store.latestCandidates();
    const ggal = rows.find((x) => x.symbol === "GGAL.BA")!;
    expect(ggal.close7d).not.toBeNull();
    expect(ggal.spy7d).not.toBeNull();
    expect(ggal.alpha7dPct).toBeGreaterThan(0);
    expect(rows.find((x) => x.symbol === "AAPL.BA")?.close7d).toBeNull();
  });
});
