import { describe, expect, it } from "vitest";
import type { Candle, Note, PositionNarrator, PriceHistory, Profiles } from "@thesis/core";
import { MemoryStore, carteraCurve, measureVerdicts, runCartera } from "../src/index.js";

const mk = (closes: number[], start = "2026-06-01", volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume }));
const days = (n: number, v: number) => Array(n).fill(v);
const today = "2026-09-08"; // velas hasta 2026-09-07 con 99 puntos desde 2026-06-01

const history = (series: Record<string, Candle[]>): PriceHistory => ({
  candles: async (s) => {
    const c = series[s];
    if (!c) throw new Error(`sin velas ${s}`);
    return c;
  },
});
const profiles: Profiles = { profile: async (s) => ({ symbol: s, name: `${s} Inc`, country: s === "YPF" ? "AR" : "US", industry: "Energy", marketCap: 1 }) };
const narrator = (note: Note | Error): PositionNarrator => ({
  promptVersion: "n-test",
  narrate: async () => {
    if (note instanceof Error) throw note;
    return note;
  },
});

function setup(narr: PositionNarrator | null, series?: Record<string, Candle[]>) {
  const store = new MemoryStore();
  const s = series ?? { SPY: mk(days(99, 500)), YPF: mk(days(99, 40)), TSM: mk(days(99, 400)) };
  return { store, deps: { store, history: history(s), profiles, narrator: narr, spot: async () => null } };
}
const pos = (symbol: string, quantity: number, avgCost: number, market: "us" | "adr" = "us") => ({ symbol, quantity, avgCost, currency: "USD", market, layer: "riesgo" as const, notes: null });

describe("runCartera", () => {
  it("emite un veredicto por posición, guarda riesgo y pesos", async () => {
    const { store, deps } = setup(narrator({ narrative: "Sin novedades en los filings recibidos.", degrade: false }));
    await store.upsertPosition(pos("YPF", 100, 30, "adr"));
    await store.upsertPosition(pos("TSM", 10, 300));
    const s = await runCartera(deps, { today });
    expect(s.verdicts.map((v) => v.symbol).sort()).toEqual(["TSM", "YPF"]);
    expect(s.verdicts.every((v) => v.verb === "MANTENER")).toBe(true);
    expect(s.verdicts.find((v) => v.symbol === "YPF")!.weightPct).toBeCloseTo(50, 1);
    expect(s.verdicts[0]!.narrative).toContain("filings");
    expect(s.verdicts[0]!.spyClose).toBe(500);
    expect((await store.latestRisk())!.report.concentration.byCountry).toEqual({ AR: 50, US: 50 });
    expect(s.errors).toEqual([]);
  });
  /**
   * 12/9: el barrido de noticias corría solo sobre las candidatas del ranking. GGAL, HUT, MARA, NEM e YPF
   * —cinco de las ocho posiciones con plata puesta— no tenían una sola noticia leída nunca, y el veredicto
   * de mantener se calculaba con la misma lista vacía que devuelve un símbolo verificado y limpio.
   */
  it("lee las noticias de cada posición antes de decidir", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition(pos("YPF", 100, 30, "adr"));
    await store.upsertPosition(pos("TSM", 10, 300));
    const leidos: string[] = [];
    await runCartera({ ...deps, scanEvents: async (sym) => { leidos.push(sym); } }, { today });
    expect(leidos.sort()).toEqual(["TSM", "YPF"]);
  });

  it("si las noticias de una posición fallan, queda registrado y las demás siguen", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition(pos("YPF", 100, 30, "adr"));
    await store.upsertPosition(pos("TSM", 10, 300));
    const s = await runCartera({ ...deps, scanEvents: async (sym) => { if (sym === "YPF") throw new Error("Finnhub 429"); } }, { today });
    expect(s.verdicts).toHaveLength(2);
    expect(s.errors).toEqual([{ symbol: "YPF", error: expect.stringContaining("Finnhub 429") }]);
  });

  it("el panel de riesgo usa las etiquetas: concentración por sector y tema", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition(pos("YPF", 100, 30, "adr"));
    await store.upsertPosition(pos("TSM", 10, 300));
    await store.saveTags("YPF", { assetClass: "adr", sector: "Energía", industry: "Energy", themes: ["argentina", "petroleo_gas"], themesSource: "regla" });
    await store.saveTags("TSM", { assetClass: "adr", sector: "Tecnología", industry: "Semiconductors", themes: ["semiconductores"], themesSource: "regla" });
    const s = await runCartera(deps, { today });
    expect(s.risk.concentration.bySector).toEqual({ Energía: 50, Tecnología: 50 });
    expect(s.risk.concentration.byTheme).toEqual({ argentina: 50, petroleo_gas: 50, semiconductores: 50 });
  });
  it("sin velas de hoy → REVISAR; sin velas → REVISAR y error registrado", async () => {
    const { store, deps } = setup(null, { SPY: mk(days(99, 500)), OLD: mk(days(99, 10), "2026-05-01") });
    await store.upsertPosition(pos("OLD", 1, 1));
    await store.upsertPosition(pos("NONE", 1, 1));
    const s = await runCartera(deps, { today });
    expect(s.verdicts.find((v) => v.symbol === "OLD")!.verb).toBe("REVISAR");
    expect(s.verdicts.find((v) => v.symbol === "NONE")!.verb).toBe("REVISAR");
    expect(s.errors).toEqual([{ symbol: "NONE", error: expect.stringContaining("sin velas") }]);
  });
  it("el modelo solo degrada: MANTENER → REVISAR con motivo; nunca sube", async () => {
    const { store, deps } = setup(narrator({ narrative: "n", degrade: true, degradeReason: "6-K con recorte de guidance" }));
    await store.upsertPosition(pos("TSM", 10, 300));
    const s = await runCartera(deps, { today });
    expect(s.verdicts[0]!.verb).toBe("REVISAR");
    expect(s.verdicts[0]!.degradedBy).toBe("narrator");
    expect(s.verdicts[0]!.reason).toContain("guidance");
  });
  it("si el narrador falla, el veredicto sale igual sin narrativa", async () => {
    const { store, deps } = setup(narrator(new Error("HTTP 503")));
    await store.upsertPosition(pos("TSM", 10, 300));
    const s = await runCartera(deps, { today });
    expect(s.verdicts[0]!.verb).toBe("MANTENER");
    expect(s.verdicts[0]!.narrative).toBeNull();
    expect(s.errors[0]!.error).toContain("503");
  });
  /**
   * 15/9: la corrida de las 07:49 guardó el riesgo con la fecha de la corrida y la pantalla decía "valor al
   * cierre del 2026-09-15" con el cierre del 14/9. El informe guarda de qué vela sale cada precio.
   */
  it("el riesgo guardado dice de qué cierre es, no la fecha de la corrida", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition(pos("YPF", 100, 30, "adr"));
    const s = await runCartera(deps, { today });
    expect(s.risk.asOf).toBe("2026-09-07");
    expect((await store.latestRisk())!.date).toBe(today);
    expect((await store.latestRisk())!.report.asOf).toBe("2026-09-07");
    expect((await store.latestRisk())!.report.weights[0]!.closeDate).toBe("2026-09-07");
  });
  it("correr dos veces el mismo día reemplaza, no duplica", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition(pos("TSM", 10, 300));
    await runCartera(deps, { today });
    await runCartera(deps, { today });
    expect(await store.allVerdicts()).toHaveLength(1);
  });
});

