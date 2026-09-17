import { describe, expect, it } from "vitest";
import { hechoLinea } from "./hechos";

describe("hechoLinea", () => {
  it("arma texto, chip y fuente para los tres tipos", () => {
    const base = { primaria: true, estado: "verificado" as const, origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z", vigenteHasta: null };
    expect(hechoLinea({ ...base, tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS ajustado 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } })).toEqual({ chip: "verificado", fecha: "2026-09-02", texto: "subió la guía el 2026-09-02: EPS ajustado 2026 8,65-9,05 → 9,83-10,31", fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } });
    expect(hechoLinea({ ...base, estado: "no_verificado", primaria: false, tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://x", titulo: "nota" } }).chip).toBe("no verificado");
  });
});
