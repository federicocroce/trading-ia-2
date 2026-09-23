import { describe, expect, it } from "vitest";
import { AlpacaPriceHistory, CompletedSessionsHistory, FallbackPriceHistory, FinnhubProfiles, YahooPriceHistory, fixtureHttpClient, parseYahooChart, parseYahooChartWithGaps } from "../src/index.js";

const yahoo = { chart: { result: [{ timestamp: [1756684800, 1756771200, 1756857600], indicators: { quote: [{ open: [1, 2, null], high: [2, 3, null], low: [0.5, 1.5, null], close: [1.5, 2.5, null], volume: [100, 200, null] }] } }], error: null } };

describe("parseYahooChart", () => {
  it("convierte timestamps a YYYY-MM-DD y descarta velas sin cierre", () => {
    expect(parseYahooChart(yahoo)).toEqual([
      { date: "2025-09-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100, adjClose: null },
      { date: "2025-09-02", open: 2, high: 3, low: 1.5, close: 2.5, volume: 200, adjClose: null },
    ]);
  });
  it("toma el cierre ajustado por dividendos cuando Yahoo lo manda (retorno total)", () => {
    const conAdj = { chart: { result: [{ timestamp: [1756684800, 1756771200], indicators: { quote: [{ open: [1, 2], high: [2, 3], low: [0.5, 1.5], close: [1.5, 2.5], volume: [100, 200] }], adjclose: [{ adjclose: [1.4, 2.5] }] } }], error: null } };
    expect(parseYahooChart(conAdj).map((c) => c.adjClose)).toEqual([1.4, 2.5]);
  });
  it("redondea el ruido de coma flotante a 4 decimales", () => {
    const noisy = { chart: { result: [{ timestamp: [1756684800], indicators: { quote: [{ open: [44.36000061035156], high: [45], low: [44], close: [44.36000061035156], volume: [1] }] } }], error: null } };
    expect(parseYahooChart(noisy)[0]!.close).toBe(44.36);
  });
  it("error de Yahoo lanza", () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { code: "Not Found", description: "No data" } } })).toThrow(/No data/);
  });
});

describe("YahooPriceHistory", () => {
  it("pide el rango según los días y devuelve velas", async () => {
    const http = fixtureHttpClient({ "https://query2.finance.yahoo.com/v8/finance/chart/GGAL.BA?range=1y": yahoo });
    expect((await new YahooPriceHistory(http).candles("ggal.ba", 200)).length).toBe(2);
  });
});

describe("AlpacaPriceHistory", () => {
  it("mapea barras IEX a velas", async () => {
    const http = fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/bars?symbols=YPF": { bars: { YPF: [{ t: "2026-09-01T04:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] } } });
    const c = await new AlpacaPriceHistory(http, { keyId: "k", secretKey: "s", paper: true }).candles("YPF", 30);
    expect(c).toEqual([{ date: "2026-09-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
  });
});

describe("FallbackPriceHistory", () => {
  it("usa el respaldo si el primario falla o devuelve vacío", async () => {
    const bad = { candles: async () => { throw new Error("yahoo caído"); } };
    const empty = { candles: async () => [] };
    const good = { candles: async () => [{ date: "2026-09-01", open: 1, high: 1, low: 1, close: 1, volume: 1 }] };
    expect((await new FallbackPriceHistory(bad, good).candles("X", 10)).length).toBe(1);
    expect((await new FallbackPriceHistory(empty, good).candles("X", 10)).length).toBe(1);
  });
});

describe("FinnhubProfiles", () => {
  it("mapea profile2; objeto vacío es null", async () => {
    const http = fixtureHttpClient({
      "https://finnhub.io/api/v1/stock/profile2?symbol=TSM": { name: "Taiwan Semiconductor", country: "TW", finnhubIndustry: "Semiconductors", marketCapitalization: 1000 },
      "https://finnhub.io/api/v1/stock/profile2?symbol=ZZZZ": {},
    });
    const p = new FinnhubProfiles(http, "tok");
    expect(await p.profile("TSM")).toEqual({ symbol: "TSM", name: "Taiwan Semiconductor", country: "TW", industry: "Semiconductors", marketCap: 1_000_000_000, currency: null, shareOutstanding: null });
    expect(await p.profile("ZZZZ")).toBeNull();
  });
});

