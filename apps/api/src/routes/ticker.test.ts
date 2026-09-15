import { describe, expect, it } from "vitest";
import type { Candle, ChartBar } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { tickerRoutes } from "./ticker.js";
import type { Container } from "../container.js";

const series = (n: number, close: number, start = "2026-06-01"): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1_000 }));
const today = "2026-09-08";

function app(intraday: ChartBar[] | Error = [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]) {
  const store = new MemoryStore();
  const yahooCalls: string[] = [];
  const c = {
    store,
    // El cuestionario vigente de la verificación web es el del verificador del Radar.
    radarDeps: { verifier: { promptVersion: "v1-07c33234178c-gemini" } },
    tickerDeps: {
      store,
      history: { candles: async (s: string) => series(100, s === "SPY" ? 500 : 40) },
      descriptions: { description: async (s: string) => ({ symbol: s, longName: `${s} Inc`, summary: "hace cosas", employees: 1, website: "x.com", exchangeName: "NYSE", firstTradeDate: "2000-01-01", sector: "Tech", industry: "Soft", country: "US", updatedAt: `${today}T00:00:00.000Z` }) },
      news: { companyNews: async () => [] },
      quote: async (s: string) => ({ symbol: s, price: 41, prevClose: 40, asOf: null }),
      newsFetchedAt: new Map(),
      chart: { bars: async (s: string, range: string, interval: string) => { yahooCalls.push(`${s}:${range}:${interval}`); if (intraday instanceof Error) throw intraday; return intraday; } },
    },
  } as unknown as Container;
  const a = new Hono();
  a.route("/", tickerRoutes(c));
  return { a, store, yahooCalls };
}

describe("/ticker", () => {
  it("página completa desde la base; velas y descripción se persisten", async () => {
    const { a, store } = app();
    await store.upsertPosition({ symbol: "GGAL", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    const r = await a.request(`/ticker/ggal?today=${today}`);
    expect(r.status).toBe(200);
    const t = await r.json();
    expect(t.symbol).toBe("GGAL");
    expect(t.position.quantity).toBe(100);
    expect(t.description.summary).toBe("hace cosas");
    expect(t.candles.length).toBe(100);
    expect((await store.description("GGAL"))?.longName).toBe("GGAL Inc");
    expect((await store.candles("GGAL", "2026-06-01")).length).toBe(100);
  });
  it("C5 (15/9): la ficha sabe si la verificación es del cuestionario vigente (NBN, apta con el anterior)", async () => {
    const { a, store } = app();
    await store.saveVerification({ symbol: "NBN", date: "2026-09-14", verdict: "apto", reason: "r", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [], researchText: "", promptVersion: "v1-c12a96012ca5-gemini", model: "gemini-2.5-flash", detectedAt: "2026-09-14T11:07:13.886Z" });
    const t = await (await a.request(`/ticker/NBN?today=2026-09-15`)).json();
    expect(t.verificationCurrent).toBe(false);
  });
  it("símbolo inválido → 400", async () => {
    expect((await app().a.request("/ticker/no-valido!")).status).toBe(400);
  });
  it("gráfico: diario desde la base cuando alcanza; intradiario y 5A desde Yahoo", async () => {
    const { a, store, yahooCalls } = app();
    await store.upsertCandles("GGAL", series(260, 40, "2025-12-01"));
    const daily = await (await a.request(`/ticker/GGAL/chart?range=1y&interval=1d&today=${today}`)).json();
    expect(daily.length).toBeGreaterThan(200);
    expect(daily[0].time).toBe(Math.floor(Date.parse("2025-12-01") / 1000));
    // El diario sale de la base; al intradiario solo se le pide la sesión que la base todavía no tiene (acá, ninguna nueva).
    expect(daily.some((b: ChartBar) => b.partial)).toBe(false);
    expect(yahooCalls).toEqual(["GGAL:1d:5m"]);
    const intra = await (await a.request("/ticker/GGAL/chart?range=1d&interval=5m")).json();
    expect(intra).toHaveLength(1);
    await a.request("/ticker/GGAL/chart?range=5y&interval=1wk");
    expect(yahooCalls).toEqual(["GGAL:1d:5m", "GGAL:1d:5m", "GGAL:5y:1wk"]);
    expect((await a.request("/ticker/GGAL/chart?range=1d&interval=7m")).status).toBe(400);
  });
  it("APH el 14/9: el diario terminaba en el 11/9 con el precio ya 6% abajo; la sesión de hoy entra como vela parcial y sin indicadores", async () => {
    const at = (iso: string) => Math.floor(Date.parse(iso) / 1000);
    const { a, store } = app([
      { time: at("2026-09-14T13:30:00Z"), open: 81.2, high: 81.6, low: 80.9, close: 81.0, volume: 100 },
      { time: at("2026-09-14T17:05:00Z"), open: 78.9, high: 79.2, low: 78.36, close: 79.11, volume: 300 },
    ]);
    await store.upsertCandles("APH", series(300, 83.92, "2025-11-15"));
    const ultima = (await store.candles("APH", "2026-09-01")).at(-1)!.date;
    const bars: ChartBar[] = await (await a.request("/ticker/APH/chart?range=3mo&interval=1d&today=2026-09-14")).json();
    const hoy = bars.at(-1)!;
    expect(hoy.time).toBe(at("2026-09-14T00:00:00Z"));
    expect([hoy.open, hoy.high, hoy.low, hoy.close, hoy.volume]).toEqual([81.2, 81.6, 78.36, 79.11, 400]);
    expect(hoy.partial).toBe(true);
    expect([hoy.sma20, hoy.sma50, hoy.sma200, hoy.stop, hoy.rsi14]).toEqual([null, null, null, null, null]);
    // La anterior es la última de la base, intacta, con sus indicadores.
    expect(bars.at(-2)!.time).toBe(at(`${ultima}T00:00:00Z`));
    expect(bars.at(-2)!.sma200).not.toBeNull();
    // Y no se guarda: la base sigue terminando donde terminaba.
    expect((await store.candles("APH", "2026-09-01")).at(-1)!.date).toBe(ultima);
  });
  it("si el intradiario falla, el diario sale igual, sin la vela de hoy", async () => {
    const { a, store } = app(new Error("Yahoo caído"));
    await store.upsertCandles("APH", series(300, 83.92, "2025-11-15"));
    const r = await a.request("/ticker/APH/chart?range=3mo&interval=1d&today=2026-09-14");
    expect(r.status).toBe(200);
    const bars: ChartBar[] = await r.json();
    expect(bars.length).toBeGreaterThan(50);
    expect(bars.some((b) => b.partial)).toBe(false);
  });
});
