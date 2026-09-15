import { describe, expect, it } from "vitest";
import { coberturaTexto, corteDelDia, cuotaDiaria, horaAR } from "./usoTextos";

/**
 * Pestaña Uso y panel de Corridas, auditoría del 15/9. Cuatro cosas que la pantalla decía mal:
 * - "agotada hoy" en la clave 1 de 2.5-flash desde el 429 de las 10:51, aunque respondió bien a las 14:56 y 15:48;
 * - los días sin registro (10 al 13/9) como si hubieran tenido cero llamadas;
 * - el corte del día a la medianoche de acá sin decir que la cuota de Gemini se reinicia a las 04:00;
 * - los 429 sin detalle (`limite`) no tenían columna.
 */
const fila = (o: Partial<{ rpd: number; limite: number; exhausted: boolean; lastRpdAt: string | null; lastOkAt: string | null }>) => ({ rpd: 0, limite: 0, exhausted: false, lastRpdAt: null, lastOkAt: null, ...o });

describe("cuotaDiaria", () => {
  it("2.5-flash clave 1 el 15/9: 429 por día a las 14:57 y respuesta buena a las 15:48 → no está agotada, y dice las dos horas", () => {
    const c = cuotaDiaria(fila({ rpd: 4, exhausted: false, lastRpdAt: "2026-09-15T17:57:19.000Z", lastOkAt: "2026-09-15T18:48:51.000Z" }));
    expect(c.texto).toBe("429 por día a las 14:57, pero respondió bien a las 15:48: no está agotada");
    expect(c.tono).toBe("warn");
  });
  it("con el último 429 por día sin nada bueno después, está agotada desde esa hora", () => {
    const c = cuotaDiaria(fila({ rpd: 6, exhausted: true, lastRpdAt: "2026-09-15T18:51:19.000Z", lastOkAt: "2026-09-15T18:48:51.000Z" }));
    expect(c.texto).toBe("agotada desde las 15:51");
    expect(c.tono).toBe("bad");
  });
  it("sin 429 por día no hay nada que decir de la cuota", () => {
    expect(cuotaDiaria(fila({ limite: 3 }))).toEqual({ texto: "—", tono: "muted" });
  });
});

describe("horaAR", () => {
  it("siempre en hora de Argentina, aunque el navegador esté en otra zona", () => {
    expect(horaAR("2026-09-15T13:51:42.000Z")).toBe("10:51");
    expect(horaAR("2026-09-15T13:51:42.000Z", true)).toBe("10:51:42");
  });
});

describe("coberturaTexto", () => {
  it("el 13/9 no hay registro: la pantalla lo dice en vez de mostrar cero llamadas", () => {
    expect(coberturaTexto("sin_registro", "2026-09-14T03:33:52.384Z")).toBe("sin registro: el registro de uso empieza el 14/9 a las 00:33");
    expect(coberturaTexto("parcial", "2026-09-14T03:33:52.384Z")).toBe("registro desde las 00:33 (antes no se registraba)");
    expect(coberturaTexto("completo", "2026-09-14T03:33:52.384Z")).toBeNull();
  });
});

describe("corteDelDia", () => {
  it("dice que el día se corta a la medianoche de acá y que la cuota de Gemini se reinicia a las 04:00", () => {
    expect(corteDelDia("2026-09-15T07:00:00.000Z")).toBe("El día va de 00:00 a 24:00, hora de Argentina. La cuota gratis de Gemini se reinicia a las 04:00: lo de 00:00 a 04:00 cuenta para la cuota del día anterior.");
    expect(corteDelDia(null)).toContain("medianoche de California");
  });
});
