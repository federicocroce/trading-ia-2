import { describe, expect, it } from "vitest";
import { checkConsistency, summarizeFindings, type Candle, type CandidateRow, type ContributionPlan } from "../index.js";

/**
 * Cada caso de acá abajo es un error que de verdad pasó y que ni los tests ni el typecheck atraparon.
 * Si alguno deja de fallar sin que se haya arreglado la causa, el chequeo dejó de servir.
 */
const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1_000 });

const fila = (over: Partial<CandidateRow> & { symbol: string }): CandidateRow => ({
  candidateDate: "2026-09-11", kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: [], rankInGroup: null, groupSize: null,
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 118, sizeUsd: null, sizeQty: null, riskScore: 3, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  entry: { state: "en_zona", level: 102, levelLabel: "hasta 2% sobre el precio", low: 100, high: 102, validSessions: 15, sma20: 99, sma50: 95, atr14: 2, extensionAtr: 0.5, rangePct60: 60, why: "ni extendida ni floja" },
  ...over,
});

const plan = (lines: ContributionPlan["lines"]): ContributionPlan => ({ month: "2026-09", totalUsd: 40_000, lines, notes: [] });
type Linea = ContributionPlan["lines"][number];
const linea = (over: Partial<Linea> & { symbol: string }): Linea =>
  ({ kind: "comprar", amountUsd: 4_000, rationale: "por convicción", close: 100, alpha30dPct: null, alpha90dPct: null, stop: 92, ...over } as Linea);

const solo = (check: string, f: ReturnType<typeof checkConsistency>) => f.filter((x) => x.check === check);

describe("checkConsistency", () => {
  it("una corrida sana no reporta nada", () => {
    const f = checkConsistency({ rows: [fila({ symbol: "NVDA" })], candles: { NVDA: [vela("2026-09-11", 100)] }, plan: plan([linea({ symbol: "NVDA" })]) });
    expect(f).toEqual([]);
    expect(summarizeFindings(f)).toEqual({ graves: 0, avisos: 0, total: 0 });
  });

  it("APH del 11/9: la fila guardó el piso de la franja en la columna del precio", () => {
    const f = solo("precio_guardado", checkConsistency({
      rows: [fila({ symbol: "APH", close: 84, entryLow: 84, entryHigh: 85.68 })],
      candles: { APH: [vela("2026-09-10", 80.25)] },
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("80.25");
  });

  it("META del 11/9: la verificación dice con reservas y las banderas no la muestran", () => {
    const f = solo("verificacion_sin_bandera", checkConsistency({
      rows: [fila({ symbol: "META", kind: "watch", flags: [], verification: { date: "2026-09-11", verdict: "con_reservas", reason: "litigios de privacidad" } })],
      candles: {},
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("no está restando convicción");
  });

  it("con la bandera puesta, la misma fila no reporta nada", () => {
    const f = solo("verificacion_sin_bandera", checkConsistency({
      rows: [fila({ symbol: "META", flags: ["verificacion_reservas"], verification: { date: "2026-09-11", verdict: "con_reservas", reason: "litigios" } })],
      candles: {},
      plan: null,
    }));
    expect(f).toEqual([]);
  });

  it("dos banderas de verificación a la vez es contradicción", () => {
    const f = solo("verificacion_duplicada", checkConsistency({
      rows: [fila({ symbol: "X", flags: ["verificacion_apta", "verificacion_reservas"], verification: { date: "2026-09-11", verdict: "apto", reason: "ok" } })],
      candles: {}, plan: null,
    }));
    expect(f).toHaveLength(1);
  });

  it("la franja de compra al revés se reporta", () => {
    const f = solo("franja_invertida", checkConsistency({ rows: [fila({ symbol: "X", entryLow: 110, entryHigh: 100 })], candles: {}, plan: null }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("APH del 10/9: objetivos de analistas de antes del split 2:1 dan un potencial inventado", () => {
    const f = solo("objetivo_fuera_de_escala", checkConsistency({
      rows: [fila({ symbol: "APH", close: 81, analystTargets: { n: 12, median: 196, min: 175, max: 215, latestDate: "2026-08-20" } })],
      candles: {}, plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("split");
  });

  it("SGOV del 11/9: una línea que no es núcleo y no tiene stop es plata que entra y no sale", () => {
    const f = solo("linea_sin_salida", checkConsistency({
      rows: [], candles: {},
      plan: plan([linea({ symbol: "SGOV", kind: "comprar", stop: null })]),
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("el núcleo sin stop es correcto y no se reporta", () => {
    const f = solo("linea_sin_salida", checkConsistency({ rows: [], candles: {}, plan: plan([linea({ symbol: "VTI", kind: "nucleo", stop: null })]) }));
    expect(f).toEqual([]);
  });

  it("el plan no puede comprar algo que el Radar de hoy tiene en OBSERVAR", () => {
    const f = solo("plan_contra_veredicto", checkConsistency({
      rows: [fila({ symbol: "HRTG", verdict: "OBSERVAR" })],
      candles: {},
      plan: plan([linea({ symbol: "HRTG" })]),
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("un COMPRAR sin momento de entrada no puede decir cuándo entrar", () => {
    const f = solo("compra_sin_momento", checkConsistency({ rows: [fila({ symbol: "X", entry: null })], candles: {}, plan: null }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("aviso");
  });

  it("cuenta graves y avisos por separado", () => {
    const f = checkConsistency({
      rows: [fila({ symbol: "A", entryLow: 110, entryHigh: 100 }), fila({ symbol: "B", entry: null })],
      candles: {}, plan: null,
    });
    expect(summarizeFindings(f)).toEqual({ graves: 1, avisos: 1, total: 2 });
  });
});
