import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { tickerRoutes } from "./ticker.js";
import type { Container } from "../container.js";

const series = (n: number, close: number, start = "2026-06-01"): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1_000 }));
const today = "2026-09-08";

function app() {
  const store = new MemoryStore();
  const yahooCalls: string[] = [];
  const c = {
    store,
    tickerDeps: {
      store,
      history: { candles: async (s: string) => series(100, s === "SPY" ? 500 : 40) },
      descriptions: { description: async (s: string) => ({ symbol: s, longName: `${s} Inc`, summary: "hace cosas", employees: 1, website: "x.com", exchangeName: "NYSE", firstTradeDate: "2000-01-01", sector: "Tech", industry: "Soft", country: "US", updatedAt: `${today}T00:00:00.000Z` }) },
      news: { companyNews: async () => [] },
      quote: async (s: string) => ({ symbol: s, price: 41, prevClose: 40, asOf: null }),
      newsFetchedAt: new Map(),
      chart: { bars: async (s: string, range: string, interval: string) => { yahooCalls.push(`${s}:${range}:${interval}`); return [{ time: 1, open: 1, high: 1, low: 1, close: 1, volume: 1 }]; } },
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
  it("símbolo inválido → 400", async () => {
    expect((await app().a.request("/ticker/no-valido!")).status).toBe(400);
  });
  it("gráfico: diario desde la base cuando alcanza; intradiario y 5A desde Yahoo", async () => {
    const { a, store, yahooCalls } = app();
    await store.upsertCandles("GGAL", series(260, 40, "2025-12-01"));
    const daily = await (await a.request(`/ticker/GGAL/chart?range=1y&interval=1d&today=${today}`)).json();
    expect(daily.length).toBeGreaterThan(200);
    expect(daily[0].time).toBe(Math.floor(Date.parse("2025-12-01") / 1000));
    expect(yahooCalls).toEqual([]);
    const intra = await (await a.request("/ticker/GGAL/chart?range=1d&interval=5m")).json();
    expect(intra).toHaveLength(1);
    await a.request("/ticker/GGAL/chart?range=5y&interval=1wk");
    expect(yahooCalls).toEqual(["GGAL:1d:5m", "GGAL:5y:1wk"]);
    expect((await a.request("/ticker/GGAL/chart?range=1d&interval=7m")).status).toBe(400);
  });
});
