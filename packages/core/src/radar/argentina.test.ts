import { describe, expect, it } from "vitest";
import type { Candle } from "../cartera/types.js";
import { cedearCheck, decideArStock, macroAr } from "./argentina.js";

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
  it("sin CCL no inventa brecha ni Merval en dólares", () => {
    const m = macroAr({ date: "2026-09-07", dolares: { oficial: 1530 }, riesgoPais: null, merval: null });
    expect(m.ccl).toBeNull();
    expect(m.brechaPct).toBeNull();
    expect(m.mervalUsd).toBeNull();
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
    expect(d.reasons.some((r) => r.includes("Merval"))).toBe(true);
    expect(d.reasons).toContain("bajo SMA200");
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