describe("carteraCurve", () => {
  /**
   * 15/9: la curva solo cargaba velas de los papeles con compras o ventas y arrancaba en la primera compra. Un
   * papel que llegó por traspaso (la foto del saldo al mudar de plataforma) no tenía velas ni entraba en la curva.
   */
  it("un papel que solo tiene un traspaso también entra, con sus velas", async () => {
    const store = new MemoryStore();
    await store.upsertCandles("SPY", mk(days(20, 500)));
    await store.upsertCandles("AAA", mk(days(20, 50)));
    await store.upsertPosition(pos("AAA", 10, 49));
    await store.insertTransactions([{ id: "t1", symbol: "AAA", type: "TRANSFER", quantity: 10, price: 49, fees: 0, date: "2026-06-03", currency: "USD", platform: "Nexo", externalId: null, notes: null }]);
    const r = await carteraCurve(store);
    expect(r.error).toBeNull();
    expect(r.curve?.from).toBe("2026-06-03");
    expect(r.curve?.valueUsd).toBe(500);
    expect(r.curve?.investedUsd).toBe(490);
  });
});

const row = (verdictDate: string) => ({ verdictDate, symbol: "TSM", verb: "MANTENER" as const, reason: "r", narrative: null, warning: null, close: 400, spot: null, stop: null, target: null, gainPct: 0, weightPct: 100, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null });

describe("measureVerdicts", () => {
  it("completa 7d y 30d cuando hay vela posterior; no repite", async () => {
    const { store, deps } = setup(null);
    await store.upsertVerdicts([row("2026-06-10")]);
    expect(await measureVerdicts(deps, { today })).toEqual({ measured7: 1, measured30: 1 });
    const v = (await store.allVerdicts())[0]!;
    expect(v.close7d).toBe(400);
    expect(v.alpha7dPct).toBe(0);
    expect(v.alpha30dPct).toBe(0);
    expect(await measureVerdicts(deps, { today })).toEqual({ measured7: 0, measured30: 0 });
  });
  it("no mide si todavía no pasaron los días", async () => {
    const { store, deps } = setup(null);
    await store.upsertVerdicts([row("2026-09-05")]);
    expect(await measureVerdicts(deps, { today })).toEqual({ measured7: 0, measured30: 0 });
  });
});
