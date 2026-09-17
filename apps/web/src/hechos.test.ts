import { describe, expect, it } from "vitest";
import { hechoLinea, textoDeHecho } from "./hechos";

describe("hechoLinea", () => {
  it("arma texto, chip y fuente para los tres tipos", () => {
    const base = { primaria: true, estado: "verificado" as const, origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z", vigenteHasta: null };
    expect(hechoLinea({ ...base, tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS ajustado 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } })).toEqual({ chip: "verificado", fecha: "2026-09-02", texto: "subió la guía el 2026-09-02: EPS ajustado 2026 8,65-9,05 → 9,83-10,31", fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } });
    expect(hechoLinea({ ...base, estado: "no_verificado", primaria: false, tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://x", titulo: "nota" } }).chip).toBe("no verificado");
  });
});

describe("textoDeHecho", () => {
  // Mismos cuatro inputs que packages/core/src/radar/hechos.test.ts: la copia de la web no se puede desalinear del núcleo.
  const base = { primaria: true, estado: "verificado" as const, origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z", vigenteHasta: null };
  it("guía: mismo texto que el núcleo", () => {
    expect(textoDeHecho({ ...base, tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "ganancia ajustada por acción 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/Archives/edgar/data/1177609/000117760926000023/q22026fivebelowexhibit991.htm", titulo: "8-K del 2/9/2026" } })).toBe("subió la guía el 2026-09-02: ganancia ajustada por acción 2026 8,65-9,05 → 9,83-10,31");
  });
  it("ganancia por reservas: mismo texto que el núcleo", () => {
    expect(textoDeHecho({ ...base, tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/p", titulo: "8-K" } })).toBe("la ganancia del 2T 2026 lleva USD 551 M de reservas liberadas: sin eso 4,11 contra 4,7 esperado");
  });
  it("oferta de compra en efectivo: mismo texto que el núcleo", () => {
    expect(textoDeHecho({ ...base, tipo: "oferta_de_compra", symbol: "AES", fecha: "2026-03-01", valor: { comprador: "GIP/EQT", efectivoUsd: 15, ratio: null, etapa: "faltan FERC y estados", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: "https://www.sec.gov/z", titulo: "8-K" } })).toBe("vendida a 15 en efectivo (GIP/EQT, faltan FERC y estados)");
  });
  it("oferta de compra en canje: mismo texto que el núcleo", () => {
    expect(textoDeHecho({ ...base, tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta la PUC de Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://www.sec.gov/w", titulo: "8-K del 27/10/2025" } })).toBe("vale 0,305 acciones de AWK (American Water, falta la PUC de Pensilvania)");
  });
});
