import { describe, expect, it } from "vitest";
import { atrSeries, chandelierSeries, computeTrailingStop, rsiSeries, sma, smaSeries, type Bar, type Candle } from "../index.js";

const barras = (closes: number[], rango = 2): Bar[] => closes.map((c) => ({ high: c + rango / 2, low: c - rango / 2, close: c }));
const velas = (closes: number[], rango = 2): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse("2026-01-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + rango / 2, low: c - rango / 2, close: c, volume: 1_000 }));

describe("smaSeries", () => {
  it("null hasta tener n barras y después el promedio", () => {
    const s = smaSeries(barras([1, 2, 3, 4, 5]), 3);
    expect(s).toEqual([null, null, 2, 3, 4]);
  });

  it("coincide con la media puntual que usa el Radar para decidir", () => {
    // Si estas dos se separan, el gráfico dibujaría una media distinta de la que decide el veredicto.
    const c = velas(Array.from({ length: 60 }, (_, i) => 100 + i * 0.7));
    for (const n of [20, 50]) {
      const serie = smaSeries(c, n);
      expect(serie[serie.length - 1]).toBeCloseTo(sma(c, n)!, 2);
    }
  });

  it("serie más corta que la ventana devuelve todo null", () => {
    expect(smaSeries(barras([1, 2]), 5)).toEqual([null, null]);
  });
});

describe("atrSeries", () => {
  it("con rango constante y sin saltos, el ATR es ese rango", () => {
    const s = atrSeries(barras(Array(30).fill(100), 2), 22);
    expect(s[29]).toBeCloseTo(2, 6);
    expect(s[20]).toBeNull();
  });
});

describe("chandelierSeries", () => {
  it("es el máximo de la ventana menos 3 ATR", () => {
    const b = barras(Array(30).fill(100), 2);
    // Máximo de las 22 barras = 101; ATR = 2; stop = 101 - 6 = 95.
    expect(chandelierSeries(b, 22, 3)[29]).toBeCloseTo(95, 6);
  });

  it("el último valor coincide con el stop que el Radar guarda en la fila", () => {
    // Si se separan, el gráfico mostraría una línea de stop distinta de la que dispara "bajo_stop".
    const c = velas(Array.from({ length: 80 }, (_, i) => 80 + i * 0.4));
    const serie = chandelierSeries(c, 22, 3);
    expect(serie[serie.length - 1]).toBeCloseTo(computeTrailingStop(c)!, 2);
  });
});

describe("rsiSeries", () => {
  it("una serie que solo sube da 100 y una que solo baja da 0", () => {
    expect(rsiSeries(barras(Array.from({ length: 40 }, (_, i) => 100 + i)))[39]).toBeCloseTo(100, 6);
    expect(rsiSeries(barras(Array.from({ length: 40 }, (_, i) => 140 - i)))[39]).toBeCloseTo(0, 6);
  });

  it("null hasta tener las 14 barras de arranque", () => {
    const s = rsiSeries(barras(Array.from({ length: 20 }, (_, i) => 100 + (i % 3))));
    expect(s.slice(0, 14).every((x) => x === null)).toBe(true);
    expect(s[14]).not.toBeNull();
  });

  it("serie más corta que la ventana devuelve todo null", () => {
    expect(rsiSeries(barras([1, 2, 3]))).toEqual([null, null, null]);
  });
});
