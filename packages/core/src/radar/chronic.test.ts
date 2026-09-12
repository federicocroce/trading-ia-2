import { describe, expect, it } from "vitest";
import { residentWeeks } from "../index.js";

describe("residentWeeks", () => {
  it("correr el ranking varias veces el mismo día no mueve el contador", () => {
    // El caso real del 11/9: tres corridas en una noche llevaron el contador a 4 y mandaron a OBSERVAR
    // a APH, NVDA y NBN por residente crónico, sin que pasara un solo día.
    expect(residentWeeks(["2026-09-11", "2026-09-11", "2026-09-11"], "2026-09-11")).toBe(1);
  });

  it("cinco días seguidos de la misma semana siguen siendo una semana", () => {
    expect(residentWeeks(["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"], "2026-09-11")).toBe(1);
  });

  it("cuatro corridas semanales dan cuatro, aunque el día de la semana se corra", () => {
    // Las tres primeras caen domingo y la última martes: contar semanas de calendario cortaba la racha acá.
    expect(residentWeeks(["2026-04-26", "2026-05-03", "2026-05-10"], "2026-05-19")).toBe(4);
  });

  it("un hueco largo corta la racha y se vuelve a contar desde ahí", () => {
    // Faltó la semana del 25/8: solo cuenta desde el 1/9.
    expect(residentWeeks(["2026-08-11", "2026-09-01", "2026-09-08"], "2026-09-11")).toBe(2);
  });

  it("sin historial, hoy es la primera semana", () => {
    expect(residentWeeks([], "2026-09-11")).toBe(1);
  });

  it("ignora fechas posteriores a hoy", () => {
    // Protege del otro error de la misma noche: filas escritas con fecha de mañana por usar UTC.
    expect(residentWeeks(["2026-09-11", "2026-09-14"], "2026-09-11")).toBe(1);
  });

  it("tres semanas seguidas todavía no alcanzan el umbral de cuatro", () => {
    expect(residentWeeks(["2026-08-24", "2026-08-31", "2026-09-07"], "2026-09-11")).toBe(3);
  });
});
