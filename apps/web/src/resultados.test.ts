import { describe, expect, it } from "vitest";
import { fechaDeResultados } from "./resultados";

describe("fechaDeResultados (10/10)", () => {
  it("DXCM: si las fuentes difieren se muestran las dos, Nasdaq primero", () => {
    expect(fechaDeResultados("2026-10-22", "2026-10-29")).toBe("2026-10-29 (Nasdaq; Finnhub dice 2026-10-22)");
  });
  it("NEM: Finnhub sin fecha, Nasdaq con fecha", () => {
    expect(fechaDeResultados(null, "2026-10-22")).toBe("2026-10-22");
  });
  it("si coinciden o hay una sola, una sola; sin ninguna, null", () => {
    expect(fechaDeResultados("2026-10-29", "2026-10-29")).toBe("2026-10-29");
    expect(fechaDeResultados("2026-12-15", null)).toBe("2026-12-15");
    expect(fechaDeResultados(null, undefined)).toBeNull();
  });
});
