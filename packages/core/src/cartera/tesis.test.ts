import { describe, expect, it } from "vitest";
import { decideVerb, tesisAlerts, type Candle } from "../index.js";

const serie = (closes: number[]): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse("2026-05-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
/** Tendencia alcista sana: el precio queda cómodo arriba del stop, así que el veredicto lo decide la tesis. */
const alcista = serie(Array.from({ length: 40 }, (_, i) => 100 + i));
const hoy = alcista[alcista.length - 1]!.date;
const base = { candles: alcista, spot: null, avgCost: 90, layer: "riesgo" as const, weightPct: 5, positionsCount: 10, today: hoy };

describe("tesisAlerts", () => {
  it("sin evidencia no avisa nada", () => {
    expect(tesisAlerts({})).toEqual([]);
  });

  it("la verificación web que dice evitar es motivo de revisión", () => {
    const a = tesisAlerts({ verification: { date: "2026-09-10", verdict: "evitar", reason: "ganancia única de una fusión" } });
    expect(a.map((x) => x.kind)).toEqual(["verificacion_evitar"]);
    expect(a[0]!.detail).toContain("fusión");
  });

  it("un evento grave de los últimos 90 días también", () => {
    const a = tesisAlerts({ events: [{ date: "2026-08-20", kind: "regulatorio", severity: "grave", headline: "La FDA rechaza la solicitud" }] });
    expect(a[0]!.kind).toBe("evento_grave");
    expect(a[0]!.detail).toContain("FDA");
  });

  it("un evento de ruido no molesta", () => {
    expect(tesisAlerts({ events: [{ date: "2026-08-20", kind: "analista", severity: "ruido", headline: "resumen de mercado" }] })).toEqual([]);
  });

  it("dos salvedades de calidad de la ganancia, el mismo umbral que para comprar", () => {
    expect(tesisAlerts({ qualityFlags: ["resultado_extraordinario"] })).toEqual([]);
    expect(tesisAlerts({ qualityFlags: ["resultado_extraordinario", "interes_minoritario"] })[0]!.kind).toBe("salvedades_de_calidad");
  });

  it("el consenso pasado a vender", () => {
    expect(tesisAlerts({ analyst: { strongBuy: 0, buy: 1, hold: 2, sell: 3, strongSell: 2 } })[0]!.kind).toBe("consenso_venta");
    expect(tesisAlerts({ analyst: { strongBuy: 5, buy: 5, hold: 2, sell: 0, strongSell: 0 } })).toEqual([]);
  });
});

describe("decideVerb con la tesis", () => {
  it("sin evidencia se comporta igual que siempre", () => {
    const v = decideVerb(base);
    expect(["MANTENER", "SUMAR"]).toContain(v.verb);
    expect(v.tesisAlerts).toBeUndefined();
  });

  it("con el negocio cambiado pasa a REVISAR aunque el precio aguante", () => {
    const v = decideVerb({ ...base, tesis: { verification: { date: "2026-09-10", verdict: "evitar", reason: "ganancia única" } } });
    expect(v.verb).toBe("REVISAR");
    expect(v.reason).toContain("cambió algo del negocio");
    expect(v.tesisAlerts!.map((a) => a.kind)).toEqual(["verificacion_evitar"]);
  });

  it("si por precio calificaba para sumar, avisa que no sume hasta resolverlo", () => {
    // Subida suave: pesa poco, está arriba del stop y no subió más de 15% en 21 ruedas, así que calificaba.
    const suave = serie(Array.from({ length: 40 }, (_, i) => 100 + i * 0.3));
    const conSumar = { ...base, candles: suave, today: suave[suave.length - 1]!.date, weightPct: 1 };
    expect(decideVerb(conSumar).verb).toBe("SUMAR");
    const v = decideVerb({ ...conSumar, tesis: { qualityFlags: ["resultado_extraordinario", "cobranza_lenta"] } });
    expect(v.verb).toBe("REVISAR");
    expect(v.warning).toContain("No sumes");
  });

  it("la tesis NUNCA vende sola: el stop sigue siendo la única regla dura de salida", () => {
    // Serie que cae bajo el stop: manda el stop, no la tesis, y el verbo es VENDER.
    const cae = serie([...Array.from({ length: 35 }, (_, i) => 100 + i), 128, 120, 112, 105, 100]);
    const v = decideVerb({ ...base, candles: cae, today: cae[cae.length - 1]!.date, tesis: { verification: { date: "2026-09-10", verdict: "evitar", reason: "x" } } });
    expect(v.verb).toBe("VENDER");
  });

  it("una posición de núcleo bajo el stop sigue sin venderse, la tesis no cambia esa regla", () => {
    const cae = serie([...Array.from({ length: 35 }, (_, i) => 100 + i), 128, 120, 112, 105, 100]);
    const v = decideVerb({ ...base, candles: cae, today: cae[cae.length - 1]!.date, layer: "nucleo", tesis: { verification: { date: "2026-09-10", verdict: "evitar", reason: "x" } } });
    expect(v.verb).toBe("MANTENER");
  });
});

describe("sin doble punto (auditoría del 15/9)", () => {
  it("HUT: el motivo de la verificación termina en punto y Hoy decía 'inciertas.. Revisá si'", () => {
    const a = tesisAlerts({ verification: { date: "2026-09-12", verdict: "con_reservas", reason: "las ganancias futuras son inciertas." } });
    expect(a[0]!.detail).toBe("la verificación web del 2026-09-12 tiene reservas: las ganancias futuras son inciertas");
  });
});

