import { describe, expect, it } from "vitest";
import { calendarioDeResultados, conCalendario } from "../src/radar.js";
import type { Fundamentals } from "@thesis/core";

const f = (symbol: string, alt?: string | null): Fundamentals => ({ symbol, asOf: "2026-10-10", metrics: {}, peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 0, priceUsd: 1, nextEarnings: "2026-10-22", insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null, ...(alt !== undefined ? { nextEarningsAlt: alt } : {}) });

describe("calendario de resultados de Nasdaq (10/10)", () => {
  it("pone la fecha de Nasdaq y deja la de Finnhub como estaba", () => {
    const r = conCalendario(f("DXCM"), new Map([["DXCM", "2026-10-29"]]));
    expect(r).toMatchObject({ nextEarnings: "2026-10-22", nextEarningsAlt: "2026-10-29" });
  });
  it("un símbolo que Nasdaq no lista queda sin fecha alternativa, no con la vieja", () => {
    expect(conCalendario(f("JBL", "2026-09-30"), new Map()).nextEarningsAlt).toBeNull();
  });
  it("si el calendario falló, queda la fecha guardada: no se borra por una caída", () => {
    expect(conCalendario(f("DXCM", "2026-10-29"), null).nextEarningsAlt).toBe("2026-10-29");
  });
  it("se pide una sola vez por día aunque lo llamen el refresco y la suma de filas nuevas", async () => {
    let pedidos = 0;
    const deps = { earningsCalendar: async () => { pedidos++; return { fechas: new Map([["NEM", "2026-10-22"]]), diasFallidos: 0 }; } };
    await calendarioDeResultados(deps, "2026-10-10");
    const r = await calendarioDeResultados(deps, "2026-10-10");
    expect(pedidos).toBe(1);
    expect(r.fechas?.get("NEM")).toBe("2026-10-22");
    await calendarioDeResultados(deps, "2026-10-11");
    expect(pedidos).toBe(2);
  });
  it("si falla o queda incompleto lo dice, en vez de tratar 'sin fecha' como 'no reporta'", async () => {
    const roto = await calendarioDeResultados({ earningsCalendar: async () => { throw new Error("HTTP 403"); } }, "2026-10-10");
    expect(roto.fechas).toBeNull();
    expect(roto.aviso).toMatch(/no respondió.*403/);
    const incompleto = await calendarioDeResultados({ earningsCalendar: async () => ({ fechas: new Map(), diasFallidos: 3 }) }, "2026-10-10");
    expect(incompleto.aviso).toMatch(/3 días sin respuesta/);
  });
  it("sin segunda fuente configurada no avisa nada", async () => {
    expect(await calendarioDeResultados({}, "2026-10-10")).toEqual({ fechas: null, aviso: null });
  });
});
