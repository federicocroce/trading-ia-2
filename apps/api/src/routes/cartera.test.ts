import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { carteraRoutes } from "./cartera.js";
import type { Container } from "../container.js";

const mk = (n: number, close: number): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse("2026-06-01") + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 }));
const today = new Date(Date.parse("2026-06-01") + 98 * 86_400_000).toISOString().slice(0, 10); // igual a la última vela

function app() {
  const store = new MemoryStore();
  const c = { store, carteraDeps: { store, history: { candles: async (s: string) => mk(99, s === "SPY" ? 500 : 40) }, profiles: { profile: async () => null }, narrator: null, spot: async () => null }, tickerDeps: { quote: async (s: string) => { if (s === "BAD") throw new Error("fuente caída"); return { symbol: s, price: 41, prevClose: 40, asOf: null }; } } } as unknown as Container;
  const a = new Hono();
  a.route("/", carteraRoutes(c));
  return a;
}
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
  it("operaciones: inserta y dedupea", async () => {
    const a = app();
    const tx = { symbol: "YPF", type: "BUY", quantity: 1, price: 2, date: "2026-01-02", externalId: "e1" };
    expect((await (await post(a, "/cartera/transactions", tx)).json()).inserted).toBe(1);
    expect((await (await post(a, "/cartera/transactions", tx)).json()).inserted).toBe(0);
    expect(await (await a.request("/cartera/transactions")).json()).toHaveLength(1);
  });
});
