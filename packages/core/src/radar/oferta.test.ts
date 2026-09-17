import { describe, expect, it } from "vitest";
import { bajoOfertaDeCompra } from "./oferta.js";

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
