import { describe, expect, it } from "vitest";
import { firstTrancheFrom } from "../index.js";

// Decisiones de la Fed (segundo día de cada reunión), según federalreserve.gov al 13/9/2026.
const decisiones = ["2026-07-29", "2026-09-16", "2026-10-28", "2026-12-09"];

describe("firstTrancheFrom (reunión de la Fed, 13/9)", () => {
  it("domingo 13/9: la Fed decide el miércoles 16, dentro de 3 días hábiles → el primer tramo va desde el jueves 17", () => {
    expect(firstTrancheFrom("2026-09-13", decisiones)).toEqual({ decision: "2026-09-16", from: "2026-09-17" });
  });
  it("el mismo día de la decisión todavía se espera: se anuncia a la tarde", () => {
    expect(firstTrancheFrom("2026-09-16", decisiones)).toEqual({ decision: "2026-09-16", from: "2026-09-17" });
  });
  it("con más de 3 días hábiles por delante no cambia nada", () => {
    expect(firstTrancheFrom("2026-09-01", decisiones)).toBeNull();
    expect(firstTrancheFrom("2026-09-10", decisiones)).toBeNull(); // jue 10 → mié 16 son 4 días hábiles
  });
  it("una decisión un viernes pasa el primer tramo al lunes", () => {
    expect(firstTrancheFrom("2027-01-01", ["2027-01-08"])).toBeNull();
    expect(firstTrancheFrom("2027-01-06", ["2027-01-08"])).toEqual({ decision: "2027-01-08", from: "2027-01-11" });
  });
  it("sin calendario o con todas las fechas pasadas, nada", () => {
    expect(firstTrancheFrom("2026-09-13", [])).toBeNull();
    expect(firstTrancheFrom("2027-01-01", decisiones)).toBeNull();
  });
});
