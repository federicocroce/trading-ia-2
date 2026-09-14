import { describe, expect, it } from "vitest";
import { notaVelaParcial, relacionDeLaOrden } from "./niveles";

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
