import { describe, expect, it } from "vitest";
import { ArgentinaMacro, parseDolares, parseRiesgoPais } from "./index.js";

const dolares = [
  { casa: "oficial", compra: 1480, venta: 1530, fechaActualizacion: "2026-09-07T18:00:00.000Z" },
  { casa: "blue", compra: 1525, venta: 1545 },
  { casa: "bolsa", compra: 1518.9, venta: 1533.7 },
  { casa: "contadoconliqui", compra: 1582, venta: 1583.2 },
  { casa: "mayorista", compra: 1502.5, venta: 1511.5 },
  { casa: "tarjeta", compra: 1924, venta: 1989 },
];

describe("parseDolares", () => {
  it("toma el precio de venta de cada casa con el nombre que usa el sistema", () => {
    expect(parseDolares(dolares)).toEqual({ oficial: 1530, blue: 1545, mep: 1533.7, ccl: 1583.2, mayorista: 1511.5 });
  });
  it("ignora basura sin romper", () => {
    expect(parseDolares([{ casa: "oficial" }, null, "x"])).toEqual({});
    expect(parseDolares("nada")).toEqual({});
  });
});

describe("parseRiesgoPais", () => {
  it("valor y fecha", () => {
    expect(parseRiesgoPais({ valor: 490, fecha: "2026-09-07" })).toEqual({ value: 490, date: "2026-09-07" });
    expect(parseRiesgoPais({})).toBeNull();
  });
});

describe("ArgentinaMacro", () => {
  it("pide dólares y riesgo país y no cae si una fuente falla", async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: string) => {
      calls.push(url);
      if (url.includes("dolarapi")) return new Response(JSON.stringify(dolares), { status: 200 });
      return new Response("boom", { status: 500 });
    }) as unknown as typeof fetch;
    const m = new ArgentinaMacro(fetchFn);
    expect(await m.dolares()).toEqual({ oficial: 1530, blue: 1545, mep: 1533.7, ccl: 1583.2, mayorista: 1511.5 });
    await expect(m.riesgoPais()).rejects.toThrow(/riesgo país/);
    expect(calls).toHaveLength(2);
  });
});
