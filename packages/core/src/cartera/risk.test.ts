import { describe, expect, it } from "vitest";
import { beta, buildRiskReport, correlation, fechaDeCierre, hhi, type Candle, type Position } from "./index.js";

const series = (closes: number[], volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume }));
const walk = (n: number, start: number, step: (i: number) => number) => {
  const out = [start];
  for (let i = 1; i < n; i++) out.push(out[i - 1]! * (1 + step(i)));
  return out;
};
const spy = series(walk(130, 100, (i) => (i % 2 ? 0.01 : -0.005)));
const doubleSpy = series(walk(130, 50, (i) => (i % 2 ? 0.02 : -0.01))); // beta ≈ 2, corr 1
const flat = series(Array(130).fill(20), 100);

const pos = (symbol: string, quantity: number, market: Position["market"] = "us"): Position => ({ symbol, quantity, avgCost: 1, currency: "USD", market, layer: "riesgo", notes: null });

describe("estadísticos", () => {
  it("correlación 1 entre series proporcionales, null con < 20 puntos", () => {
    expect(correlation([1, 2, 3, 4, 5].concat(Array(20).fill(1)), [2, 4, 6, 8, 10].concat(Array(20).fill(2)))).toBeCloseTo(1, 6);
    expect(correlation([1, 2], [2, 4])).toBeNull();
  });
  it("beta ≈ 2 de una serie que se mueve el doble", () => {
    const r = (c: Candle[]) => c.slice(1).map((x, i) => x.close / c[i]!.close - 1);
    expect(beta(r(doubleSpy), r(spy))).toBeCloseTo(2, 1);
  });
  it("HHI de dos mitades = 5000; de uno solo = 10000", () => {
    expect(hhi({ AR: 50, US: 50 })).toBe(5000);
    expect(hhi({ AR: 100 })).toBe(10000);
  });
});

describe("buildRiskReport", () => {
  const r = buildRiskReport({
    positions: [pos("AAA", 10), pos("BBB", 10), pos("ARG", 100, "adr")],
    candles: { AAA: doubleSpy, BBB: doubleSpy, ARG: flat },
    spy,
    profiles: {
      AAA: { symbol: "AAA", name: null, country: "US", industry: "Semis", marketCap: null },
      BBB: { symbol: "BBB", name: null, country: "US", industry: "Semis", marketCap: null },
      ARG: null,
    },
  });
  it("pesos por valor de cierre", () => {
    const last = doubleSpy[129]!.close;
    const total = 10 * last * 2 + 100 * 20;
    expect(r.totalValue).toBeCloseTo(total, 2);
    expect(r.weights.find((w) => w.symbol === "ARG")!.weightPct).toBeCloseTo((2000 / total) * 100, 1);
  });
  it("país del perfil, o del mercado si no hay perfil; aviso > 40%", () => {
    expect(Object.keys(r.concentration.byCountry).sort()).toEqual(["AR", "US"]);
    expect(r.concentration.warnings.some((w) => /Semis|US|AR/.test(w))).toBe(true);
  });
  it("lista pares con correlación > 0.7", () => {
    expect(r.correlatedPairs).toEqual([{ a: "AAA", b: "BBB", corr: 1 }]);
  });
  it("beta por posición y estrés lineal", () => {
    expect(r.betas["AAA"]).toBeCloseTo(2, 1);
    expect(r.betas["ARG"]).toBeCloseTo(0, 1);
    const expected = r.weights.reduce((s, w) => s + (w.weightPct / 100) * (r.betas[w.symbol] ?? 0) * -20, 0);
    expect(r.stressSpyMinus20Pct).toBeCloseTo(expected, 1);
  });
  it("liquidez: días para liquidar al 10% del volumen medio", () => {
    const l = r.liquidity.find((x) => x.symbol === "ARG")!;
    expect(l.avgDollarVolume30d).toBe(20 * 100);
    expect(l.daysToLiquidate).toBeCloseTo(100 / (100 * 0.1), 4); // 100 acciones, 10 por día
  });
});

