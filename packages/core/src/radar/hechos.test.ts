import { describe, expect, it } from "vitest";
import { HechoEntradaSchema, banderasDeHechos, clasificarHecho, esFuentePrimaria, hechosVigentes, simbolosConPuerta, textoDeHecho, type HechoEntrada, type HechoExterno } from "./hechos.js";

const HOSTS = ["sec.gov", "prnewswire.com"];
const today = "2026-09-17";
const guia = (over: Partial<Extract<HechoEntrada, { tipo: "guia" }>> = {}): Extract<HechoEntrada, { tipo: "guia" }> => ({
  tipo: "guia", symbol: "FIVE", fecha: "2026-09-02",
  valor: { direccion: "sube", metrica: "ganancia ajustada por acción 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" },
  fuente: { url: "https://www.sec.gov/Archives/edgar/data/1177609/000117760926000023/q22026fivebelowexhibit991.htm", titulo: "8-K del 2/9/2026" },
  ...over,
});
const h = (e: HechoEntrada, estado: HechoExterno["estado"] = "verificado"): HechoExterno => ({ ...clasificarHecho(e, { hostsPrimarios: HOSTS, origen: "manual", detectadoAt: `${today}T12:00:00.000Z` }), estado });

describe("HechoEntradaSchema", () => {
  it("acepta los tres tipos con su forma", () => {
    expect(HechoEntradaSchema.safeParse(guia()).success).toBe(true);
    expect(HechoEntradaSchema.safeParse({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/x", titulo: "8-K" } }).success).toBe(true);
    expect(HechoEntradaSchema.safeParse({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta la PUC de Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://www.sec.gov/y", titulo: "8-K del 27/10/2025" } }).success).toBe(true);
  });
  it("rechaza fecha sin formato, URL vacía y dirección inválida", () => {
    expect(HechoEntradaSchema.safeParse(guia({ fecha: "2/9/2026" })).success).toBe(false);
    expect(HechoEntradaSchema.safeParse(guia({ fuente: { url: "", titulo: "x" } })).success).toBe(false);
    expect(HechoEntradaSchema.safeParse({ ...guia(), valor: { ...guia().valor, direccion: "arriba" } }).success).toBe(false);
  });
});

describe("esFuentePrimaria y clasificarHecho", () => {
  it("sec.gov y sus subdominios son primarios; un portal no", () => {
    expect(esFuentePrimaria("https://www.sec.gov/Archives/x", HOSTS)).toBe(true);
    expect(esFuentePrimaria("https://data.sec.gov/x", HOSTS)).toBe(true);
    expect(esFuentePrimaria("https://finance.yahoo.com/x", HOSTS)).toBe(false);
    expect(esFuentePrimaria("no es una url", HOSTS)).toBe(false);
  });
  it("verificado sólo si la fuente es primaria (13/9: un dato sin fuente primaria no mueve nada)", () => {
    expect(clasificarHecho(guia(), { hostsPrimarios: HOSTS, origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" })).toMatchObject({ primaria: true, estado: "verificado", origen: "agente", vigenteHasta: null });
    expect(clasificarHecho(guia({ fuente: { url: "https://finance.yahoo.com/x", titulo: "nota" } }), { hostsPrimarios: HOSTS, origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" })).toMatchObject({ primaria: false, estado: "no_verificado" });
  });
});

describe("hechosVigentes", () => {
  it("guía 90 días, reservas 120, oferta 400; vigenteHasta manda", () => {
    const vieja = h(guia({ fecha: "2026-06-01" }));
    const fresca = h(guia({ fecha: "2026-07-01" }));
    const oferta = h({ tipo: "oferta_de_compra", symbol: "AES", fecha: "2026-03-01", valor: { comprador: "GIP/EQT", efectivoUsd: 15, ratio: null, etapa: "faltan FERC y estados", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: "https://www.sec.gov/z", titulo: "8-K" } });
    const vencida: HechoExterno = { ...oferta, vigenteHasta: "2026-09-01" };
    expect(hechosVigentes([vieja, fresca, oferta, vencida], today).map((x) => x.fecha)).toEqual(["2026-07-01", "2026-03-01"]);
  });
});

describe("banderasDeHechos", () => {
  it("guía subida verificada → guia_subida; no verificada → nada", () => {
    expect(banderasDeHechos([h(guia())], today)).toEqual(["guia_subida"]);
    expect(banderasDeHechos([h(guia(), "no_verificado")], today)).toEqual([]);
  });
  it("guía baja → guia_recortada; reafirma → guia_reafirmada", () => {
    expect(banderasDeHechos([h(guia({ valor: { ...guia().valor, direccion: "baja" } }))], today)).toEqual(["guia_recortada"]);
    expect(banderasDeHechos([h(guia({ valor: { ...guia().valor, direccion: "reafirma" } }))], today)).toEqual(["guia_reafirmada"]);
  });
  it("reservas: sin ellas por debajo del consenso (PGR 2T: 4,11 contra 4,70) → ganancia_por_reservas; sobrevive → nada", () => {
    const pgr = (epsSinReservas: number): HechoExterno => h({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/p", titulo: "8-K del 15/7/2026" } });
    expect(banderasDeHechos([pgr(4.11)], today)).toEqual(["ganancia_por_reservas"]);
    expect(banderasDeHechos([pgr(4.8)], today)).toEqual([]);
  });
  it("oferta de compra → bajo_oferta_de_compra", () => {
    const wtrg = h({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta la PUC de Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://www.sec.gov/w", titulo: "8-K del 27/10/2025" } });
    expect(banderasDeHechos([wtrg], today)).toEqual(["bajo_oferta_de_compra"]);
    expect(textoDeHecho(wtrg)).toBe("vale 0,305 acciones de AWK (American Water, falta la PUC de Pensilvania)");
  });
  it("textos: guía y reservas", () => {
    expect(textoDeHecho(h(guia()))).toBe("subió la guía el 2026-09-02: ganancia ajustada por acción 2026 8,65-9,05 → 9,83-10,31");
    const pgr = h({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/p", titulo: "8-K" } });
    expect(textoDeHecho(pgr)).toBe("la ganancia del 2T 2026 lleva USD 551 M de reservas liberadas: sin eso 4,11 contra 4,7 esperado");
    const aes = h({ tipo: "oferta_de_compra", symbol: "AES", fecha: "2026-03-01", valor: { comprador: "GIP/EQT", efectivoUsd: 15, ratio: null, etapa: "faltan FERC y estados", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: "https://www.sec.gov/z", titulo: "8-K" } });
    expect(textoDeHecho(aes)).toBe("vendida a 15 en efectivo (GIP/EQT, faltan FERC y estados)");
  });
});

describe("simbolosConPuerta", () => {
  it("sólo guía subida verificada en 90 días, los más recientes primero, sin repetir, con tope", () => {
    const hs = [h(guia({ symbol: "FIVE", fecha: "2026-09-02" })), h(guia({ symbol: "FIVE", fecha: "2026-06-05" })), h(guia({ symbol: "VIEJA", fecha: "2026-05-01" })), h(guia({ symbol: "NOVER", fecha: "2026-09-10" }), "no_verificado"), h(guia({ symbol: "BAJA", fecha: "2026-09-10", valor: { ...guia().valor, direccion: "baja" } })), h(guia({ symbol: "ARW", fecha: "2026-08-06" }))];
    expect(simbolosConPuerta(hs, today)).toEqual(["FIVE", "ARW"]);
    expect(simbolosConPuerta(hs, today, 1)).toEqual(["FIVE"]);
  });
});
