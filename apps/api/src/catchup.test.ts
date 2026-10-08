import { describe, expect, it } from "vitest";
import { barridoAReanudar, corridaVacia } from "./catchup.js";

/*
 * 8/10: en este archivo conviven DOS suites que escribieron sesiones distintas el mismo día, sobre funciones
 * distintas del catch-up: `barridoAReanudar` (qué barrido corresponde correr) y `corridaVacia` (una corrida que
 * no logró nada no se registra como hecha). Al mergear quedaron las dos: no se pisan.
 */

/*
 * 5/10/2026: el barrido del domingo 4/10 quedó con 1.375 símbolos sin procesar y el lunes no se reanudó. La condición
 * era `scanDate >= today`, y 2026-10-04 no es >= 2026-10-05, así que en vez de seguir donde iba abría un barrido nuevo
 * desde cero — y volvía a pedir las ~2.800 fundamentales que son justo lo que no termina a tiempo.
 */
describe("qué barrido corresponde correr", () => {
  it("reanuda el barrido pendiente aunque sea de otro día (el caso del 4/10 visto el 5/10)", () => {
    expect(barridoAReanudar("2026-10-04", 1375, "2026-10-05")).toEqual({ scanDate: "2026-10-04", reanuda: true });
  });
  it("sin pendientes, abre el barrido de hoy", () => {
    expect(barridoAReanudar("2026-10-04", 0, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: false });
  });
  it("el mismo día con pendientes también reanuda (lo que ya hacía)", () => {
    expect(barridoAReanudar("2026-10-05", 300, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: true });
  });
  it("sin ningún barrido previo, abre el de hoy", () => {
    expect(barridoAReanudar(null, 0, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: false });
  });
});

/**
 * 1/10/2026. Qué cuenta como "la corrida no trajo nada".
 *
 * El caso real: `refreshRadar` tenía 112 candidatas para refrescar y refrescó 0, con la lista de errores casi
 * vacía. No es que los pedidos tiraran excepción: el adaptador de precios se traga el `fetch failed`, cae al
 * respaldo, el respaldo también falla y devuelve `[]`; entonces `refreshRadar` saltea el símbolo en silencio
 * (`if (!c || !c.length) continue`) sin anotar un error. Por eso la regla NO puede mirar los errores: tiene que
 * mirar si hubo trabajo pedido y no salió nada.
 */
describe("corridaVacia", () => {
  it("intentó 112 y no trajo ninguno: vacía, aunque nadie haya anotado un error", () => {
    expect(corridaVacia(112, 0)).toBe("0 de 112");
  });

  it("no había nada que hacer: no es vacía", () => {
    // Un domingo sin candidatas, o Cartera sin posiciones. Si esto contara como vacía, el paso quedaría
    // pendiente para siempre y el catch-up lo reintentaría cada 30 minutos sin fin.
    expect(corridaVacia(0, 0)).toBeNull();
  });

  it("trajo parte: no es vacía", () => {
    // El 1/10 a las 11:15 Argentina volvió con 1 error sobre 54 símbolos (MIRG.BA, serie_con_salto). Eso es una
    // regla haciendo su trabajo, no una corrida perdida.
    expect(corridaVacia(54, 53)).toBeNull();
  });

  it("trajo uno solo de muchos: tampoco es vacía, la regla no juzga calidad", () => {
    expect(corridaVacia(112, 1)).toBeNull();
  });
});
