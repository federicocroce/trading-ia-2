import { describe, expect, it } from "vitest";
import { sorpresaTexto, sorpresasTexto } from "./sorpresas";

/**
 * 16/9: la fila afirmaba "el último resultado decepcionó" y restaba 0,3 de convicción con un porcentaje que no se
 * podía contrastar con nada. SPNT marcaba −10,85% y en su comunicado del 29/7/2026 había SUPERADO: ganancia
 * operativa por acción de 0,67 contra un consenso de 0,65. La cuenta (0,58 contable − 0,65) / 0,65 = −10,77% dice
 * que el proveedor mide la ganancia contable contra un consenso armado sobre la operativa.
 *
 * No se puede corregir el número —no existe fuente primaria de consenso— así que la pantalla muestra contra qué se
 * está midiendo y el que mira decide.
 */
describe("sorpresaTexto", () => {
  it("con los dos números dice cuánto dio y cuánto se esperaba", () => {
    expect(sorpresaTexto({ period: "2026-06-30", actual: 0.58, estimate: 0.65, surprisePercent: -10.8515 })).toBe("2026-06 −10.9% (0.58 contra 0.65 esperado)");
  });
  it("sin los números queda el porcentaje solo: las corridas viejas no los guardaron", () => {
    expect(sorpresaTexto({ period: "2026-03-31", surprisePercent: 17.77 })).toBe("2026-03 +17.8%");
    expect(sorpresaTexto({ period: "2026-03-31", actual: null, estimate: null, surprisePercent: 17.77 })).toBe("2026-03 +17.8%");
  });
  it("sin porcentaje no se inventa nada", () => {
    expect(sorpresaTexto({ period: "2025-12-31", surprisePercent: null })).toBe("2025-12 s/d");
  });
  it("la línea entera junta las cuatro y aclara que el dato es del proveedor", () => {
    const t = sorpresasTexto([
      { period: "2026-06-30", actual: 0.58, estimate: 0.65, surprisePercent: -10.8515 },
      { period: "2026-03-31", actual: 0.79, estimate: 0.67, surprisePercent: 17.77 },
    ]);
    expect(t).toContain("0.58 contra 0.65 esperado");
    expect(t).toMatch(/Finnhub/);
  });
  it("sin sorpresas no hay línea", () => {
    expect(sorpresasTexto([])).toBeNull();
    expect(sorpresasTexto(null)).toBeNull();
  });
});
