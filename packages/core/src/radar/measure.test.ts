import { describe, expect, it } from "vitest";
import { summarizeRadar } from "../index.js";

describe("summarizeRadar", () => {
  it("por verdict y horizonte, más COMPRAR − OBSERVAR y pendientes", () => {
    const s = summarizeRadar([
      { verdict: "COMPRAR", kind: "stock", alpha7dPct: 2, alpha30dPct: 5, alpha90dPct: null },
      { verdict: "COMPRAR", kind: "stock", alpha7dPct: -1, alpha30dPct: 3, alpha90dPct: null },
      { verdict: "OBSERVAR", kind: "stock", alpha7dPct: 1, alpha30dPct: 1, alpha90dPct: null },
      { verdict: "OBSERVAR", kind: "stock", alpha7dPct: null, alpha30dPct: -3, alpha90dPct: null },
      { verdict: "NUCLEO", kind: "etf", alpha7dPct: 0.5, alpha30dPct: null, alpha90dPct: null },
    ]);
    expect(s.byVerdict.COMPRAR.h30).toEqual({ n: 2, avgAlpha: 4, hitRate: 1 });
    expect(s.byVerdict.OBSERVAR.h30).toEqual({ n: 2, avgAlpha: -1, hitRate: null });
    expect(s.comprarVsObservar.h30).toEqual({ diff: 5, nComprar: 2, nObservar: 2 });
    expect(s.comprarVsObservar.h90).toEqual({ diff: null, nComprar: 0, nObservar: 0 });
    expect(s.pending).toBe(5);
  });
});
