import { describe, expect, it } from "vitest";
import { AXES, AXIS_METRICS } from "../../../packages/core/src/radar/ranking.js";
import { COLUMNAS, celdaPropia } from "./comparablesTabla";

/**
 * Tabla de comparables, auditoría del 15/9. Decía "de eso salen el score y el ranking" y mostraba 7 de las 12 métricas
 * del puntaje; y en NBN, un banco, mostraba una mediana de crecimiento de 53,2% y pintaba en verde su 123,9%, cuando el
 * ranking no usa ese dato en bancos.
 */
describe("COLUMNAS", () => {
  it("son exactamente las 12 métricas del puntaje, en el orden de sus ejes", () => {
    expect(COLUMNAS.map((c) => c.key)).toEqual(AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key)));
    expect(COLUMNAS).toHaveLength(12);
  });
  it("el sentido de cada columna es el del puntaje (invertida = más bajo es mejor)", () => {
    const invert = Object.fromEntries(AXES.flatMap((a) => AXIS_METRICS[a].map((m) => [m.key, m.invert])));
    for (const c of COLUMNAS) expect(c.mejor === "bajo").toBe(invert[c.key]);
  });
});

describe("celdaPropia", () => {
  it("NBN el 15/9: su crecimiento de ingresos (123,9%) no cuenta para el puntaje: va en gris y lo dice, sin verde", () => {
    const c = celdaPropia({ key: "revenueGrowthTTMYoy", valor: 123.8872, mediana: null, excluida: true });
    expect(c.clase).toBe("muted");
    expect(c.texto).toBe("123.9%");
    expect(c.title).toContain("no lo usa");
  });
  it("APH: P/E 39,7 contra una mediana de 66,0 le gana (más bajo es mejor) y va en verde", () => {
    expect(celdaPropia({ key: "peTTM", valor: 39.6883, mediana: 66.0158, excluida: false }).clase).toBe("ok");
    expect(celdaPropia({ key: "operatingMarginTTM", valor: 10, mediana: 14.52, excluida: false }).clase).toBe("bad");
  });
});
