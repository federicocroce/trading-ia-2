import { describe, expect, it } from "vitest";
import { ANUNCIO_DE_FUSION, anuncioDeFusion, bajoOfertaDeCompra, textoDeFusion } from "./oferta.js";

/**
 * AES el 16/9/2026: el Radar la ponía 77ª por puntaje, COMPRAR, franja 14,81-15,11, stop 14,70 y objetivo 15,93
 * "al doble del riesgo". Ese objetivo no puede pasar: el 1/3/2026 firmó una fusión a USD 15,00 por acción en
 * efectivo (Global Infrastructure Partners y EQT), los accionistas la aprobaron el 26/6/2026 con el 97,9% de los
 * votos y CFIUS dio el visto bueno el 27/8/2026.
 *
 * Una acción bajo oferta le parece perfecta al Radar —se mueve poco, el riesgo medido da bajo, los múltiplos
 * quedan baratos— y es justo lo contrario: el retorno está topado por contrato (1,28% desde 14,81) y si el acuerdo
 * se cae la referencia sin oferta es ~11, una caída del 25%.
 *
 * La prueba es el formulario, no el titular: un DEFM14A, un PREM14A, un SC 14D9 o un 425 sólo existen cuando hay
 * una fusión o una oferta de compra en curso. Un 8-K item 1.01 NO alcanza: también lo usa cualquier crédito.
 */
describe("bajoOfertaDeCompra", () => {
  it("el poder para votar una fusión prueba que hay oferta", () => {
    expect(bajoOfertaDeCompra(["DEFM14A — THE AES CORPORATION"])).toBe("DEFM14A");
    expect(bajoOfertaDeCompra(["PREM14A — THE AES CORPORATION"])).toBe("PREM14A");
  });
  it("la respuesta del directorio a una oferta pública también prueba que hay oferta", () => {
    expect(bajoOfertaDeCompra(["SC 14D9 — Empresa Inc."])).toBe("SC 14D9");
  });
  /**
   * El 17/9/2026 se verificó en EDGAR contra el top-300 de la preselección: la regla marcaba "bajo oferta" a FOXA,
   * LLYVK, VCTR y VLY, que sólo tienen 425 en sus filings recientes. El 425 es el formulario de comunicaciones de
   * fusión y lo presentan LAS DOS partes, incluida la compradora: FOX CORP está comprando Roku y tiene once 425
   * propios sin ningún DEFM14A ni PREM14A ni SC 14D9. Un 425 solo no prueba que la empresa esté vendida; prueba que
   * hay una fusión en danza y hay que mirar si el emisor también presentó el poder para votarla o la respuesta a
   * la oferta. Casos reales: ROKU (vendida) tiene 425 y DEFM14A; WTRG (vendida) tiene 425 y DEFM14A; FOXA
   * (compradora) sólo tiene 425.
   */
  it("un 425 solo no prueba nada: lo presenta también la compradora (FOXA/ROKU, 17/9)", () => {
    expect(bajoOfertaDeCompra(["425 — FOX CORP", "425 — FOX CORP"])).toBeNull();
  });
  it("un 425 cuenta cuando el mismo emisor también presentó el poder de la fusión (ROKU, WTRG, 17/9)", () => {
    expect(bajoOfertaDeCompra(["425 — ROKU, INC.", "DEFM14A — ROKU, INC.", "425 — ROKU, INC."])).toBe("DEFM14A");
    expect(bajoOfertaDeCompra(["425 — ESSENTIAL UTILITIES", "DEFM14A — ESSENTIAL UTILITIES"])).toBe("DEFM14A");
  });
  it("si hay SC 14D9 y 425 juntos, la prueba es el SC 14D9", () => {
    expect(bajoOfertaDeCompra(["SC 14D9 — X", "425 — X"])).toBe("SC 14D9");
  });
  it("un PREM14A solo sigue alcanzando (DV, 17/9)", () => {
    expect(bajoOfertaDeCompra(["PREM14A — DV"])).toBe("PREM14A");
  });
  it("un formulario de todos los días solo no marca nada (17/9)", () => {
    expect(bajoOfertaDeCompra(["10-Q — Empresa"])).toBeNull();
  });
  /**
   * El falso positivo peligroso. Verificado en EDGAR el 16/9: AES presentó PREM14A el 4/5/2026 y DEFM14A el
   * 15/5/2026 —los de la fusión— y además presentó DEF 14A el 20/3/2026 y todos los marzos desde 2013. El DEF 14A
   * es el poder de la asamblea anual: lo presenta toda empresa que cotiza, todos los años. Si contara, la regla
   * marcaría a media bolsa.
   */
  it("el poder de la asamblea anual (DEF 14A) no es una oferta: lo presenta toda empresa", () => {
    expect(bajoOfertaDeCompra(["DEF 14A — THE AES CORPORATION"])).toBeNull();
    expect(bajoOfertaDeCompra(["DEF 14A — Empresa Inc.", "DEFM14A — Empresa Inc."])).toBe("DEFM14A");
  });
  it("un 8-K item 1.01 no prueba nada: también lo usa un crédito (Sezzle, 16/9)", () => {
    expect(bajoOfertaDeCompra(["8-K (items 1.01,2.03,9.01) — Sezzle Inc."])).toBeNull();
  });
  it("los formularios de todos los días no la marcan", () => {
    expect(bajoOfertaDeCompra(["10-Q — Empresa Inc.", "8-K (items 8.01,9.01) — Empresa Inc.", "4 venta de insider: Perez Juan, 100 acciones — Empresa Inc."])).toBeNull();
    expect(bajoOfertaDeCompra([])).toBeNull();
  });
  it("no se deja engañar por un nombre de empresa que contenga el formulario", () => {
    expect(bajoOfertaDeCompra(["10-K — 425 Holdings Inc."])).toBeNull();
    expect(bajoOfertaDeCompra(["6-K — DEFM14A Corp"])).toBeNull();
  });
});

