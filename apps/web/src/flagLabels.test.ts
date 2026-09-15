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
});
