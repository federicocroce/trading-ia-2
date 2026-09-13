import { describe, expect, it } from "vitest";
import { CANDIDATE_FAMILIES, familyOf, type CandidateKind } from "../index.js";

/**
 * 13/9/2026: al agregar el tipo `adr`, la base real no mostraba ninguno y la suite pasaba igual. La base
 * tenía las familias escritas a mano y descartaba lo que no estuviera; la de memoria de los tests metía lo
 * desconocido en la familia de EE.UU. Ahora hay una sola definición y este test obliga a ubicar cualquier
 * tipo nuevo antes de que llegue a producción.
 */
describe("familias de filas del Radar", () => {
  const TODOS: CandidateKind[] = ["stock", "etf", "ar", "cedear", "watch", "adr"];

  it("cada tipo pertenece a exactamente una familia", () => {
    for (const k of TODOS) {
      const en = Object.values(CANDIDATE_FAMILIES).filter((kinds) => (kinds as ReadonlyArray<string>).includes(k));
      expect(en, `el tipo ${k} tiene que estar en una sola familia`).toHaveLength(1);
    }
  });

  /**
   * Si los ADR compartieran fecha con el ranking de EE.UU., una corrida de Argentina un día sin ranking
   * escondería las acciones del día anterior: justo lo que las familias existen para evitar.
   */
  it("los ADR van con Argentina, que es la corrida que los produce, no con el ranking de EE.UU.", () => {
    expect(familyOf("adr")).toBe("ar");
    expect(familyOf("adr")).not.toBe(familyOf("stock"));
  });
});
