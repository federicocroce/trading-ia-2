import { describe, expect, it } from "vitest";
import { CONVICCION_MINIMO_SIMBOLOS, medirConviccion } from "./medir-conviccion.js";
import type { CandidateRow, Tags } from "./types.js";

/*
 * 8/10: el plan elige las primeras N COMPRAR por convicción y deja el resto con el motivo "tope de N posiciones
 * nuevas" — 46 de 70 el 8/10. Si la convicción discrimina, concentrar está bien; si no, es precisión falsa y
 * conviene repartir. Esto lo mide.
 */
const fila = (symbol: string, candidateDate: string, score: number, alpha7dPct: number | null, over: Partial<CandidateRow> = {}): CandidateRow => ({
  candidateDate, symbol, kind: "stock", verdict: "COMPRAR", score, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
  close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 1000, sizeQty: 10, riskScore: 3, flags: [],
  nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null,
  spyClose: 500, close7d: null, spy7d: null, alpha7dPct, close30d: null, spy30d: null, alpha30dPct: null,
  close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, ...over,
});
const tags: Record<string, Tags> = {};

describe("medirConviccion", () => {
  it("parte por puesto RELATIVO del día y promedia el alfa de cada tramo", () => {
    // Cuatro COMPRAR en un día: puntajes decrecientes, alfa decreciente igual. Dos tramos.
    const filas = [
      fila("A", "2026-09-07", 1.4, 10), fila("B", "2026-09-07", 1.2, 8),
      fila("C", "2026-09-07", 0.8, -4), fila("D", "2026-09-07", 0.6, -6),
    ];
    const r = medirConviccion(filas, tags, 7, 2);
    expect(r.tramos).toHaveLength(2);
    expect(r.tramos[0]!.filas).toBe(2);
    expect(r.tramos[0]!.alfaProm).toBe(9);
    expect(r.tramos[1]!.alfaProm).toBe(-5);
    expect(r.tramos[0]!.pocosSimbolos).toBe(true); // 2 símbolos: lo dice
  });

  it("un día con muchas y otro con pocas se comparan por quinto, no por puesto absoluto", () => {
    // Día 1: 10 filas. Día 2: 2 filas. El primer tramo de cada día es su propio primer quinto.
    const d1 = Array.from({ length: 10 }, (_, i) => fila(`X${i}`, "2026-09-07", 2 - i * 0.1, 1));
    const d2 = [fila("Y0", "2026-09-08", 2, 1), fila("Y1", "2026-09-08", 1.9, 1)];
    const r = medirConviccion([...d1, ...d2], tags, 7, 5);
    expect(r.fechas).toBe(2);
    // 12 observaciones repartidas; ningún tramo se come todo.
    expect(r.tramos.reduce((a, t) => a + t.filas, 0)).toBe(12);
    expect(r.tramos.every((t) => t.filas > 0)).toBe(true);
  });

  it("una fila sin alfa a ese horizonte se cuenta aparte y no inventa un promedio", () => {
    const r = medirConviccion([fila("A", "2026-09-07", 1.4, null)], tags, 7, 2);
    expect(r.sinMedir).toBe(1);
    expect(r.tramos).toEqual([]);
  });

  it("solo mira COMPRAR de acciones: OBSERVAR y ETFs no entran", () => {
    const r = medirConviccion([
      fila("A", "2026-09-07", 1.4, 10),
      fila("B", "2026-09-07", 1.3, 99, { verdict: "OBSERVAR" }),
      fila("C", "2026-09-07", 1.2, 99, { kind: "etf" }),
    ], tags, 7, 1);
    expect(r.tramos[0]!.filas).toBe(1);
    expect(r.tramos[0]!.alfaProm).toBe(10);
  });

  it("la barra de ruido está declarada", () => {
    expect(CONVICCION_MINIMO_SIMBOLOS).toBeGreaterThanOrEqual(10);
  });
});
