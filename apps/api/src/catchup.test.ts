import { describe, expect, it } from "vitest";
import { corridaVacia } from "./catchup.js";

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
