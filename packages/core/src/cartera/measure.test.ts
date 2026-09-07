import { describe, expect, it } from "vitest";
import { alphaPct, summarizeMeasurement, verdictHit } from "./index.js";

describe("alphaPct", () => {
  it("retorno del papel menos retorno de SPY, en %", () => {
    expect(alphaPct(100, 110, 100, 105)).toBeCloseTo(5, 6);
    expect(alphaPct(100, 95, 100, 100)).toBeCloseTo(-5, 6);
  });
});
describe("verdictHit", () => {
  it("VENDER acierta con alpha < 0; MANTENER/SUMAR con alpha > 0; REVISAR no se puntúa", () => {
    expect(verdictHit("VENDER", -3)).toBe(true);
    expect(verdictHit("VENDER", 2)).toBe(false);
    expect(verdictHit("MANTENER", 2)).toBe(true);
    expect(verdictHit("SUMAR", -1)).toBe(false);
    expect(verdictHit("REVISAR", 5)).toBeNull();
  });
});
describe("summarizeMeasurement", () => {
  it("agrega por verbo y horizonte; cuenta pendientes", () => {
    const s = summarizeMeasurement([
      { verb: "MANTENER", alpha7dPct: 2, alpha30dPct: null },
      { verb: "MANTENER", alpha7dPct: -4, alpha30dPct: 6 },
      { verb: "VENDER", alpha7dPct: -1, alpha30dPct: -2 },
      { verb: "REVISAR", alpha7dPct: 9, alpha30dPct: 9 },
      { verb: "SUMAR", alpha7dPct: null, alpha30dPct: null },
    ]);
    expect(s.byVerb.MANTENER.h7).toEqual({ n: 2, hitRate: 0.5, avgAlpha: -1 });
    expect(s.byVerb.MANTENER.h30).toEqual({ n: 1, hitRate: 1, avgAlpha: 6 });
    expect(s.byVerb.VENDER.h7).toEqual({ n: 1, hitRate: 1, avgAlpha: -1 });
    expect(s.byVerb.REVISAR.h7).toEqual({ n: 1, hitRate: null, avgAlpha: 9 });
    expect(s.byVerb.SUMAR.h7).toEqual({ n: 0, hitRate: null, avgAlpha: null });
    expect(s.pending).toBe(2);
  });
});
