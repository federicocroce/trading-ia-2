import { describe, expect, it } from "vitest";
import { medirFrenos } from "./frenos.js";

/*
 * 18/9: del 10/9 al 17/9 se agregó casi una regla por día y casi todas frenan ("subió más de 100%", "consenso cerca",
 * banco sin estados…). Cada una salió de un caso real, pero ninguna se midió: nadie sabe si lo que dejaron afuera después
 * subió o bajó. Esto lo mide con lo que la app ya guarda (el alfa contra el S&P de cada fila a 7, 30 y 90 días).
 */
const fila = (symbol: string, candidateDate: string, flags: string[], alpha7dPct: number | null, over: { kind?: string; verdict?: string; alpha30dPct?: number | null } = {}) => ({ symbol, candidateDate, kind: over.kind ?? "stock", verdict: over.verdict ?? "COMPRAR", flags, alpha7dPct, alpha30dPct: over.alpha30dPct ?? null, alpha90dPct: null });

describe("medirFrenos", () => {
  const filas = [
    fila("APH", "2026-09-14", ["consenso_compra"], 2),
    fila("APH", "2026-09-15", ["consenso_compra"], 4),
    fila("NVDA", "2026-09-14", [], -1),
    fila("SNDK", "2026-09-14", ["subio_mucho_12m"], 9),
    fila("SIMO", "2026-09-14", ["subio_mucho_12m", "consenso_compra"], -3),
    fila("NBN", "2026-09-14", ["banco_sin_estados"], 1, { verdict: "OBSERVAR" }),
    fila("MEDP", "2026-09-14", ["consenso_en_precio", "verificacion_reservas"], 5),
    fila("PAM", "2026-09-14", ["bajo_sma200", "subio_mucho_12m"], -8, { verdict: "OBSERVAR" }),
    fila("TSM", "2026-09-14", ["verificacion_reservas"], null),
    fila("QQQ", "2026-09-14", ["subio_mucho_12m"], 7, { kind: "etf" }),
  ];
  const m = medirFrenos(filas, 7);
  const de = (clave: string) => m.grupos.find((g) => g.clave === clave)!;

  it("compara lo que ningún freno tocó con lo que cada freno dejó afuera, solo entre lo que la técnica dejaba comprar", () => {
    expect(de("sin_freno")).toMatchObject({ n: 3, simbolos: 2, alfa: 1.67, acierto: 67 });
    expect(de("subio_mucho_12m")).toMatchObject({ n: 2, simbolos: 2, alfa: 3, acierto: 50 });
    expect(de("consenso_en_precio")).toMatchObject({ n: 1, alfa: 5 });
    expect(de("banco_sin_estados")).toMatchObject({ n: 1, alfa: 1 });
    // PAM estaba bajo su media de 200: la frenaba la técnica, no la regla de precio. Los ETFs no entran. Sin medir, no cuenta.
    expect(m.grupos.flatMap((g) => g.lista)).not.toContain("PAM");
    expect(m.grupos.flatMap((g) => g.lista)).not.toContain("QQQ");
    expect(m.sinMedir).toBe(1);
  });
  it("la verificación web se mide aparte: es un aviso, no un freno", () => {
    expect(de("verificacion_reservas")).toMatchObject({ n: 1, alfa: 5 });
  });
  it("dice qué costó cada freno: la diferencia contra lo que no tocó ninguno; y con pocas filas lo advierte", () => {
    expect(de("subio_mucho_12m").contraSinFreno).toBe(1.33);
    expect(de("sin_freno").contraSinFreno).toBeNull();
    expect(de("subio_mucho_12m").pocasFilas).toBe(true);
    expect(m.desde).toBe("2026-09-14");
    expect(m.hasta).toBe("2026-09-15");
  });
  it("sin filas medidas a ese horizonte devuelve los grupos vacíos, sin inventar un promedio", () => {
    const v = medirFrenos(filas, 30);
    expect(v.grupos.every((g) => g.n === 0 && g.alfa === null)).toBe(true);
  });
});
