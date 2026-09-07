import { describe, expect, it } from "vitest";
import type { Candle, SymbolDescription } from "@thesis/core";
import { MemoryStore, buildTicker, type TickerDeps } from "../src/index.js";

const series = (closes: number[], start = "2026-06-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1_000_000 }));
const today = "2026-09-08";
const desc = (sym: string): SymbolDescription => ({ symbol: sym, longName: `${sym} Inc`, summary: "hace cosas", employees: 100, website: "x.com", exchangeName: "NYSE", firstTradeDate: "2000-01-01", sector: "Tech", industry: "Soft", country: "US", updatedAt: "2026-09-08T00:00:00.000Z" });

function setup() {
  const store = new MemoryStore();
  const calls: string[] = [];
  const deps: TickerDeps = {
    store,
    history: { candles: async (s) => { calls.push(`history:${s}`); return series(Array(99).fill(s === "SPY" ? 500 : 40)); } },
    descriptions: { description: async (s) => { calls.push(`desc:${s}`); return desc(s); } },
    news: { companyNews: async (s) => { calls.push(`news:${s}`); return [{ symbol: s, date: "2026-09-07", headline: "Noticia", source: "R", url: `https://n/${s}`, summary: null }]; } },
    quote: async (s) => ({ symbol: s, price: 41, prevClose: 40, asOf: "2026-09-08T14:00:00Z" }),
    newsFetchedAt: new Map(),
  };
  return { store, deps, calls };
}

describe("buildTicker", () => {
  it("arma la página con todo lo guardado y completa descripción, velas y noticias si faltan (y las persiste)", async () => {
    const { store, deps, calls } = setup();
    await store.upsertPosition({ symbol: "GGAL", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    await store.insertTransactions([{ id: "t1", symbol: "GGAL", type: "BUY", quantity: 100, price: 30, fees: 0, date: "2026-01-02", currency: "USD", platform: "Nexo", externalId: "e1", notes: null }]);
    await store.saveTags("GGAL", { assetClass: "adr", sector: "Financiero", industry: "Banking", themes: ["argentina", "bancos"], themesSource: "regla" });
    await store.upsertVerdicts([{ verdictDate: today, symbol: "GGAL", verb: "MANTENER", reason: "r", narrative: "n", warning: null, close: 40, spot: 41, stop: 38, target: 44, gainPct: 33, weightPct: 26, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    const t = await buildTicker(deps, "ggal", { today });
    expect(t.symbol).toBe("GGAL");
    expect(t.description?.summary).toBe("hace cosas");
    expect(t.quote?.price).toBe(41);
    expect(t.quote?.changePct).toBeCloseTo(2.5, 4);
    expect(t.position?.quantity).toBe(100);
    expect(t.position?.valueUsd).toBe(4100);
    expect(t.position?.pnlUsd).toBe(1100);
    expect(t.verdict?.verb).toBe("MANTENER");
    expect(t.tags?.themes).toEqual(["argentina", "bancos"]);
    expect(t.transactions).toHaveLength(1);
    expect(t.transactionSummary).toEqual({ buys: { count: 1, total: 3000 }, sells: { count: 0, total: 0 }, dividends: { count: 0, total: 0 }, invested: 3000 });
    expect(t.candles.length).toBe(99);
    expect(t.news[0]?.headline).toBe("Noticia");
    expect(t.candidate).toBeNull();
    // persistido: segunda llamada no vuelve a pedir descripción, velas ni noticias
    calls.length = 0;
    const t2 = await buildTicker(deps, "GGAL", { today });
    expect(t2.candles.length).toBe(99);
    expect(calls).toEqual([]);
    expect((await store.description("GGAL"))?.longName).toBe("GGAL Inc");
  });
  it("símbolo desconocido: sin posición ni veredicto, pero con descripción y velas", async () => {
    const { deps } = setup();
    const t = await buildTicker(deps, "NVDA", { today });
    expect(t.position).toBeNull();
    expect(t.verdict).toBeNull();
    expect(t.description?.longName).toBe("NVDA Inc");
    expect(t.candles.length).toBe(99);
  });
  it("si Yahoo o Finnhub fallan, la página sale igual con lo que hay", async () => {
    const { deps } = setup();
    const bad: TickerDeps = { ...deps, descriptions: { description: async () => { throw new Error("yahoo"); } }, news: { companyNews: async () => { throw new Error("finnhub"); } }, quote: async () => null };
    const t = await buildTicker(bad, "NVDA", { today });
    expect(t.description).toBeNull();
    expect(t.news).toEqual([]);
    expect(t.quote).toBeNull();
    expect(t.errors.length).toBe(2);
  });
});
