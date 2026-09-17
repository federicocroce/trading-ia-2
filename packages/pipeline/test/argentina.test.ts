import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore, measureRadar, refreshArgentina, refreshRadar, type ArgentinaDeps } from "../src/index.js";

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
    expect(alua.flags).toContain("bajo_sma200");
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

  /**
   * MIRG.BA el 13/9. El motor empezó a excluirla (split 10 a 1 sin ajustar) y su fila de la corrida de la
   * mañana sobrevivió en la base, con la fuerza relativa de −92,68% que el arreglo venía a sacar. La
   * pantalla la seguía mostrando como cualquier otra. Vale para cualquier exclusión, no solo para splits.
   */
  it("un papel que hoy pasó a estar excluido no sobrevive con la fila de la corrida anterior", async () => {
    const { store, deps } = setup();
    await refreshArgentina(deps, { today });
    expect((await store.latestCandidates()).some((x) => x.symbol === "ALUA.BA")).toBe(true);

    // Segunda corrida del mismo día en la que ALUA.BA ya no se puede evaluar.
    const sinAlua: ArgentinaDeps = { ...deps, history: { candles: async (s, days) => (s === "ALUA.BA" ? [] : deps.history.candles(s, days)) } };
    await refreshArgentina(sinAlua, { today });
    const rows = await store.latestCandidates();
    expect(rows.some((x) => x.symbol === "ALUA.BA")).toBe(false);
    expect(rows.some((x) => x.symbol === "GGAL.BA")).toBe(true);
    expect(rows.some((x) => x.symbol === "AAPL.BA")).toBe(true);
  });

  it("las filas argentinas de hoy no esconden las acciones US del último ranking: latestCandidates es por familia", async () => {
    const { store, deps } = setup();
    const us = { candidateDate: "2026-09-07", symbol: "NVDA", kind: "stock" as const, verdict: "COMPRAR" as const, score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 10, close: 230, entryLow: 230, entryHigh: 234.6, stop: 214, target: 262, sizeUsd: 15_000, sizeQty: 66, riskScore: 4, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: 770, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([us, { ...us, symbol: "VTI", kind: "etf", verdict: "NUCLEO" }, { ...us, symbol: "OLD", candidateDate: "2026-09-01" }]);
    // Argentina corre un día después del último ranking US: las US siguen siendo "las últimas" de su familia.
    await refreshArgentina(deps, { today: "2026-09-08" });
    const rows = await store.latestCandidates();
    expect(rows.filter((r) => r.kind === "stock" || r.kind === "etf").map((r) => r.symbol).sort()).toEqual(["NVDA", "VTI"]);
    expect(rows.filter((r) => r.kind === "ar" || r.kind === "cedear").length).toBe(3);
  });

  it("el refresco del Radar US deja en paz las filas argentinas y de seguimiento (otras familias, otro refresco)", async () => {
    const { store, deps } = setup();
    await refreshArgentina(deps, { today });
    const before = (await store.latestCandidates()).filter((r) => r.kind === "ar" || r.kind === "cedear");
    const radarDeps = { store, history: deps.history, taxonomy: { sectors: [], themes: [], industryToSector: {}, industryToThemes: {}, symbolToThemes: {}, symbolToAssetClass: {} }, etfs: [], policy, fundamentals: { nextEarnings: async () => null, insiders: async () => null, recommendation: async () => null, earningsSurprises: async () => null } as never, assets: {} as never, cardWriter: null, filings: async () => [], filingsDeOferta: async () => [] } as unknown as Parameters<typeof refreshRadar>[0];
    const r = await refreshRadar(radarDeps, { today, portfolioUsd: null });
    expect(r.errors).toEqual([]);
    expect(r.refreshed).toBe(0);
    expect((await store.latestCandidates()).filter((x) => x.kind === "ar" || x.kind === "cedear")).toEqual(before);
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

/**
 * 13/9/2026: el dueño compra en dólares y puede ir directo al ADR, pero la pestaña mostraba solo las
 * acciones locales en pesos contra el Merval. Ahora las que tienen ADR se evalúan en dólares contra el SPY.
 */
describe("refreshArgentina: ADRs en dólares", () => {
  const conAdr = () => {
    const { store, deps } = setup();
    const base = deps.history.candles;
    // GGAL (el ADR) le gana al SPY; ALUA.BA no tiene ADR.
    deps.history = { candles: async (s, n) => (s === "SPY" ? series(260, 400, 440) : s === "GGAL" ? series(260, 20, 44) : base(s, n)) };
    return { store, deps };
  };

  it("el ADR sale en dólares, contra el SPY, apuntando a su acción local", async () => {
    const { store, deps } = conAdr();
    const r = await refreshArgentina(deps, { today });
    expect(r.adrs).toBe(1);
    const ggal = (await store.latestCandidates()).find((x) => x.symbol === "GGAL" && x.kind === "adr")!;
    expect(ggal.close).toBe(44);
    expect(ggal.peerGroup).toEqual(["GGAL.BA"]);
    expect(ggal.spyClose).toBe(440);
    expect(ggal.verdict).toBe("COMPRAR");
    expect(ggal.axes["rs6m"]).toBeGreaterThan(0);
  });

  it("la acción sin ADR no genera fila en dólares: solo se compra en pesos", async () => {
    const { store, deps } = conAdr();
    await refreshArgentina(deps, { today });
    expect((await store.latestCandidates()).some((x) => x.kind === "adr" && x.peerGroup[0] === "ALUA.BA")).toBe(false);
  });

  /**
   * La clave de la tabla es (fecha, símbolo). Si el Radar de acciones ya evalúa a GGAL hoy, una fila "adr"
   * pisaría a la del Radar, que es más completa (fundamentals contra pares además de tendencia).
   */
  it("si el Radar de acciones ya tiene el ADR hoy, no lo pisa", async () => {
    const { store, deps } = conAdr();
    const delRadar = { candidateDate: today, symbol: "GGAL", kind: "stock" as const, verdict: "OBSERVAR" as const, score: 0.4, axes: {}, peerGroup: ["BMA"], rankInGroup: 3, groupSize: 9, close: 44, entryLow: 44, entryHigh: 44.88, stop: 40, target: 53.76, sizeUsd: null, sizeQty: null, riskScore: 5, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: 440, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([delRadar]);
    const r = await refreshArgentina(deps, { today });
    expect(r.adrs).toBe(0);
    const ggal = (await store.allCandidates()).filter((x) => x.symbol === "GGAL" && x.candidateDate === today);
    expect(ggal).toHaveLength(1);
    expect(ggal[0]!.kind).toBe("stock");
    expect(ggal[0]!.score).toBe(0.4);
  });

  it("no pisa las etiquetas que el ADR ya tenía: son posiciones y el riesgo por tema depende de ellas", async () => {
    const { store, deps } = conAdr();
    await store.saveTags("GGAL", { assetClass: "adr", sector: "Financiero", industry: "Banks", themes: ["bancos", "a_mano"], themesSource: "regla" });
    await refreshArgentina(deps, { today });
    expect((await store.tags("GGAL"))?.themes).toEqual(["bancos", "a_mano"]);
  });
});

