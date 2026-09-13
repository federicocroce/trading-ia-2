import { describe, expect, it } from "vitest";
import { decideEtf, relativeStrength, relativeStrengthDetail, type Candle, type EtfConfig } from "../index.js";

const series = (closes: number[], start = "2025-09-01"): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
const ramp = (from: number, to: number, n = 260) => Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
const spy = series(ramp(100, 110));
const strong = series(ramp(100, 130));
const weak = series(ramp(100, 100));
const tech = { maxReturn21dPct: 15, earningsWithinDays: 10 };
const cfg = (role: EtfConfig["role"]): EtfConfig => ({ symbol: "X", name: "X", role, exposure: "rv_us", ter: 0.1, themes: [] });

/** Serie con dividendos: `adjClose` crece más que `close`, que es lo que pasa con un ETF que paga cupón. */
const conDividendos = (closes: number[], rendimientoTotal: number[], start = "2025-09-01"): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, adjClose: rendimientoTotal[i]!, volume: 1_000_000 }));

describe("relativeStrength", () => {
  it("(1+r_etf)/(1+r_spy) − 1 en %", () => {
    const etf = series([100, 110]);
    const s = series([100, 105]);
    expect(relativeStrength(etf, s, 1)).toBeCloseTo(4.7619, 3);
    expect(relativeStrength(etf, s, 5)).toBeNull();
  });

  /**
   * El caso SGOV: un ETF de letras cuyo precio no se mueve pero que rinde por cupón. Medido solo por precio
   * daba 0,0% a doce meses y parecía perderle al SPY por todo lo que el SPY subió. La fuerza relativa es el
   * ÚNICO criterio con el que se decide un ETF satélite, así que el sesgo cambiaba el veredicto.
   */
  it("cuenta los dividendos cuando las dos series los traen", () => {
    const letras = conDividendos([100, 100], [100, 103.4]);
    const indice = conDividendos([100, 105], [100, 106]);
    const d = relativeStrengthDetail(letras, indice, 1)!;
    expect(d.partial).toBe(false);
    // 3,4% contra 6%: pierde, pero mucho menos que el 0% contra 5% que daba antes.
    expect(d.pct).toBeCloseTo(((1.034 / 1.06) - 1) * 100, 2);
  });

  /**
   * Y la otra mitad: si UNA de las dos no trae dividendos, se miden las dos por precio. Comparar retorno
   * total contra retorno de precio es peor que comparar precio contra precio, porque el sesgo queda de un
   * solo lado y no se ve. `partial` es lo que la pantalla usa para decirlo.
   */
  it("si una serie no trae dividendos, las dos se miden por precio y queda marcado", () => {
    const sinAdj = series([100, 100]);
    const indice = conDividendos([100, 105], [100, 106]);
    const d = relativeStrengthDetail(sinAdj, indice, 1)!;
    expect(d.partial).toBe(true);
    expect(d.pct).toBeCloseTo(((1 / 1.05) - 1) * 100, 2);
  });
});

describe("decideEtf", () => {
  it("núcleo → NUCLEO siempre, sin stop ni objetivo: se compra por calendario y se mantiene", () => {
    const d = decideEtf(cfg("nucleo"), weak, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("NUCLEO");
    expect(d.rs6m).toBeLessThan(0);
    expect(d.stop).toBeNull();
    expect(d.target).toBeNull();
  });
  it("satélite que cierra bajo su stop dinámico → OBSERVAR con bajo_stop y sin objetivo (nunca un objetivo por debajo del precio)", () => {
    // Sube fuerte y en las últimas ruedas cae: el stop chandelier queda por encima del cierre.
    const falling = series([...ramp(100, 140, 240), ...ramp(140, 118, 20)]);
    const d = decideEtf(cfg("satelite"), falling, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.stop).not.toBeNull();
    expect(d.stop!).toBeGreaterThan(d.close);
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.reasons).toContain("bajo_stop");
    expect(d.target).toBeNull();
  });
  it("satélite fuerte, sobre SMA200 y sin perseguir → COMPRAR", () => {
    const d = decideEtf(cfg("satelite"), strong, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("COMPRAR");
    expect(d.rs6m).toBeGreaterThan(0);
    expect(d.stop).toBeLessThan(d.close);
  });
  it("satélite débil → OBSERVAR con motivo", () => {
    const d = decideEtf(cfg("satelite"), weak, spy, tech);
    if ("excluded" in d) throw new Error("no");
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.reasons.some((r) => r.startsWith("fr6m_negativa:"))).toBe(true);
  });
  it("sin velas suficientes → excluido", () => {
    expect(decideEtf(cfg("satelite"), strong.slice(-50), spy, tech)).toEqual({ excluded: true, reasons: ["sin_historial"] });
  });

  /**
   * YPF el 13/9 (evaluado con este motor como ADR): franja 51,49–52,01 y stop 51,51. Esperar la entrada que
   * pide la app dispara el stop. El motor de acciones ya degradaba este caso; este lo dejaba en COMPRAR.
   */
  it("con el stop dentro de la franja de compra no queda en COMPRAR", () => {
    // Subida firme con velas de rango muy chico: el ATR queda bajo, así que el stop (máximo de 22 menos 3
    // ATR) termina por ENCIMA de la media de 20, que es donde la app manda esperar el retroceso. Sube 11,6%
    // en 21 ruedas, debajo del 15% de "no perseguir", para que el único motivo posible sea el del test.
    const closes = [...Array.from({ length: 238 }, (_, i) => 100 + i * 0.34), ...Array.from({ length: 22 }, (_, i) => 181 + i)];
    const velas = closes.map((c, i) => ({ date: new Date(Date.parse("2025-09-01") + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + 0.05, low: c - 0.05, close: c, volume: 1_000_000 }));
    const d = decideEtf(cfg("satelite"), velas, spy, tech);
    if ("excluded" in d) throw new Error("no");
    if (d.target === null && d.stop !== null && !d.reasons.includes("bajo_stop")) {
      expect(d.reasons).toContain("stop_dentro_de_la_entrada");
      expect(d.verdict).toBe("OBSERVAR");
    } else {
      // Si la serie no reproduce el caso, el test tiene que decirlo en vez de pasar vacío.
      expect.fail(`la serie no reprodujo el stop dentro de la franja: target ${d.target}, stop ${d.stop}, entrada ${JSON.stringify(d.entry)}`);
    }
  });
});
