import { describe, expect, it } from "vitest";
import type { EntryTiming, PlanLine } from "./api";
import { baseCandidata, baseLinea, entrySentence, entryVerb, pctDesde, qtyLinea, riesgoLinea, tramoLinea } from "./orden";

/**
 * Auditoría del 15/9: "una orden, una base". En la misma fila del Radar, el % al stop se medía desde el cierre y el
 * % al objetivo desde el techo de la franja: APH mostraba stop −1,1% y objetivo +19,7%, una relación de 18 a 1 que no
 * existía. La cantidad del plan se contaba al cierre y el objetivo desde el techo. Ahora todo sale de una sola base.
 */
describe("una orden, una base", () => {
  // BLBD el 15/9: cierre 62,41, franja 64,60–65,89 (esperar confirmación), stop 59,29, objetivo 79,09.
  const blbd = { close: 62.41, entryHigh: 65.89, stop: 59.29, target: 79.09 };

  it("sin posición: stop y objetivo desde el techo de la franja, y la relación que se ve es la de la operación (2 a 1)", () => {
    const b = baseCandidata(blbd, false);
    expect(b.price).toBe(65.89);
    expect(b.label).toMatch(/techo de la franja \(65\.89\)/);
    const stop = pctDesde(blbd.stop, b)!;
    const objetivo = pctDesde(blbd.target, b)!;
    expect(objetivo / -stop).toBeCloseTo(2, 2);
  });

  it("con posición: desde el precio de hoy, y el texto lo dice", () => {
    const b = baseCandidata(blbd, true);
    expect(b.price).toBe(62.41);
    expect(b.label).toMatch(/ya la tenés/);
  });

  it("línea del plan: cantidad, riesgo y primer tramo salen del precio de la orden que manda el plan", () => {
    const l: PlanLine = { symbol: "BLBD", kind: "comprar", amountUsd: 6_000, rationale: "", close: 62.41, alpha30dPct: null, alpha90dPct: null, entryHigh: 65.89, stop: 59.29, orderPrice: 65.89, qty: 91, trancheUsd: 2_000, trancheQty: 30 };
    expect(baseLinea(l).price).toBe(65.89);
    expect(qtyLinea(l)).toBe(91);
    expect(riesgoLinea(l)).toBeCloseTo(91 * (65.89 - 59.29), 2);
    expect(tramoLinea(l, 3)).toEqual({ usd: 2_000, qty: 30 });
    expect(tramoLinea(l, 1)).toBeNull();
  });

  it("un plan guardado antes del 15/9 (sin precio de la orden) usa la misma base que usaría el plan", () => {
    const vieja: PlanLine = { symbol: "BLBD", kind: "comprar", amountUsd: 6_000, rationale: "", close: 62.41, alpha30dPct: null, alpha90dPct: null, entryHigh: 65.89, stop: 59.29 };
    expect(baseLinea(vieja).price).toBe(65.89);
    expect(qtyLinea(vieja)).toBe(Math.floor(6_000 / 65.89));
    expect(tramoLinea(vieja, 3)).toEqual({ usd: 2_000, qty: Math.floor(2_000 / 65.89) });
    const vti: PlanLine = { symbol: "VTI", kind: "nucleo", amountUsd: 24_000, rationale: "", close: 300, alpha30dPct: null, alpha90dPct: null };
    expect(baseLinea(vti).price).toBe(300);
    expect(baseLinea(vti).label).toMatch(/precio de hoy/);
    // El núcleo no tiene stop: no suma riesgo.
    expect(riesgoLinea(vti)).toBe(0);
  });
});

describe("cuándo entrar, subordinado al plan", () => {
  const zona: EntryTiming = { state: "en_zona", level: 102, levelLabel: "hasta 2% sobre el precio", low: 100, high: 102, validSessions: 15, sma20: 98, sma50: 95, atr14: 2, extensionAtr: 0.5, rangePct60: 60, why: "ni extendida ni floja" };

  it("SNDK el 15/9: en zona, pero el plan no la compra → no dice 'comprar ahora' en verde", () => {
    expect(entryVerb(zona, false)).toEqual({ text: "en zona", tone: "muted" });
    expect(entrySentence(zona, false)).not.toMatch(/comprar ahora/i);
    expect(entrySentence(zona, false)).toMatch(/el plan de hoy no la compra/);
    expect(entryVerb(zona, true)).toEqual({ text: "comprar ahora", tone: "ok" });
    expect(entrySentence(zona, true)).toMatch(/^Comprar ahora, entre 100\.00 y 102\.00/);
  });

  it("esperar confirmación: se compra si cierra arriba del nivel; nunca una orden limitada, que se ejecutaría al instante", () => {
    const conf: EntryTiming = { ...zona, state: "esperar_confirmacion", level: 58.6, low: 58.6, high: 59.77, why: "cerró bajo su media de 50 (60): esperá un cierre arriba de 58.6 antes de comprar" };
    expect(entrySentence(conf, true)).toMatch(/si cierra arriba de 58\.60/);
    expect(entrySentence(conf, true)).not.toMatch(/orden limitada en|orden de compra recién/i);
    expect(entryVerb(conf, true).text).toBe("si cierra arriba de");
  });

  it("esperar retroceso: orden limitada en el nivel", () => {
    const ret: EntryTiming = { ...zona, state: "esperar_retroceso", level: 82.79, low: 81.96, high: 82.79, why: "está 2 ATR arriba de su media de 20: comprar acá es pagar el envión. Orden limitada en 82.79" };
    expect(entrySentence(ret, true)).toMatch(/orden limitada en 82\.79/i);
    expect(entryVerb(ret, true)).toEqual({ text: "esperar", tone: "warn" });
  });
});
