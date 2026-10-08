import { describe, expect, it } from "vitest";
import type { Candle } from "../cartera/types.js";
import { cedearCheck, decideArStock, macroAr, VOL_MINIMO_USD } from "./argentina.js";

const series = (n: number, from: number, to: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = from + ((to - from) * i) / (n - 1);
    return { date: new Date(Date.parse("2025-06-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 };
  });
const technical = { maxReturn21dPct: 15, earningsWithinDays: 10 };

describe("macroAr", () => {
  it("brecha CCL contra oficial y Merval en dólares", () => {
    const m = macroAr({ date: "2026-09-07", dolares: { oficial: 1530, mep: 1533.7, ccl: 1583.2, blue: 1545, mayorista: 1511.5 }, riesgoPais: 490, merval: 3_034_598.8 });
    expect(m.brechaPct).toBeCloseTo(3.48, 1);
    expect(m.mervalUsd).toBeCloseTo(1916.7, 0);
    expect(m.riesgoPais).toBe(490);
  });
  /*
   * 6/10/2026. El riesgo país se guardaba con la fecha de la CORRIDA y se descartaba la que trae la fuente.
   * Comparado contra argentinadatos, la serie de la app coincidía con el día hábil ANTERIOR en 20 de 20 fechas:
   * decía "655 al 5/10" cuando 655 es del viernes 2/10, y "636 al 2/10" cuando 636 es del 1/10. La pantalla lo
   * empeoraba mostrando un delta "vs {fecha anterior}": las dos fechas mal.
   *
   * Es el mismo arreglo que ya tenía el Merval con `mervalDate`, en esta misma función, para el campo de al lado.
   */
  it("guarda la fecha del dato de riesgo país, no la de la corrida", () => {
    const m = macroAr({ date: "2026-10-05", dolares: { oficial: 1540, ccl: 1623.8 }, riesgoPais: 655, riesgoPaisDate: "2026-10-02", merval: 2_767_663, mervalDate: "2026-10-02" });
    expect(m.date).toBe("2026-10-05");
    expect(m.riesgoPais).toBe(655);
    expect(m.riesgoPaisDate).toBe("2026-10-02");
  });
  it("sin fecha de la fuente no la inventa: queda null y la pantalla no afirma de cuándo es", () => {
    const m = macroAr({ date: "2026-10-05", dolares: { oficial: 1540 }, riesgoPais: 655, merval: null });
    expect(m.riesgoPaisDate).toBeNull();
  });
  it("sin CCL no inventa brecha ni Merval en dólares", () => {
    const m = macroAr({ date: "2026-09-07", dolares: { oficial: 1530 }, riesgoPais: null, merval: null });
    expect(m.ccl).toBeNull();
    expect(m.brechaPct).toBeNull();
    expect(m.mervalUsd).toBeNull();
  });
});

describe("decideArStock: retorno absoluto y liquidez (2026-10-06)", () => {
  /*
   * Dos huecos que el informe de /mercado del 5/10 dejó escritos.
   *
   * 1) La fila mostraba fuerza relativa SIN el retorno absoluto al lado. METR.BA salía con fuerza relativa a
   *    3 meses de +45,9% y su movimiento absoluto era +16,33%: dos tercios de ese número eran el Merval
   *    cayendo ~20% en el trimestre, no METR subiendo. En el último mes METR estaba en rojo (−4,19%) y en el
   *    año −10,23%. Un +45,9% en una columna sin contexto se lee como una tendencia potente.
   *
   * 2) No se medía liquidez. `/cartera/risk` trae `avgDollarVolume30d` y `daysToLiquidate` para cada ADR, y la
   *    fila de BYMA no tenía ninguna de las dos. LEDE.BA mueve USD 7.600 por día y BOLT.BA USD 13-15 mil:
   *    los dos aparecían como candidatos sin una advertencia. Una posición de USD 5.000 en BOLT es un tercio
   *    del volumen diario del papel.
   */
  it("devuelve el retorno absoluto además de la fuerza relativa", () => {
    /*
     * La forma del caso METR: el papel sube poco y el ÍNDICE CAE. Ahí la fuerza relativa queda muy por encima
     * del movimiento real del papel, que es exactamente lo que la fila no mostraba. Con el Merval en baja, la
     * fuerza relativa de todo el panel se infla a la vez.
     */
    const d = decideArStock(series(260, 1000, 1200), series(260, 1400, 1000), 1583.2, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.ret6mPct).not.toBeNull();
    expect(d.rs6m!).toBeGreaterThan(d.ret6mPct!);
    // Y el absoluto sigue siendo el movimiento del papel, no el relativo.
    expect(d.ret3mPct).not.toBeNull();
    expect(d.ret6mPct!).toBeLessThan(d.rs6m!);
  });
  it("mide el volumen diario en dólares y marca el papel que no lo soporta", () => {
    // 10.000 nominales/día a ~$700 con CCL 1.550: unos USD 4.500 por día. Es LEDE.BA.
    const ilíquido = series(260, 500, 700).map((c) => ({ ...c, volume: 10_000 }));
    const d = decideArStock(ilíquido, series(260, 1000, 1200), 1550, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.volUsd).not.toBeNull();
    expect(d.volUsd!).toBeLessThan(VOL_MINIMO_USD);
    expect(d.reasons).toContain("poco_volumen");
  });
  it("un papel con volumen de sobra no queda marcado", () => {
    // 300.000 nominales/día a ~$2.300 con CCL 1.550: unos USD 445.000 por día. Es METR.BA.
    const líquido = series(260, 1500, 2300).map((c) => ({ ...c, volume: 300_000 }));
    const d = decideArStock(líquido, series(260, 1000, 1200), 1550, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.volUsd!).toBeGreaterThan(VOL_MINIMO_USD);
    expect(d.reasons).not.toContain("poco_volumen");
  });
  it("sin CCL no inventa el volumen en dólares", () => {
    const d = decideArStock(series(260, 1000, 2000).map((c) => ({ ...c, volume: 10_000 })), series(260, 1000, 1500), null, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.volUsd).toBeNull();
    expect(d.reasons).not.toContain("poco_volumen");
  });
});

describe("decideArStock", () => {
  it("COMPRAR: le gana al Merval a 6 meses y está sobre la SMA200; precio también en dólares CCL", () => {
    const d = decideArStock(series(260, 1000, 2000), series(260, 1000, 1500), 1583.2, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.verdict).toBe("COMPRAR");
    expect(d.rs6m).toBeGreaterThan(0);
    expect(d.close).toBe(2000);
    expect(d.closeUsd).toBeCloseTo(1.26, 2);
    expect(d.stop).not.toBeNull();
  });
  /**
   * BBAR, BYMA, RICH, TGNO4, TRAN y VALO el 12/9: los seis venían cayendo, quedaron con el cierre por
   * debajo de su stop dinámico, y la pantalla publicaba igual un objetivo calculado como
   * close + 2 × (close − stop), que con el stop ARRIBA del precio da un objetivo DEBAJO del precio.
   * BYMA: comprar a 264 para vender a 261,90. Las acciones US y los ETFs ya tenían esta guarda.
   */
  it("bajo su propio stop no lleva objetivo: el 2 a 1 daría un objetivo debajo del precio", () => {
    const d = decideArStock(series(260, 2000, 1000), series(260, 1000, 1500), 1583.2, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.stop).not.toBeNull();
    expect(d.close).toBeLessThanOrEqual(d.stop!);
    expect(d.target).toBeNull();
    expect(d.reasons).toContain("bajo_stop");
  });

  it("arriba del stop sí lleva objetivo, y queda por encima del precio", () => {
    const d = decideArStock(series(260, 1000, 2000), series(260, 1000, 1500), 1583.2, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.target).not.toBeNull();
    expect(d.target!).toBeGreaterThan(d.close);
  });

  it("OBSERVAR cuando pierde contra el Merval o está bajo la SMA200, con la razón", () => {
    const d = decideArStock(series(260, 2000, 1000), series(260, 1000, 1500), 1583.2, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.verdict).toBe("OBSERVAR");
    // Nombre estable más el dato detrás de los dos puntos: la pantalla lo traduce, no lo muestra crudo.
    expect(d.reasons.some((r) => r.startsWith("fr6m_negativa_merval:"))).toBe(true);
    expect(d.reasons).toContain("bajo_sma200");
  });
  it("sin 200 ruedas queda excluida; sin CCL no hay precio en dólares", () => {
    expect(decideArStock(series(50, 1, 2), series(260, 1, 2), 1583.2, technical)).toEqual({ excluded: true, reasons: ["sin_historial"] });
    const d = decideArStock(series(260, 1000, 2000), series(260, 1000, 1500), null, technical);
    if ("excluded" in d) throw new Error("excluida");
    expect(d.closeUsd).toBeNull();
  });
});

describe("cedearCheck", () => {
  const aapl = { symbol: "AAPL.BA", us: "AAPL", ratio: 20 };
  it("dólar implícito en línea con el CCL", () => {
    const c = cedearCheck(aapl, 25320, 319.8, 1583.2);
    expect(c.impliedCcl).toBeCloseTo(1583.5, 0);
    expect(c.flag).toBe("en_linea");
    expect(c.priceUsd).toBeCloseTo(319.9, 0);
  });
  it("caro o barato contra el CCL cuando la brecha supera 2%", () => {
    expect(cedearCheck(aapl, 26200, 319.8, 1583.2).flag).toBe("caro_vs_ccl");
    expect(cedearCheck(aapl, 24500, 319.8, 1583.2).flag).toBe("barato_vs_ccl");
  });
  it("una brecha mayor a 10% delata un ratio mal cargado, no una oportunidad", () => {
    const c = cedearCheck({ ...aapl, ratio: 10 }, 25320, 319.8, 1583.2);
    expect(c.flag).toBe("ratio_dudoso");
    expect(c.gapPct).toBeCloseTo(-50, 0);
  });
});