describe("CompletedSessionsHistory", () => {
  const inner = { candles: async (symbol: string) => [{ date: "2026-09-08", open: 1, high: 1, low: 1, close: 12.675, volume: 854_000 }, { date: "2026-09-09", open: 12.79, high: 12.79, low: 12.57, close: 12.57, volume: 95_582 }].map((c) => ({ ...c, close: symbol === "GGAL.BA" ? c.close * 100 : c.close })) };
  it("durante la rueda US descarta la vela parcial; después del cierre la deja", async () => {
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T13:44:00Z")).candles("ZVRA", 260)).map((c) => c.date)).toEqual(["2026-09-08"]);
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T21:00:00Z")).candles("ZVRA", 260)).map((c) => c.date)).toEqual(["2026-09-08", "2026-09-09"]);
  });
  it("los .BA usan el cierre de Buenos Aires", async () => {
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T19:30:00Z")).candles("GGAL.BA", 260)).map((c) => c.date)).toEqual(["2026-09-08"]);
  });
});

/**
 * Regla del 23/9/2026: una sesión que la fuente lista pero devuelve vacía se rellena con el respaldo.
 * Caso real: el 22/9 Yahoo devolvió `close: null` para TODOS los símbolos de EE.UU. El parser descartaba
 * la fila (bien: no hay precio), pero el respaldo solo entraba si el primario lanzaba o venía vacío, así que
 * la serie terminó el 21/9 sin que nadie se enterara y el plan del 23/9 se armó con cierres de dos días atrás.
 */
describe("huecos de una sesión en el primario", () => {
  const conHueco = { chart: { result: [{ timestamp: [1758513600, 1758600000, 1758686400], indicators: { quote: [{ open: [1, null, 3], high: [2, null, 4], low: [0.5, null, 2.5], close: [1.5, null, 3.5], volume: [100, null, 300] }] } }], error: null } };

  it("parseYahooChartWithGaps informa las fechas que Yahoo listó sin cierre", () => {
    const { candles, gaps } = parseYahooChartWithGaps(conHueco);
    expect(candles.map((c) => c.date)).toEqual(["2025-09-22", "2025-09-24"]);
    expect(gaps).toEqual(["2025-09-23"]);
  });

  it("parseYahooChart sigue devolviendo solo las velas", () => {
    expect(parseYahooChart(conHueco).map((c) => c.date)).toEqual(["2025-09-22", "2025-09-24"]);
  });

  const vela = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });

  it("rellena el hueco con el respaldo y deja la serie ordenada", async () => {
    const primary = {
      candles: async () => [vela("2026-09-21", 80.72), vela("2026-09-23", 81.8)],
      candlesWithGaps: async () => ({ candles: [vela("2026-09-21", 80.72), vela("2026-09-23", 81.8)], gaps: ["2026-09-22"] }),
    };
    const fallback = { candles: async () => [vela("2026-09-21", 80.74), vela("2026-09-22", 82.86), vela("2026-09-23", 81.85)] };
    const c = await new FallbackPriceHistory(primary, fallback).candles("APH", 60);
    expect(c.map((x) => x.date)).toEqual(["2026-09-21", "2026-09-22", "2026-09-23"]);
    expect(c.map((x) => x.close)).toEqual([80.72, 82.86, 81.8]); // solo la faltante viene del respaldo
  });

  it("si el respaldo tampoco tiene esa sesión (feriado) devuelve la serie tal cual", async () => {
    const primary = {
      candles: async () => [vela("2026-09-21", 80.72)],
      candlesWithGaps: async () => ({ candles: [vela("2026-09-21", 80.72)], gaps: ["2026-09-22"] }),
    };
    const fallback = { candles: async () => [vela("2026-09-21", 80.74)] };
    expect((await new FallbackPriceHistory(primary, fallback).candles("APH", 60)).map((x) => x.date)).toEqual(["2026-09-21"]);
  });

  it("si el respaldo falla el hueco no rompe la serie del primario", async () => {
    const primary = {
      candles: async () => [vela("2026-09-21", 80.72)],
      candlesWithGaps: async () => ({ candles: [vela("2026-09-21", 80.72)], gaps: ["2026-09-22"] }),
    };
    const fallback = { candles: async () => { throw new Error("alpaca caído"); } };
    expect((await new FallbackPriceHistory(primary, fallback).candles("APH", 60)).map((x) => x.date)).toEqual(["2026-09-21"]);
  });
});
