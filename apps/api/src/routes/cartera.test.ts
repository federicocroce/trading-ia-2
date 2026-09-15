import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { carteraRoutes } from "./cartera.js";
import type { Container } from "../container.js";

const mk = (n: number, close: number): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse("2026-06-01") + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 }));
const today = new Date(Date.parse("2026-06-01") + 98 * 86_400_000).toISOString().slice(0, 10); // igual a la última vela

function app(store = new MemoryStore()) {
  const c = { store, carteraDeps: { store, history: { candles: async (s: string) => mk(99, s === "SPY" ? 500 : 40) }, profiles: { profile: async () => null }, narrator: null, spot: async () => null }, tickerDeps: { quote: async (s: string) => { if (s === "BAD") throw new Error("fuente caída"); return { symbol: s, price: 41, prevClose: 40, asOf: null }; } } } as unknown as Container;
  const a = new Hono();
  a.route("/", carteraRoutes(c));
  return a;
}
const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1 });
/** Veredicto real de GGAL de la corrida del 15/9 a las 07:49 (con el cierre del 14/9). */
const ggal15 = { verdictDate: "2026-09-15", symbol: "GGAL", verb: "MANTENER" as const, reason: "Dejá correr.", narrative: null, warning: null, close: 42.96, spot: null, stop: 40.81, target: 47.26, gainPct: 23.88, weightPct: 25.04, spyClose: 760.88, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null };
/** Informe de riesgo como se guardaba hasta el 15/9: sin la fecha de la vela. */
const riesgoSinFecha = { totalValue: 39556.4, weights: [{ symbol: "GGAL", value: 39556.4, weightPct: 100 }], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, risk: { portfolioVolPct: null, spyVolPct: null, r2VsSpy: null, worstDayPct: null, sessions: 0 }, liquidity: [], notes: [] };
const post = (a: Hono, path: string, body: unknown) => a.request(path, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("/cartera", () => {
  it("alta → run → verdicts → risk → measurement → delete", async () => {
    const a = app();
    expect((await post(a, "/cartera/positions", { symbol: "ypf", quantity: 100, avgCost: 30, market: "adr" })).status).toBe(200);
    expect((await post(a, "/cartera/positions", { symbol: "ypf", quantity: -1, avgCost: 30, market: "adr" })).status).toBe(400);
    expect(await (await a.request("/cartera/positions")).json()).toHaveLength(1);
    const run = await (await a.request(`/cartera/run?today=${today}`, { method: "POST" })).json();
    expect(run.verdicts[0].symbol).toBe("YPF");
    expect(run.verdicts[0].verb).toBe("MANTENER");
    expect(await (await a.request("/cartera/verdicts")).json()).toHaveLength(1);
    expect((await (await a.request("/cartera/risk")).json()).report.totalValue).toBeGreaterThan(0);
    const m = await (await a.request("/cartera/measurement")).json();
    expect(m.total).toBe(1);
    expect(m.byVerb.MANTENER.h7.n).toBe(0);
    expect((await a.request("/cartera/positions/YPF", { method: "DELETE" })).status).toBe(200);
    expect(await (await a.request("/cartera/positions")).json()).toHaveLength(0);
  });
  it("precios vivos de las posiciones: uno por símbolo con variación diaria, null si la fuente falla", async () => {
    const a = app();
    await post(a, "/cartera/positions", { symbol: "ypf", quantity: 100, avgCost: 30, market: "adr" });
    await post(a, "/cartera/positions", { symbol: "bad", quantity: 1, avgCost: 1, market: "us" });
    const r = await (await a.request("/cartera/quotes")).json();
    expect(r.quotes.YPF).toMatchObject({ price: 41, prevClose: 40, change: 1, changePct: 2.5 });
    expect(r.quotes.BAD).toBeNull();
    expect(typeof r.asOf).toBe("string");
  });
  /**
   * 15/9: "valor al cierre del 2026-09-15" con el cierre del 14/9. Los informes y veredictos guardados antes de
   * este arreglo no traen la fecha de la vela: la API la busca por el cierre que usaron, así el histórico tampoco
   * dice una fecha falsa. La vela del 15/9 que llegó después no puede ser la que usó la corrida de las 07:49.
   */
  it("riesgo y veredictos dicen de qué cierre son, también los guardados sin esa fecha", async () => {
    const store = new MemoryStore();
    await store.upsertCandles("GGAL", [vela("2026-09-11", 43.86), vela("2026-09-14", 42.96), vela("2026-09-15", 43.5)]);
    await store.upsertVerdicts([ggal15]);
    await store.saveRisk("2026-09-15", riesgoSinFecha);
    const a = app(store);
    const risk = await (await a.request("/cartera/risk")).json();
    expect(risk.date).toBe("2026-09-15");
    expect(risk.report.asOf).toBe("2026-09-14");
    const [v] = await (await a.request("/cartera/verdicts")).json();
    expect(v.closeDate).toBe("2026-09-14");
    const [h] = await (await a.request("/cartera/verdicts?date=2026-09-15")).json();
    expect(h.closeDate).toBe("2026-09-14");
  });
  it("una corrida nueva guarda la fecha de la vela y la API la sirve tal cual", async () => {
    const a = app();
    await post(a, "/cartera/positions", { symbol: "ypf", quantity: 100, avgCost: 30, market: "adr" });
    await a.request(`/cartera/run?today=${today}`, { method: "POST" });
    const lastCandle = mk(99, 40).at(-1)!.date;
    expect((await (await a.request("/cartera/risk")).json()).report.asOf).toBe(lastCandle);
    expect((await (await a.request("/cartera/verdicts")).json())[0].closeDate).toBe(lastCandle);
  });
  it("operaciones: inserta y dedupea", async () => {
    const a = app();
    const tx = { symbol: "YPF", type: "BUY", quantity: 1, price: 2, date: "2026-01-02", externalId: "e1" };
    expect((await (await post(a, "/cartera/transactions", tx)).json()).inserted).toBe(1);
    expect((await (await post(a, "/cartera/transactions", tx)).json()).inserted).toBe(0);
    expect(await (await a.request("/cartera/transactions")).json()).toHaveLength(1);
  });
});