/**
 * 24/9/2026: MG (H.I.G. Capital, 20,35 en efectivo, firmada el 17/9) figuraba COMPRAR con objetivo 23,32; BWIN (fondo
 * de la familia Dell, 32,50) COMPRAR; PRTH (su CEO con Searchlight, 8,05) sin bandera. El PREM14A llega semanas
 * después del anuncio: hasta entonces la empresa vendida presenta el 8-K del acuerdo (item 1.01) y el material de la
 * votación (DEFA14A) el mismo día. Verificado en EDGAR: MG 8-K 1.01,5.02,7.01,8.01,9.01 y siete DEFA14A el 18/9; BWIN
 * 8-K 1.01,7.01,9.01 y cuatro DEFA14A el 14/9; PRTH 8-K 1.01,5.02,8.01,9.01 y DEFA14A el 21/9; TruBridge (TBRG) 8-K
 * 1.01,7.01,9.01 y DEFA14A el 23/4, comprada el 9/7.
 *
 * Los items no alcanzan: un acuerdo de cooperación con un fondo activista también es 1.01 (+5.02 por los directores),
 * y suele ir con DEFA14A en temporada de asambleas. Lo que distingue es el texto del 8-K: el de MG dice "Agreement and
 * Plan of Merger" y el de cooperación de Integer (ITGR, 12/3) solo "Cooperation Agreement".
 */
describe("anuncioDeFusion", () => {
  const mg = [
    { form: "DEFA14A", fecha: "2026-09-18", items: "", ref: "d1" },
    { form: "DEFA14A", fecha: "2026-09-18", items: "", ref: "d2" },
    { form: "8-K", fecha: "2026-09-18", items: "1.01,5.02,7.01,8.01,9.01", ref: "k1" },
    { form: "8-K", fecha: "2026-08-10", items: "2.02,9.01", ref: "k0" },
    { form: "DEFA14A", fecha: "2026-04-07", items: "", ref: "d0" },
  ];
  it("MG: el 8-K 1.01 del mismo día que un DEFA14A es el que hay que leer", () => {
    expect(anuncioDeFusion(mg, "2026-09-24")?.ref).toBe("k1");
  });
  it("con un día de diferencia también (el 8-K a veces sale la noche anterior)", () => {
    expect(anuncioDeFusion([{ form: "DEFA14A", fecha: "2026-09-15", items: "", ref: "d" }, { form: "8-K", fecha: "2026-09-14", items: "1.01,7.01,9.01", ref: "k" }], "2026-09-24")?.ref).toBe("k");
  });
  it("un 8-K del viernes con el DEFA14A del lunes también (revisión del 24/9)", () => {
    expect(anuncioDeFusion([{ form: "DEFA14A", fecha: "2026-09-21", items: "", ref: "d" }, { form: "8-K", fecha: "2026-09-18", items: "1.01,8.01,9.01", ref: "k" }], "2026-09-24")?.ref).toBe("k");
    expect(anuncioDeFusion([{ form: "DEFA14A", fecha: "2026-09-22", items: "", ref: "d" }, { form: "8-K", fecha: "2026-09-18", items: "1.01,8.01,9.01", ref: "k" }], "2026-09-24")).toBeNull();
  });
  it("una asamblea anual (DEFA14A sin 8-K 1.01 cerca) no es un anuncio", () => {
    expect(anuncioDeFusion([{ form: "DEFA14A", fecha: "2026-04-07", items: "", ref: "d" }, { form: "8-K", fecha: "2026-05-05", items: "2.02,9.01", ref: "k" }], "2026-05-10")).toBeNull();
  });
  it("un 8-K 1.01 sin DEFA14A (un crédito) no es un anuncio", () => {
    expect(anuncioDeFusion([{ form: "8-K", fecha: "2026-06-15", items: "1.01,2.03,9.01", ref: "k" }], "2026-06-20")).toBeNull();
  });
  it("después de 120 días ya no cuenta: para entonces la fusión tiene su PREM14A o se cayó", () => {
    expect(anuncioDeFusion(mg, "2027-02-01")).toBeNull();
  });
});