describe("concentración por sector y tema", () => {
  it("una acción aporta todo su peso a cada tema; aviso > 40% por tema", () => {
    const r = buildRiskReport({
      positions: [pos("AAA", 10), pos("BBB", 10), pos("ARG", 100, "adr")],
      candles: { AAA: doubleSpy, BBB: doubleSpy, ARG: flat },
      spy,
      profiles: { AAA: null, BBB: null, ARG: null },
      tags: { AAA: { sector: "Tecnología", themes: ["IA", "semiconductores"] }, BBB: { sector: "Tecnología", themes: ["IA"] }, ARG: { sector: "Energía", themes: ["argentina"] } },
    });
    const wA = r.weights.find((w) => w.symbol === "AAA")!.weightPct;
    const wB = r.weights.find((w) => w.symbol === "BBB")!.weightPct;
    expect(r.concentration.byTheme["IA"]).toBeCloseTo(wA + wB, 1);
    expect(r.concentration.byTheme["semiconductores"]).toBeCloseTo(wA, 1);
    expect(r.concentration.bySector["Tecnología"]).toBeCloseTo(wA + wB, 1);
    expect(r.concentration.warnings.some((w) => /Tema IA/.test(w))).toBe(wA + wB > 40);
  });
  it("sin tags, mapas vacíos", () => {
    const r = buildRiskReport({ positions: [pos("AAA", 10)], candles: { AAA: doubleSpy }, spy, profiles: { AAA: null } });
    expect(r.concentration.byTheme).toEqual({});
    expect(r.concentration.bySector).toEqual({});
  });
});

/**
 * Hallazgo de la auditoría del 2026-09-12. Finnhub manda "AR" para PAM e YPF y "Argentina" para GGAL,
 * "US" para HUT y "United States" para NEM. La exposición argentina quedaba partida en dos claves de 39%
 * y 25%, y como el aviso de concentración se evalúa por clave, nunca se encendía teniendo 64% en un país.
 */
describe("concentración por país con nombres mezclados", () => {
  it("junta AR con Argentina y enciende el aviso", () => {
    const pos: Position[] = [
      { symbol: "GGAL", quantity: 100, avgCost: 10, currency: "USD", market: "adr", layer: "riesgo", notes: null },
      { symbol: "PAM", quantity: 100, avgCost: 10, currency: "USD", market: "adr", layer: "riesgo", notes: null },
      { symbol: "HUT", quantity: 10, avgCost: 10, currency: "USD", market: "us", layer: "riesgo", notes: null },
    ];
    const velas = (c: number): Candle[] => [{ date: "2026-09-12", open: c, high: c, low: c, close: c, volume: 1 }];
    const perfil = (symbol: string, country: string) => ({ symbol, name: symbol, country, industry: null, exchange: null, currency: "USD", shareOutstanding: null, marketCap: null });
    const r = buildRiskReport({
      positions: pos,
      candles: { GGAL: velas(10), PAM: velas(10), HUT: velas(10) },
      spy: velas(100),
      profiles: { GGAL: perfil("GGAL", "Argentina"), PAM: perfil("PAM", "AR"), HUT: perfil("HUT", "US") },
      tags: {},
    });
    expect(Object.keys(r.concentration.byCountry).sort()).toEqual(["AR", "US"]);
    expect(r.concentration.byCountry["AR"]).toBeGreaterThan(90);
    expect(r.concentration.warnings.some((w) => w.includes("AR"))).toBe(true);
  });
});

/**
 * 15/9: la tarjeta de riesgo decía "valor al cierre del 2026-09-15" (USD 157.964) y la corrida de las 07:49 había
 * usado el cierre del 14/9 (GGAL 42,96 × 920,77). La fecha de la corrida no es la fecha del precio.
 */
