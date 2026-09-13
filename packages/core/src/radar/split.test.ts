import { describe, expect, it } from "vitest";
import { crossesSplit, splitJumps, type Candle } from "../index.js";

const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1_000 });
/** n ruedas planas a `precio`, empezando el 2026-01-01. */
const plana = (n: number, precio: number, desde = 0): Candle[] =>
  Array.from({ length: n }, (_, i) => vela(new Date(Date.parse("2026-01-01") + (desde + i) * 86_400_000).toISOString().slice(0, 10), precio));

describe("splitJumps", () => {
  it("una serie continua no reporta nada", () => {
    expect(splitJumps(plana(300, 100))).toEqual([]);
  });

  /**
   * MIRG.BA el 12/9: la serie guardada pasa de 16.350 a 1.640 entre el 1 y el 3 de agosto de 2026. No fue
   * un derrumbe del 90%: fue un split 10 a 1 que Yahoo no ajustó hacia atrás. La fila del Radar mostraba
   * fuerza relativa de −93% a doce meses como si la empresa se hubiera hundido.
   */
  it("MIRG.BA: detecta el 10 a 1 y lo nombra por su razón, no por el porcentaje", () => {
    const serie = [...plana(150, 16_350), ...plana(150, 1_640, 150)];
    const j = splitJumps(serie);
    expect(j).toHaveLength(1);
    expect(j[0]!.matched).toBe(10);
    expect(j[0]!.from).toBe(16_350);
    expect(j[0]!.to).toBe(1_640);
  });

  it("también el reverse split, en el otro sentido", () => {
    const j = splitJumps([...plana(50, 2), ...plana(50, 20, 50)]);
    expect(j).toHaveLength(1);
    expect(j[0]!.matched).toBeCloseTo(0.1, 4);
  });

  it("sobre los 134 símbolos guardados del 13/9 marca exactamente uno: MIRG.BA", () => {
    // El resumen del barrido real, como prueba de que la regla no es teórica.
    const reales: Array<[number, number]> = [[16_350, 1_640], [33.99, 15.86], [30.03, 45.23], [30.79, 20.53], [139.33, 91.51], [105.13, 74.39], [52.75, 74.98], [47.03, 71.4], [149.18, 217.5], [308.88, 477.73], [9.5, 6.71]];
    const marcados = reales.filter(([a, b]) => splitJumps([...plana(30, a), ...plana(30, b, 30)]).length > 0);
    expect(marcados).toEqual([[16_350, 1_640]]);
  });

  /**
   * La otra mitad de la regla, y la que le da todo su valor: un desplome de un día es una catástrofe real y
   * tiene que seguir contando como catástrofe. Si el detector se la tragara, estaría escondiendo justo lo
   * que la app existe para ver.
   *
   * Estos cinco casos NO son inventados: son los falsos positivos que una versión anterior de este archivo
   * producía sobre los 134 símbolos guardados el 13/9. Marcaba once símbolos y diez eran movimientos reales.
   * Por eso los umbrales subieron. Si alguno de estos vuelve a dar "split", el detector volvió a romperse.
   */
  it.each([
    ["JANX", 33.99, 15.86, "ensayo clínico fallido, −53%"],
    ["MP", 30.03, 45.23, "acuerdo con Defensa, +51%"],
    ["SMCI", 30.79, 20.53, "−33%"],
    ["SEZL", 139.33, 91.51, "resultados, −34%"],
    ["CROX", 105.13, 74.39, "−29%"],
  ])("%s no es un split: %s → %s es un hecho real (%s)", (_sym, from, to) => {
    expect(splitJumps([...plana(50, from as number), ...plana(50, to as number, 50)])).toEqual([]);
  });

  it("tampoco un −25%, ni un +30%: son ruedas malas y buenas, no cambios de escala", () => {
    expect(splitJumps([...plana(50, 100), ...plana(50, 75, 50)])).toEqual([]);
    expect(splitJumps([...plana(50, 100), ...plana(50, 130, 50)])).toEqual([]);
  });

  /**
   * Lo que el detector deliberadamente NO cubre: un 2 a 1 es aritméticamente indistinguible de un −50%, y
   * un −50% en una rueda existe. Se prefiere dejarlo pasar antes que tapar un derrumbe. El caso de APH, que
   * fue un 2 a 1, lo agarra el chequeo de objetivos de analistas fuera de escala.
   */
  it("un 2 a 1 queda fuera a propósito: no se puede distinguir de un −50% real", () => {
    expect(splitJumps([...plana(50, 168), ...plana(50, 84, 50)])).toEqual([]);
  });

  it("un split real nunca cae exacto: 10 a 1 con el precio moviéndose 2% ese día sigue siendo split", () => {
    const j = splitJumps([...plana(50, 16_350), ...plana(50, 1_668, 50)]);
    expect(j).toHaveLength(1);
    expect(j[0]!.matched).toBe(10);
  });
});

describe("crossesSplit", () => {
  const serie = [...plana(150, 16_350), ...plana(150, 1_640, 150)];

  it("la ventana que cruza el salto lo reporta", () => {
    expect(crossesSplit(serie, 252)).not.toBeNull();
  });

  it("la ventana corta, toda del lado nuevo, no: ahí los números sí valen", () => {
    expect(crossesSplit(serie, 60)).toBeNull();
  });
});
