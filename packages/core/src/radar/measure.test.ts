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

  /**
   * 13/9: la pantalla decía "756 apariciones, 756 pendientes de medir". El Radar había empezado seis días
   * antes, así que ninguna medición a 7 días podía existir todavía y ese contador no podía llegar a cero.
   */
  it("distingue lo que espera a que pase el plazo de lo que ya venció sin medirse", () => {
    const s = summarizeRadar([
      // De hoy: le faltan 7 días para poder medirse a 7. No es una deuda.
      { verdict: "COMPRAR", kind: "stock", candidateDate: "2026-09-13", alpha7dPct: null, alpha30dPct: null, alpha90dPct: null },
      // De hace 20 días: la de 7 ya venció y sigue sin medir. Eso sí es un problema.
      { verdict: "COMPRAR", kind: "stock", candidateDate: "2026-08-24", alpha7dPct: null, alpha30dPct: null, alpha90dPct: null },
      // De hace 20 días y ya medida a 7.
      { verdict: "OBSERVAR", kind: "stock", candidateDate: "2026-08-24", alpha7dPct: 1, alpha30dPct: null, alpha90dPct: null },
    ], "2026-09-13");
    expect(s.estado.h7).toEqual({ medidas: 1, esperando: 1, vencidas: 1, primera: "2026-09-20" });
    // A 30 días todavía no venció ninguna: las tres están esperando.
    expect(s.estado.h30).toMatchObject({ medidas: 0, esperando: 3, vencidas: 0 });
  });

  it("sin hoy, todo cuenta como esperando: no se inventa una deuda que no se puede probar", () => {
    const s = summarizeRadar([{ verdict: "COMPRAR", kind: "stock", candidateDate: "2020-01-01", alpha7dPct: null, alpha30dPct: null, alpha90dPct: null }]);
    expect(s.estado.h7.vencidas).toBe(0);
    expect(s.estado.h7.esperando).toBe(1);
  });

  /**
   * Las filas argentinas miden su alpha contra el MERVAL, porque es contra el Merval que se rankean. Iban a
   * caer en la misma tabla rotulada "contra SPY" a partir del 14/9, promediando dos índices en un número.
   */
  it("el alpha contra el Merval no se promedia con el alpha contra el SPY", () => {
    const s = summarizeRadar([
      { verdict: "COMPRAR", kind: "stock", alpha7dPct: 10, alpha30dPct: null, alpha90dPct: null },
      { verdict: "COMPRAR", kind: "ar", alpha7dPct: -40, alpha30dPct: null, alpha90dPct: null },
      { verdict: "COMPRAR", kind: "cedear", alpha7dPct: -20, alpha30dPct: null, alpha90dPct: null },
    ], "2026-09-13");
    expect(s.byVerdict.COMPRAR.h7).toEqual({ n: 1, avgAlpha: 10, hitRate: 1 });
    expect(s.merval.byVerdict.COMPRAR.h7).toEqual({ n: 2, avgAlpha: -30, hitRate: 0 });
    expect(s.merval.filas).toBe(2);
  });
});
