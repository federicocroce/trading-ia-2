import { describe, expect, it } from "vitest";
import { computeTarget, computeTrailingStop, decideVerb, ENTRY_STOP_ATR, entryStop, holdTargetOf, type Candle } from "./index.js";

/** 30 velas planas en 100 con rango diario 2 (high 101, low 99): ATR = 2. */
const flat = (n: number, close = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 }));

describe("computeTrailingStop (chandelier 22/3)", () => {
  it("máximo de 22 velas menos 3 × ATR", () => {
    expect(computeTrailingStop(flat(30))).toBe(101 - 3 * 2); // 95
  });
  it("sube con nuevos máximos, no baja", () => {
    const c = flat(30);
    c[29] = { ...c[29]!, high: 111, close: 110 };
    // highest high 111; ATR incluye TR de la última vela: max(111-99, |111-100|, |99-100|) = 12 -> ATR = (21*2 + 12)/22
    const atr = (21 * 2 + 12) / 22;
    expect(computeTrailingStop(c)).toBeCloseTo(111 - 3 * atr, 2);
  });
  it("null con menos de 23 velas", () => {
    expect(computeTrailingStop(flat(22))).toBeNull();
  });
});

describe("entryStop (stop de una compra nueva, 2026-09-13)", () => {
  /*
   * NVDA el 13/9: cierre 218,29, stop de seguimiento 214,89 (0,44 ATR). Con 2 años de velas, un stop a esa
   * distancia se tocó en las 5 ruedas siguientes el 71% de las veces. Acá: un pico de 105 dentro de las
   * últimas 22 ruedas deja el de seguimiento en ~98,45 con el precio en 100, o sea dentro del ruido.
   */
  const pullback = (): Candle[] => {
    const c = flat(30);
    c[20] = { ...c[20]!, high: 105 };
    return c;
  };
  it("después de un retroceso, el piso de la franja menos 2,5 ATR14", () => {
    const c = pullback();
    expect(computeTrailingStop(c)).toBeGreaterThan(98);
    const atr14 = (13 * 2 + 6) / 14;
    expect(entryStop(c, 100)).toBeCloseTo(100 - ENTRY_STOP_ATR * atr14, 2);
  });
  it("si el de seguimiento ya está más abajo, queda el de seguimiento", () => {
    // Plana: seguimiento 95; piso de franja 104 → 104 − 5 = 99. Manda el más bajo.
    expect(entryStop(flat(30), 104)).toBe(95);
  });
  it("null con menos de 23 velas", () => {
    expect(entryStop(flat(22), 100)).toBeNull();
  });
});

describe("computeTarget (RR 2:1)", () => {
  it("close + 2 × (close − stop)", () => expect(computeTarget(100, 95)).toBe(110));
  it("null sin stop", () => expect(computeTarget(100, null)).toBeNull());
});

/**
 * 15/9: el plan relabeló a TSM como MANTENER y Cartera seguía mostrando el objetivo de SUMAR, 533,92, medido desde
 * el techo de la franja de compra (453,18). Lo que ya tenés se mide desde el cierre, no desde un precio que no pagaste.
 */
describe("holdTargetOf (objetivo de la posición)", () => {
  it("TSM del 15/9: 418,01 + 2 × (418,01 − 412,81) = 428,41, no el 533,92 de la compra", () => {
    expect(holdTargetOf({ close: 418.01, stop: 412.81 })).toBe(428.41);
  });
  it("sin stop no hay objetivo", () => expect(holdTargetOf({ close: 418.01, stop: null })).toBeNull());
  it("un veredicto que no es SUMAR ya trae este mismo objetivo: una sola cuenta", () => {
    const v = decideVerb({ candles: flat(30), spot: 100, avgCost: 80, layer: "riesgo", weightPct: 20, positionsCount: 5, today: "2026-01-31" });
    expect(v.verb).toBe("MANTENER");
    expect(v.target).toBe(holdTargetOf(v));
    const sumar = decideVerb({ candles: flat(30), spot: 100, avgCost: 80, layer: "riesgo", weightPct: 10, positionsCount: 5, today: "2026-01-31" });
    expect(sumar.verb).toBe("SUMAR");
    expect(sumar.target).not.toBe(holdTargetOf(sumar));
    expect(holdTargetOf(sumar)).toBe(110);
  });
});
