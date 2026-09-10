import { describe, expect, it } from "vitest";
import { normalizeEventDate, parseCard, trimToLimit } from "../src/index.js";

describe("ficha: textos largos se recortan en vez de descartar la llamada", () => {
  it("trimToLimit corta en el último fin de oración que entra", () => {
    const s = "Primera oración. Segunda oración bastante larga. Tercera.";
    expect(trimToLimit(s, 1000)).toBe(s);
    expect(trimToLimit(s, 40)).toBe("Primera oración.");
    expect(trimToLimit("sinpuntosnininguncorte".repeat(5), 30)).toHaveLength(30);
    expect(trimToLimit("sinpuntosnininguncorte".repeat(5), 30).endsWith("…")).toBe(true);
  });
  it("parseCard acepta un resumen de 450 caracteres recortándolo a menos de 400", () => {
    const long = `${"Opera hospitales. ".repeat(25)}Fin.`; // ~450
    expect(long.length).toBeGreaterThan(400);
    const c = parseCard({ summary: long, whyRanks: long, mainRisk: long, moat: "fuerte", themes: [], degrade: false, degradeReason: "" }, []);
    expect(c.summary.length).toBeLessThanOrEqual(400);
    expect(c.summary.endsWith(".")).toBe(true);
    expect(c.mainRisk.length).toBeLessThanOrEqual(300);
  });
});

describe("tesis: eventDate se normaliza antes de validar", () => {
  it("con hora se queda con el día; en palabras cae a la fecha del evento; null queda null si el evento no tiene", () => {
    expect(normalizeEventDate("2026-09-25T00:00:00Z", "2026-01-01")).toBe("2026-09-25");
    expect(normalizeEventDate("2026-09-25", null)).toBe("2026-09-25");
    expect(normalizeEventDate("sin fecha", "2026-10-14")).toBe("2026-10-14");
    expect(normalizeEventDate("", null)).toBeNull();
    expect(normalizeEventDate(null, null)).toBeNull();
    expect(normalizeEventDate("2026-13-45", "2026-10-14")).toBe("2026-10-14");
  });
});
