import { describe, expect, it } from "vitest";
import { SIM_CALENTAMIENTO, simular, tramoDeTamanio } from "./simulacion.js";
import type { Candle } from "../cartera/types.js";

/** Serie diaria desde una fecha, con cierres dados. `high`/`low` no los usa la simulación. */
const serie = (closes: number[], start = "2024-01-01"): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c, low: c, close: c, volume: 1_000_000 }));
const n = SIM_CALENTAMIENTO + 60;
/** Plano en 100 hasta el calentamiento y después sube: pasa la media de 200 y gana al índice plano. */
const sube = serie([...Array.from({ length: n - 40 }, () => 100), ...Array.from({ length: 40 }, (_, i) => 100 + i)]);
const plano = serie(Array.from({ length: n }, () => 100));

describe("simular", () => {
  it("mide alfa contra el índice en la misma ventana y agrupa por la compuerta técnica", () => {
    const r = simular([{ symbol: "SUBE", candles: sube, mcapUsd: 1e9 }], plano, [], { horizonte: 10, paso: 5 });
    expect(r.observaciones).toBeGreaterThan(0);
    const de = (c: string) => r.grupos.find((g) => g.clave === c)!;
    expect(de("todo").alfaProm).toBeGreaterThan(0); // sube contra un índice plano
    expect(de("todo").simbolos).toBe(1);
    expect(de("todo").pocosSimbolos).toBe(true); // un solo símbolo: lo dice
  });

  it("sin índice en las dos puntas no inventa alfa: devuelve vacío", () => {
    const r = simular([{ symbol: "X", candles: sube }], [], [], { horizonte: 10 });
    expect(r.observaciones).toBe(0);
    expect(r.grupos).toEqual([]);
  });

  it("una serie sin historia suficiente no aporta observaciones", () => {
    const corta = serie(Array.from({ length: 50 }, () => 100));
    const r = simular([{ symbol: "CORTA", candles: corta }], plano, [], { horizonte: 10 });
    expect(r.observaciones).toBe(0);
  });

  it("separa lo que está bajo la media de 200 de lo que está arriba", () => {
    // Cae al final: queda bajo su media de 200 y el grupo correspondiente se llena.
    const cae = serie([...Array.from({ length: n - 40 }, () => 100), ...Array.from({ length: 40 }, (_, i) => 100 - i)]);
    const r = simular([{ symbol: "CAE", candles: cae }], plano, [], { horizonte: 10, paso: 5 });
    const bajo = r.grupos.find((g) => g.clave === "bajo_sma200")!;
    expect(bajo.n).toBeGreaterThan(0);
    expect(bajo.alfaProm).toBeLessThan(0);
  });

  it("el régimen de cada fecha se calcula con la serie del 10 años recortada a esa fecha, no con el futuro", () => {
    // 10 años al 5%: restrictivo en todas las fechas. Si usara el futuro, el valor final no cambiaría el resultado,
    // pero con una serie que ARRANCA baja y termina alta, un cálculo con el futuro marcaría restrictivo desde el día 1.
    const tnxBajo = serie(Array.from({ length: n }, (_, i) => (i < n - 30 ? 30 : 55))); // 3,0% y después 5,5%
    const r = simular([{ symbol: "X", candles: sube, mcapUsd: 1e9 }], plano, tnxBajo, { horizonte: 10, paso: 5 });
    const restrictivo = r.grupos.find((g) => g.clave === "regimen_restrictivo")!;
    const neutral = r.grupos.find((g) => g.clave === "regimen_neutral")!;
    // Hay fechas de los dos regímenes: ninguno se come todas las observaciones.
    expect(restrictivo.n + neutral.n).toBe(r.observaciones);
    expect(neutral.n).toBeGreaterThan(0);
  });
});

describe("tramoDeTamanio", () => {
  it("parte en cuatro tramos y devuelve null sin capitalización", () => {
    expect(tramoDeTamanio(1e9)).toBe("a. menos de 2.000 M");
    expect(tramoDeTamanio(5e9)).toBe("b. 2.000 a 10.000 M");
    expect(tramoDeTamanio(20e9)).toBe("c. 10.000 a 50.000 M");
    expect(tramoDeTamanio(100e9)).toBe("d. más de 50.000 M");
    expect(tramoDeTamanio(null)).toBeNull();
    expect(tramoDeTamanio(0)).toBeNull();
  });
});
