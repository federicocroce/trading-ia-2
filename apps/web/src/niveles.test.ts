import { describe, expect, it } from "vitest";
import { baseDelDia, cambioDelPeriodo, notaVelaParcial, relacionDeLaOrden } from "./niveles";

describe("relacionDeLaOrden", () => {
  it("APH el 14/9: la ficha decía 18,0 a 1 midiendo desde el precio en vivo (79,04, a 1,6% del stop); la orden del Radar es 2 a 1 desde el techo", () => {
    const r = relacionDeLaOrden({ stop: 77.81, target: 101.18, price: 79.04, entryHigh: 85.6, desde: "Radar" })!;
    expect(r.ratio).toBeCloseTo(2, 1);
    expect(r.base).toBe(85.6);
    expect(r.texto).toBe("relación 2,0 : 1 desde el techo de compra 85,60, como en el Radar");
  });
  it("con posición (Cartera) sí se mide desde el precio actual: es lo que queda por ganar y por perder desde hoy", () => {
    const r = relacionDeLaOrden({ stop: 199.06, target: 269.86, price: 212.16, entryHigh: 222.66, desde: "Cartera" })!;
    expect(r.base).toBe(212.16);
    expect(r.texto).toBe(`relación ${((269.86 - 212.16) / (212.16 - 199.06)).toFixed(1).replace(".", ",")} : 1 desde el precio actual`);
  });
  it("sin techo de compra, el Radar también mide desde el precio; sin stop u objetivo del lado correcto, no hay relación", () => {
    expect(relacionDeLaOrden({ stop: 90, target: 120, price: 100, entryHigh: null, desde: "Radar" })!.base).toBe(100);
    expect(relacionDeLaOrden({ stop: 101, target: 120, price: 100, entryHigh: null, desde: "Radar" })).toBeNull();
    expect(relacionDeLaOrden({ stop: 90, target: null, price: 100, entryHigh: 102, desde: "Radar" })).toBeNull();
  });
});

describe("cambioDelPeriodo (C6, 15/9)", () => {
  const dia = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  // APH, velas reales de la base: 14/8 (apertura 82,825, cierre 83,555), 17/8 (apertura 83,975, cierre 85,435) … 14/9 (78,55).
  const aph = [
    { time: dia("2026-08-13"), open: 82.1, close: 82.7 },
    { time: dia("2026-08-14"), open: 82.825, close: 83.555 },
    { time: dia("2026-08-17"), open: 83.975, close: 85.435 },
    { time: dia("2026-09-11"), open: 82.42, close: 83.92 },
    { time: dia("2026-09-14"), open: 81.2, close: 78.55 },
  ];
  const ahora = dia("2026-09-15T19:00:00Z");
  it("APH el 15/9: \"1M −7,22%\" se medía desde la APERTURA del 17/8 sin decirlo; ahora es cierre contra cierre, desde el del 14/8, y lo dice", () => {
    const p = cambioDelPeriodo({ bars: aph, desde: ahora - 30 * 86_400, precio: 77.912, label: "1M", intradiario: false })!;
    expect(p.base).toBe(83.555);
    expect(p.baseTexto).toBe("desde el cierre del 14/8");
    expect(p.changePercent).toBeCloseTo(((77.912 - 83.555) / 83.555) * 100, 6);
    expect(p.label).toBe("1M");
  });
  it("sin vela anterior a la ventana (1A, 5A), la base es el cierre de la primera", () => {
    const p = cambioDelPeriodo({ bars: aph, desde: null, precio: null, label: "1A", intradiario: false })!;
    expect(p.base).toBe(82.7);
    expect(p.baseTexto).toBe("desde el cierre del 13/8");
    expect(p.changePercent).toBeCloseTo(((78.55 - 82.7) / 82.7) * 100, 6);
  });
  it("intradiario (1D, 1S): desde la apertura de la primera barra, con fecha y hora de Argentina", () => {
    const barras = [{ time: dia("2026-09-15T13:30:00Z"), open: 78.59, close: 78.3 }, { time: dia("2026-09-15T19:00:00Z"), open: 77.6, close: 77.52 }];
    const p = cambioDelPeriodo({ bars: barras, desde: null, precio: 77.52, label: "1D", intradiario: true })!;
    expect(p.base).toBe(78.59);
    expect(p.baseTexto).toBe("desde la apertura del 15/9 a las 10:30");
  });
  it("con menos de dos velas no hay cambio", () => {
    expect(cambioDelPeriodo({ bars: aph.slice(0, 1), desde: null, precio: 80, label: "1M", intradiario: false })).toBeNull();
  });
});

describe("baseDelDia (C6, 15/9)", () => {
  it("TSM: el cambio del día dice contra qué cierre se mide (el guardado del 14/9, el mismo de las velas)", () => {
    expect(baseDelDia("2026-09-14")).toBe("contra el cierre del 14/9");
  });
  it("sin cierre guardado de la sesión anterior, dice que es el de la fuente", () => {
    expect(baseDelDia(null)).toBe("contra el cierre previo de la fuente (todavía no guardado)");
    expect(baseDelDia(undefined)).toBe("contra el cierre previo de la fuente (todavía no guardado)");
  });
});

describe("notaVelaParcial", () => {
  const dia = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  it("si la última vela es la sesión armada con el intradiario, lo dice con su fecha", () => {
    const nota = notaVelaParcial([{ time: dia("2026-09-11"), partial: false }, { time: dia("2026-09-14"), partial: true }]);
    expect(nota).toContain("14/9");
    expect(nota).toContain("todavía no cerró");
  });
  it("sin vela parcial, no hay nota", () => {
    expect(notaVelaParcial([{ time: dia("2026-09-11") }])).toBeNull();
    expect(notaVelaParcial([])).toBeNull();
  });
});
