import { describe, expect, it } from "vitest";
import { computeTarget, computeTrailingStop, decideVerb, ENTRY_STOP_ATR, entryStop, holdTargetOf, ratchetStop, type Candle } from "./index.js";

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
  /*
   * 6/10/2026. Con el precio BAJO el stop, `cierre + 2 × (cierre − stop)` da un número por DEBAJO del precio y
   * la columna "objetivo" de Cartera publicaba un objetivo de baja. El 6/10 pasaba en 6 de las 8 posiciones:
   * VIST mostraba objetivo 56,70 con el papel en 66,54 y +49% de ganancia; GGAL 31,69 con el papel en 38,25.
   *
   * No es un número a corregir: es que la operación no se puede plantear. Si el precio ya está abajo del stop
   * no hay "dos veces el riesgo hasta el stop" que medir. La misma guarda existe en `decideArStock` desde el
   * 12/9 ("la pantalla publica un boleto imposible: comprar a 264 para vender a 261,90") y acá faltaba.
   */
  it("con el precio bajo el stop no hay objetivo: VIST del 6/10 (64,25 con stop 71,22) daba 50,31", () => {
    expect(holdTargetOf({ close: 64.25, stop: 71.22 })).toBeNull();
  });
  it("justo en el stop tampoco: el objetivo sería el precio mismo", () => {
    expect(holdTargetOf({ close: 100, stop: 100 })).toBeNull();
  });
  it("arriba del stop el objetivo sigue saliendo igual", () => {
    expect(holdTargetOf({ close: 100, stop: 95 })).toBe(110);
  });
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

describe("ratchetStop (el stop de seguimiento de una posición nunca baja, 2026-10-06)", () => {
  /*
   * El chandelier es el máximo de 22 velas menos 3 × ATR: una ventana móvil, sin memoria. Cuando un máximo
   * sale de la ventana, el stop BAJA sin que el precio haya hecho nada. El docstring de computeTrailingStop
   * decía "nunca baja" y nada en la función lo garantizaba.
   *
   * Caso real: GGAL del 5 al 6/10/2026, el stop pasó de 41,75 a 41,53 cuando el máximo de septiembre (46,09)
   * se cayó de la ventana. Medido sobre las 8 posiciones del dueño y 64 ruedas, el stop bajó en 236 de 512
   * transiciones: 46,1% (YPF 54,7%, HUT 51,6%, GGAL 50,0%).
   *
   * Lo que rompía la confianza: con el precio de GGAL congelado en 38,25 el stop llegaba a 37,87 en 10 ruedas
   * y el VENDER se daba vuelta solo, sin que la posición mejorara.
   */
  it("mantiene el stop anterior cuando el chandelier baja", () => {
    expect(ratchetStop(41.53, 41.75)).toBe(41.75);
  });
  it("sube cuando el chandelier hace un máximo nuevo", () => {
    expect(ratchetStop(42.1, 41.75)).toBe(42.1);
  });
  it("sin stop anterior, manda el chandelier: el primer día de una posición no tiene de dónde trincar", () => {
    expect(ratchetStop(41.53, null)).toBe(41.53);
  });
  it("sin velas para calcular no reutiliza el anterior: un problema de datos tiene que decirse, no taparse", () => {
    expect(ratchetStop(null, 41.75)).toBeNull();
  });
});

describe("decideVerb con el stop trincado", () => {
  /*
   * La prueba que importa de verdad: el veredicto no puede darse vuelta solo porque el stop decayó.
   * Velas planas en 100 → chandelier 95. Precio 94, o sea bajo el stop: VENDER. Si mañana el chandelier
   * cae a 93 porque un máximo salió de la ventana, sin el trinquete el mismo precio pasa a MANTENER.
   */
  const bajoStop = (): Candle[] => {
    const c = flat(30);
    c[29] = { ...c[29]!, close: 94, high: 94, low: 93 };
    return c;
  };
  it("sigue siendo VENDER cuando el chandelier cae abajo del precio pero el stop anterior estaba arriba", () => {
    const i = { candles: bajoStop(), spot: 94, avgCost: 80, layer: "riesgo" as const, weightPct: 20, positionsCount: 5, today: "2026-01-30" };
    const sinTrinquete = decideVerb(i);
    expect(sinTrinquete.verb).toBe("VENDER");
    // El mismo precio con un stop anterior más alto sigue siendo VENDER, y con el stop anterior.
    const conTrinquete = decideVerb({ ...i, prevStop: 99 });
    expect(conTrinquete.stop).toBe(99);
    expect(conTrinquete.verb).toBe("VENDER");
  });
  it("un stop anterior más bajo no pisa al calculado", () => {
    const v = decideVerb({ candles: flat(30), spot: 100, avgCost: 80, layer: "riesgo", weightPct: 20, positionsCount: 5, today: "2026-01-31", prevStop: 90 });
    expect(v.stop).toBe(95);
  });
});
