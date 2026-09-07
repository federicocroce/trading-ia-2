import { describe, expect, it } from "vitest";
import { computeTarget, computeTrailingStop, type Candle } from "./index.js";

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

describe("computeTarget (RR 2:1)", () => {
  it("close + 2 × (close − stop)", () => expect(computeTarget(100, 95)).toBe(110));
  it("null sin stop", () => expect(computeTarget(100, null)).toBeNull());
});
