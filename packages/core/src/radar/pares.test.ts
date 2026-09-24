import { describe, expect, it } from "vitest";
import type { Candle } from "../cartera/types.js";
import { parecidoConPares } from "./pares.js";

const dia = (i: number) => new Date(Date.parse("2025-09-01") + i * 86_400_000).toISOString().slice(0, 10);
const serie = (retornos: number[], desde = 0): Candle[] => {
  let p = 100;
  return retornos.map((r, i) => {
    p *= 1 + r;
    return { date: dia(i + desde), open: p, high: p, low: p, close: p, volume: 1 };
  });
};
// Ruido determinístico: dos "mercados" que no tienen nada que ver.
const ruido = (semilla: number, n = 260) => Array.from({ length: n }, (_, i) => Math.sin(i * semilla) * 0.01 + Math.cos(i * semilla * 1.7) * 0.004);

/**
 * 24/9: GLXY (cripto y centros de datos) salía 1 de 11 contra gestoras y BDC (OWL, CG, ARCC…), y VRSN (registro
 * monopólico) 1 de 11 contra software de crecimiento (NET, CRWV, TWLO…). Los pares vienen de Finnhub y comparten su
 * industria gruesa, así que comparar industrias no lo muestra. Lo que sí: cómo se mueve la acción con sus pares,
 * contra cómo se mueve con el mercado entero. Si se parece menos a sus pares que al S&P, los pares no son pares.
 */
describe("parecidoConPares", () => {
  const mercado = ruido(0.37);
  it("pares que se mueven con ella: mediana alta, por encima del mercado", () => {
    const propia = serie(mercado.map((r, i) => r + ruido(0.91)[i]! * 0.2));
    const pares = { P1: serie(mercado.map((r, i) => r + ruido(0.53)[i]! * 0.2)), P2: serie(mercado.map((r, i) => r + ruido(0.77)[i]! * 0.2)) };
    const m = parecidoConPares(propia, pares, serie(mercado.map((r, i) => r * 0.5 + ruido(1.3)[i]! * 0.5)))!;
    expect(m.mediana).toBeGreaterThan(0.8);
    expect(m.noSeParecen).toBe(false);
  });
  it("pares de otro negocio: se parece menos a ellos que al mercado → noSeParecen", () => {
    const propia = serie(mercado);
    const pares = { OWL: serie(ruido(1.11)), CG: serie(ruido(2.3)), ARCC: serie(ruido(0.29)) };
    const m = parecidoConPares(propia, pares, serie(mercado))!;
    expect(m.conMercado).toBeCloseTo(1, 5);
    expect(m.mediana!).toBeLessThan(m.conMercado!);
    expect(m.noSeParecen).toBe(true);
    expect(m.porPar.map((p) => p.symbol).sort()).toEqual(["ARCC", "CG", "OWL"]);
  });
  it("alinea por fecha, no por posición: un par con días de más o de menos no corre la serie", () => {
    const propia = serie(mercado);
    const corrido = serie(mercado).filter((_, i) => i % 7 !== 3); // le faltan días
    const m = parecidoConPares(propia, { X: corrido }, serie(mercado))!;
    expect(m.porPar[0]!.corr).toBeGreaterThan(0.95);
  });
  it("con menos de 60 días en común no afirma nada", () => {
    expect(parecidoConPares(serie(mercado.slice(0, 40)), { X: serie(mercado.slice(0, 40)) }, serie(mercado.slice(0, 40)))).toBeNull();
  });
});
