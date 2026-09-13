import { describe, expect, it } from "vitest";
import { checkPantallas, type Pantallas } from "../index.js";

const base: Pantallas = { candidatos: [], plan: null, veredictos: [] };
const cand = (symbol: string, over: Partial<Pantallas["candidatos"][number]> = {}) =>
  ({ symbol, verdict: "COMPRAR", close: 100, stop: 92, flags: [], entry: { state: "en_zona", low: 100, high: 102 }, ...over });
const linea = (symbol: string, over: Record<string, unknown> = {}) =>
  ({ symbol, kind: "comprar", close: 100, stop: 92, entry: { state: "en_zona" }, ...over }) as Pantallas["plan"] extends null ? never : NonNullable<Pantallas["plan"]>["lines"][number];
const solo = (check: string, f: ReturnType<typeof checkPantallas>) => f.filter((x) => x.check === check);

describe("checkPantallas", () => {
  it("una app coherente no reporta nada", () => {
    const f = checkPantallas({ ...base, candidatos: [cand("NVDA")], plan: { lines: [linea("NVDA")] }, veredictos: [{ symbol: "NVDA", verb: "MANTENER", close: 100, stop: 92 }] });
    expect(f).toEqual([]);
  });

  it("el caso que pidió el dueño: compra en una pantalla y venta en otra", () => {
    const f = solo("compra_y_venta", checkPantallas({ ...base, candidatos: [cand("PAM")], veredictos: [{ symbol: "PAM", verb: "VENDER", close: 100, stop: 92 }] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("Cartera propone sumar algo que el Radar tiene en OBSERVAR", () => {
    const f = solo("sumar_y_observar", checkPantallas({ ...base, candidatos: [cand("HUT", { verdict: "OBSERVAR" })], veredictos: [{ symbol: "HUT", verb: "SUMAR", close: 100, stop: 92 }] }));
    expect(f).toHaveLength(1);
  });

  it("dos precios distintos para el mismo símbolo el mismo día", () => {
    const f = solo("precio_distinto", checkPantallas({ ...base, candidatos: [cand("APH", { close: 83.92 })], veredictos: [{ symbol: "APH", verb: "MANTENER", close: 80.25, stop: 78 }] }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("83.92");
  });

  it("dos stops distintos son dos órdenes distintas", () => {
    const f = solo("stop_distinto", checkPantallas({ ...base, candidatos: [cand("NBN", { stop: 127.72 })], plan: { lines: [linea("NBN", { stop: 130.5 })] } }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("el plan compra algo que el Radar no tiene en COMPRAR", () => {
    const f = solo("plan_contra_radar", checkPantallas({ ...base, candidatos: [cand("DVA", { verdict: "OBSERVAR" })], plan: { lines: [linea("DVA")] } }));
    expect(f).toHaveLength(1);
  });

  it("el plan compra algo que ni aparece en los candidatos", () => {
    const f = solo("plan_sin_candidato", checkPantallas({ ...base, plan: { lines: [linea("BLBD")] } }));
    expect(f).toHaveLength(1);
  });

  it("el núcleo no necesita estar entre los candidatos", () => {
    const f = checkPantallas({ ...base, plan: { lines: [linea("VTI", { kind: "nucleo", stop: null, entry: null })] } });
    expect(f).toEqual([]);
  });

  it("el plan y la ficha no pueden dar instrucciones distintas de cuándo entrar", () => {
    const f = solo("entrada_distinta", checkPantallas({ ...base, candidatos: [cand("META", { entry: { state: "esperar_retroceso", low: 580, high: 586 } })], plan: { lines: [linea("META", { entry: { state: "en_zona" } })] } }));
    expect(f).toHaveLength(1);
  });

  it("V del 12/9: el objetivo no puede quedar debajo del precio que la misma línea manda pagar", () => {
    const f = solo("objetivo_bajo_la_entrada", checkPantallas({
      ...base, candidatos: [cand("V")],
      plan: { lines: [linea("V", { entryHigh: 377.86, target: 375.05, stop: 368.15 })] },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("nace perdida");
  });

  it("una línea sana, con el objetivo arriba de la entrada, no se reporta", () => {
    const f = solo("objetivo_bajo_la_entrada", checkPantallas({
      ...base, candidatos: [cand("NBN")],
      plan: { lines: [linea("NBN", { entryHigh: 135.29, target: 150.43, stop: 127.72 })] },
    }));
    expect(f).toEqual([]);
  });

  it("TSM del 12/9: un símbolo no puede recibir plata dos veces en el mismo plan", () => {
    const f = solo("simbolo_duplicado", checkPantallas({
      ...base, candidatos: [cand("TSM")],
      plan: { lines: [linea("TSM", { kind: "sumar" }), linea("TSM", { kind: "comprar" })] },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("no se puede estar comprado y excluido a la vez", () => {
    const f = solo("comprado_y_excluido", checkPantallas({ ...base, candidatos: [cand("LNC")], plan: { lines: [linea("LNC")], leftOut: [{ symbol: "LNC", reason: "tope de nuevas" }] } }));
    expect(f).toHaveLength(1);
  });

  it("Hoy no puede anunciar un cambio que el Radar no muestra", () => {
    const f = solo("novedad_desfasada", checkPantallas({ ...base, candidatos: [cand("GLW", { verdict: "COMPRAR" })], novedades: { verdictChanges: [{ symbol: "GLW", from: "COMPRAR", to: "OBSERVAR" }] } }));
    expect(f).toHaveLength(1);
  });

  /**
   * GGAL el 13/9: Cartera mostraba 920,77 acciones y los movimientos cargados sumaban 909,12 (901,28
   * compradas más 7,84 recibidas por dividendo reinvertido). Once acciones y media, unos 500 dólares, que
   * ninguna de las dos pantallas podía explicar. Son el mismo dato en dos lugares y nadie los comparaba.
   */
  it("la cantidad de Cartera tiene que salir de los movimientos de Operaciones", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "GGAL", quantity: 920.77279309 }],
      movimientos: [
        { symbol: "GGAL", type: "BUY", quantity: 901.27643196 },
        { symbol: "GGAL", type: "DIVIDEND", quantity: 7.84498722 },
      ],
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("11.651");
  });

  it("con los movimientos completos no se reporta nada, y una venta resta", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "TSM", quantity: 8 }],
      movimientos: [
        { symbol: "TSM", type: "BUY", quantity: 10 },
        { symbol: "TSM", type: "SELL", quantity: 2 },
        { symbol: "TSM", type: "TRANSFER", quantity: 999 },
      ],
    }));
    expect(f).toEqual([]);
  });

  it("un símbolo sin ningún movimiento cargado no se reporta: es una carga pendiente, no una contradicción", () => {
    const f = solo("cantidad_sin_respaldo", checkPantallas({
      ...base,
      posiciones: [{ symbol: "NEM", quantity: 100 }],
      movimientos: [{ symbol: "TSM", type: "BUY", quantity: 10 }],
    }));
    expect(f).toEqual([]);
  });
});