describe("de qué cierre es el valor", () => {
  const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1 });
  const ggal = { symbol: "GGAL", quantity: 920.77279309, avgCost: 34.6788, currency: "USD", market: "adr" as const, layer: "riesgo" as const, notes: null };
  const tsm = { symbol: "TSM", quantity: 26.52852693, avgCost: 376.1988, currency: "USD", market: "us" as const, layer: "riesgo" as const, notes: null };

  it("dice la fecha de la última vela usada, no la de la corrida", () => {
    const r = buildRiskReport({
      positions: [ggal, tsm],
      candles: { GGAL: [vela("2026-09-11", 43.86), vela("2026-09-14", 42.96)], TSM: [vela("2026-09-11", 433.24), vela("2026-09-14", 418.01)] },
      spy: [vela("2026-09-14", 760.88)],
      profiles: { GGAL: null, TSM: null },
    });
    expect(r.asOf).toBe("2026-09-14");
    expect(r.weights.find((w) => w.symbol === "GGAL")).toMatchObject({ value: 39556.4, closeDate: "2026-09-14", close: 42.96 });
    expect(r.notes.filter((n) => n.includes("valuada con el cierre"))).toEqual([]);
  });

  it("si un papel quedó con un cierre más viejo que el resto, lo dice", () => {
    const r = buildRiskReport({
      positions: [ggal, tsm],
      candles: { GGAL: [vela("2026-09-14", 42.96)], TSM: [vela("2026-09-11", 433.24)] },
      spy: [vela("2026-09-14", 760.88)],
      profiles: { GGAL: null, TSM: null },
    });
    expect(r.asOf).toBe("2026-09-14");
    expect(r.notes).toContain("TSM: valuada con el cierre del 2026-09-11, anterior al del 2026-09-14 del resto");
  });

  it("para los informes guardados sin fecha: la busca por el cierre que se usó, sin pasarse de la corrida", () => {
    const velas = [vela("2026-09-11", 43.86), vela("2026-09-14", 42.96), vela("2026-09-15", 43.5)];
    expect(fechaDeCierre(velas, 42.96, "2026-09-15")).toBe("2026-09-14");
    // Un cierre que no está en las velas no se adivina.
    expect(fechaDeCierre(velas, 41, "2026-09-15")).toBeNull();
    // Una vela posterior a la corrida no puede ser la que usó.
    expect(fechaDeCierre([vela("2026-09-16", 42.96)], 42.96, "2026-09-15")).toBeNull();
  });
});

/**
 * 12/9: la pantalla mostraba beta 0,62 y "si SPY cae 20% → −12,5%" como única medida de daño, mientras la
 * caída máxima real de la cartera había sido 33,6% contra 9,1% del SPY. La beta no estaba mal: solo mide la
 * parte que se mueve con el mercado. Faltaba lo que NO explica.
 */
describe("lo que la beta no dice", () => {
  // Serie que se mueve fuerte y sin ninguna relación con el SPY: beta cercana a cero, riesgo enorme.
  const propia = series(walk(130, 100, (i) => (i % 3 === 0 ? 0.09 : i % 3 === 1 ? -0.08 : 0.02)));
  const r = buildRiskReport({
    positions: [pos("SOLA", 10)],
    candles: { SOLA: propia },
    spy,
    profiles: { SOLA: { symbol: "SOLA", name: "Sola", country: "US", industry: "X", marketCap: 1 } },
    tags: {},
  });

  it("mide la volatilidad propia y la del SPY en la misma ventana", () => {
    expect(r.risk.portfolioVolPct).not.toBeNull();
    expect(r.risk.spyVolPct).not.toBeNull();
    expect(r.risk.portfolioVolPct!).toBeGreaterThan(r.risk.spyVolPct! * 2);
  });

  it("dice cuánto del movimiento explica el SPY: acá casi nada, y por eso el estrés lineal no es un techo", () => {
    expect(r.risk.r2VsSpy).not.toBeNull();
    expect(r.risk.r2VsSpy!).toBeLessThan(0.5);
  });

  it("la peor rueda observada es una pérdida real, no una estimación", () => {
    expect(r.risk.worstDayPct).not.toBeNull();
    expect(r.risk.worstDayPct!).toBeLessThan(0);
    expect(r.risk.sessions).toBeGreaterThanOrEqual(20);
  });

  it("una cartera que SÍ es el mercado tiene R² alto: el chequeo distingue los dos casos", () => {
    const igual = buildRiskReport({
      positions: [pos("ESPEJO", 10)],
      candles: { ESPEJO: doubleSpy },
      spy,
      profiles: { ESPEJO: { symbol: "ESPEJO", name: "Espejo", country: "US", industry: "X", marketCap: 1 } },
      tags: {},
    });
    expect(igual.risk.r2VsSpy!).toBeGreaterThan(0.9);
  });
});