describe("textoDeFusion", () => {
  it("MG (17/9): el 8-K habla de un acuerdo de fusión en el que la empresa es la vendida", () => {
    expect(textoDeFusion("Item 1.01. Entry into a Material Definitive Agreement. Agreement and Plan of Merger On September 17, 2026, Mistras Group, Inc., a Delaware corporation (the “Company”), entered into an Agreement and Plan of Merger (the “Merger Agreement”) with Athena Purchaser, LLC, a Delaware limited liability company (“Parent”), and Athena Merger Sub, Inc., a Delaware corporation and a wholly owned subsidiary of Parent (“Acquisition Sub”).")).toBe(true);
  });
  /**
   * El falso positivo que encontró el barrido del 24/9 sobre las 275 que pasaban el filtro técnico. VCTR presentó el
   * 31/8 un 8-K 1.01,3.02 y un DEFA14A el mismo día: es la COMPRADORA de First Eagle y emite acciones, así que sus
   * accionistas votan. El texto dice "Agreement and Plan of Merger" igual que el de MG. Lo que cambia es quién es la
   * subsidiaria: en MG el vehículo de la fusión es "wholly owned subsidiary of Parent"; en VCTR, "the Company will
   * acquire". Verificado también en BWIN y PRTH (vendidas) con el mismo resultado.
   */
  it("VCTR (31/8): el 8-K de la compradora no es el anuncio de su venta", () => {
    expect(textoDeFusion("Item 1.01. Entry into a Material Definitive Agreement. Merger Agreement On August 25, 2026, Victory Capital Holdings, Inc., a Delaware corporation (the “Company”), Fortify Holdings 1, Inc., a Delaware corporation (“Merger Sub 1”), Fortify Holdings 2, LLC, a Delaware limited liability company (“Merger Sub 2”), GC Ferry Parent, L.P., a Delaware limited partnership (“Seller”), and GC Ferry Holdings, Inc., a Delaware corporation (“First Eagle”), entered into an Agreement and Plan of Merger (the “Merger Agreement”). At the closing of the transactions contemplated by the Merger Agreement (the “Closing”), the Company will acquire First Eagle by means of a two-step merger")).toBe(false);
  });
  it("otras formas en que la compradora dice que compra tampoco cuentan", () => {
    const base = "entered into an Agreement and Plan of Merger with Merger Sub, a wholly owned subsidiary of Parent, ";
    expect(textoDeFusion(`${base}pursuant to which the Company agreed to acquire Target`)).toBe(false);
    expect(textoDeFusion(`${base}pursuant to which the Company acquired all of the outstanding shares`)).toBe(false);
    expect(textoDeFusion(`${base}pursuant to which the Company will be acquired by Parent`)).toBe(true);
  });
  it("ITGR (12/3): un acuerdo de cooperación con un activista no es una fusión", () => {
    expect(textoDeFusion("Item 1.01. Entry into a Material Definitive Agreement. On March 9, 2026 (the “Effective Date”), Integer Holdings Corporation (the “Company”) entered into a Cooperation Agreement (the “Cooperation Agreement”) by and among the Company, Irenic Capital Management LP")).toBe(false);
  });
});

describe("bajoOfertaDeCompra con el anuncio (24/9)", () => {
  it("el título del anuncio confirmado prueba solo", () => {
    expect(bajoOfertaDeCompra([`${ANUNCIO_DE_FUSION} — Mistras Group, Inc.`])).toBe(ANUNCIO_DE_FUSION);
  });
  it("si ya hay PREM14A, la prueba es el PREM14A", () => {
    expect(bajoOfertaDeCompra([`${ANUNCIO_DE_FUSION} — X`, "PREM14A — X"])).toBe("PREM14A");
  });
});
