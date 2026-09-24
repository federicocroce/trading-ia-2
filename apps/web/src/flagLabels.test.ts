import { describe, expect, it } from "vitest";
import { countSalvedades, flagLabel, flagTitle, flagTone } from "./flagLabels";

/**
 * Las banderas son lo que el dueño lee para decidir si le cree al veredicto, y ya fallaron dos veces por
 * cómo se mostraban, no por cómo se calculaban:
 *
 * - el 11/9 se pintaban todas igual, así que "consenso de compra" y "verificación apta" se leían como
 *   problemas y una candidata sana parecía llena de defectos;
 * - el 13/9 los motores guardaban oraciones ("fuerza relativa 6m -10.9176% ≤ 0 contra el Merval") que no se
 *   podían traducir y salían crudas, y "núcleo: se compra por calendario" se pintaba en ámbar como si ser
 *   del núcleo fuera una advertencia.
 *
 * Este archivo existe para que ninguna bandera vuelva a llegar a la pantalla sin traducir ni con el signo
 * cambiado, incluidas las escrituras viejas que siguen guardadas y que el selector de fecha puede mostrar.
 */
describe("flagLabel", () => {
  it("traduce las banderas simples", () => {
    expect(flagLabel("consenso_compra")).toBe("consenso de compra");
    expect(flagLabel("bajo_sma200")).toBe("bajo la SMA200");
    expect(flagLabel("nucleo_por_calendario")).toContain("núcleo");
  });

  it("traduce las que llevan el dato detrás de los dos puntos, redondeando", () => {
    expect(flagLabel("fr6m_negativa:-12.4357")).toBe("le perdió al SPY en 6 meses (-12.4%)");
    expect(flagLabel("fr6m_negativa_merval:-0.2379")).toBe("le perdió al Merval en 6 meses (-0.2%)");
    expect(flagLabel("serie_con_salto:2026-08-03")).toContain("2026-08-03");
  });

  /**
   * 16/9: la bandera decía sólo "dividendo" y salía de un campo del proveedor que estaba mal (HSBC figuraba con
   * 5,55% y paga 0,78%). Ahora lleva el número que se puede contrastar contra la empresa.
   */
  it("AES del 16/9: una empresa bajo oferta de compra se lee y juega en contra", () => {
    expect(flagLabel("bajo_oferta_de_compra")).toMatch(/oferta de compra/);
    expect(flagTone("bajo_oferta_de_compra")).toBe("salvedad");
  });

  it("la bandera de dividendo muestra cuánto paga, para poder verificarlo", () => {
    expect(flagLabel("dividendo:6.9512")).toBe("paga 7.0% de dividendo (12 meses)");
    expect(flagTone("dividendo:6.9512")).toBe("bueno");
    expect(flagTitle("dividendo:6.9512")).toMatch(/no suma a la convicción/);
  });

  /** Las corridas anteriores al 13/9 siguen guardadas y el encabezado permite mirarlas con ?date=. */
  it("sigue entendiendo las escrituras viejas, para que el histórico no se degrade", () => {
    expect(flagLabel("bajo SMA200")).toBe("bajo la SMA200");
    expect(flagLabel("núcleo: se compra por calendario, sin timing")).toContain("núcleo");
    expect(flagLabel("fuerza relativa 6m -10.9176% ≤ 0 contra el Merval")).toBe("le perdió al Merval en 6 meses (-10.9%)");
    expect(flagLabel("fuerza relativa 6m -1.2898% ≤ 0 contra SPY")).toBe("le perdió al SPY en 6 meses (-1.3%)");
  });

  it("una bandera desconocida se muestra tal cual: es feo, pero es mejor que esconderla", () => {
    expect(flagLabel("algo_nuevo_que_nadie_tradujo")).toBe("algo_nuevo_que_nadie_tradujo");
  });
});

describe("flagTone", () => {
  it("a favor es a favor", () => {
    expect(flagTone("consenso_compra")).toBe("bueno");
    expect(flagTone("verificacion_apta")).toBe("bueno");
    expect(flagTone("barato_vs_ccl")).toBe("bueno");
  });

  it("lo que falta es un límite de la fuente, no un defecto de la empresa", () => {
    expect(flagTone("sin_estados")).toBe("limitacion");
    expect(flagTone("serie_con_salto:2026-08-03")).toBe("limitacion");
  });

  it("ser del núcleo o estar en línea con el CCL no es una advertencia", () => {
    expect(flagTone("nucleo_por_calendario")).toBe("limitacion");
    expect(flagTone("en_linea")).toBe("limitacion");
    expect(flagTone("núcleo: se compra por calendario, sin timing")).toBe("limitacion");
  });

  it("lo desconocido cuenta como salvedad: el default seguro", () => {
    expect(flagTone("bandera_nueva_sin_declarar")).toBe("salvedad");
    expect(flagTone("evento_grave")).toBe("salvedad");
  });

  it("contar salvedades no cuenta ni las buenas ni las limitaciones", () => {
    expect(countSalvedades(["consenso_compra", "sin_estados", "nucleo_por_calendario", "evento_grave", "bajo_sma200"])).toBe(2);
  });
});

describe("el título de cada bandera dice lo que hace (auditoría del 15/9)", () => {
  it("'verificación apta' y 'dividendo' son a favor pero no suman a la convicción: el título decía que sí", () => {
    expect(flagTitle("consenso_compra")).toMatch(/suma 0,2 a la convicción/);
    expect(flagTitle("verificacion_apta")).toMatch(/no suma a la convicción/);
    expect(flagTitle("dividendo")).toMatch(/no suma a la convicción/);
    expect(flagTitle("evento_grave")).toMatch(/juega en contra/);
  });
  it("una apta con el cuestionario anterior no se pinta de verde: hay que repetirla antes de comprar", () => {
    expect(flagTone("verificacion_anterior")).toBe("limitacion");
    expect(flagLabel("verificacion_anterior")).toMatch(/cuestionario anterior/);
    expect(countSalvedades(["verificacion_anterior"])).toBe(0);
  });

  it("hechos externos (17/9): guía subida a favor, reservas y guía recortada como salvedad, reafirmada neutra", () => {
    expect(flagLabel("guia_subida")).toBe("subió la guía (hecho verificado)");
    expect(flagLabel("guia_recortada")).toBe("recortó la guía (hecho verificado)");
    expect(flagLabel("guia_reafirmada")).toBe("reafirmó la guía (hecho verificado)");
    expect(flagLabel("ganancia_por_reservas")).toBe("la ganancia lleva reservas liberadas: sin ellas no llega al consenso (hecho verificado)");
    expect(flagTone("guia_subida")).toBe("bueno");
    expect(flagTone("guia_recortada")).toBe("salvedad");
    expect(flagTone("ganancia_por_reservas")).toBe("salvedad");
    expect(flagLabel("ganancia_extraordinaria")).toBe("la ganancia no viene del negocio (valor razonable, venta de activos…): sin eso no llega al consenso (hecho verificado)");
    expect(flagTone("ganancia_extraordinaria")).toBe("salvedad");
    expect(flagLabel("pares_no_comparables")).toBe("sus pares no se mueven como ella: el puesto contra el grupo vale menos");
    expect(flagTone("pares_no_comparables")).toBe("salvedad");
    expect(flagLabel("evento_de_capital_pendiente")).toBe("dividendo especial o escisión pendiente: ese día el precio baja de forma mecánica (hecho verificado)");
    expect(flagTone("evento_de_capital_pendiente")).toBe("salvedad");
    expect(flagTone("guia_reafirmada")).toBe("limitacion");
  });
});
