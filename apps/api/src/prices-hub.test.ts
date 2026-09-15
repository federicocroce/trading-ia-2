import { describe, expect, it } from "vitest";
import { MemoryStore } from "@thesis/pipeline";
import { PriceHub, hubIntervalMs } from "./prices-hub.js";
import type { Container } from "./container.js";

describe("hubIntervalMs", () => {
  it("15 s en horario de mercado US, 60 s fuera", () => {
    expect(hubIntervalMs(new Date("2026-09-09T15:00:00Z"))).toBe(15_000); // miércoles 11:00 ET
    expect(hubIntervalMs(new Date("2026-09-09T02:00:00Z"))).toBe(60_000); // 22:00 ET del martes
    expect(hubIntervalMs(new Date("2026-09-12T15:00:00Z"))).toBe(60_000); // sábado
  });
});

describe("PriceHub", () => {
  function setup() {
    const store = new MemoryStore();
    const calls: string[][] = [];
    let price = 100;
    const c = { store, pricesDeps: { quotes: async (symbols: string[]) => { calls.push(symbols); return symbols.map((s) => ({ symbol: s, price: s === "GGAL.BA" ? 7000 : price, prevClose: 90, asOf: new Date().toISOString() })); } } } as unknown as Container;
    return { store, calls, c, bump: () => { price += 1; } };
  }
  it("un tick cotiza todo lo seguido (posiciones, watchlist, candidatos), guarda las filas y avisa solo lo que cambió", async () => {
    const { store, calls, c, bump } = setup();
    await store.upsertPosition({ symbol: "NVDA", quantity: 1, avgCost: 1, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.addWatch("VST");
    await store.addWatch("GGAL.BA");
    const hub = new PriceHub(c, { now: () => new Date("2026-09-09T15:00:00Z") });
    const got: string[][] = [];
    hub.subscribe((rows) => got.push(rows.map((r) => r.symbol).sort()));
    await hub.tick();
    expect(calls[0]?.sort()).toEqual(["GGAL.BA", "NVDA", "VST"]);
    expect(hub.snapshot().map((r) => r.symbol).sort()).toEqual(["GGAL.BA", "NVDA", "VST"]);
    expect(hub.snapshot().find((r) => r.symbol === "NVDA")).toMatchObject({ price: 100, prevClose: 90, changePct: 11.11, stale: false });
    expect(got).toEqual([["GGAL.BA", "NVDA", "VST"]]);
    // Sin cambios: no avisa. Los .BA se piden cada 60 s, no en cada tick.
    await hub.tick();
    expect(got).toHaveLength(1);
    expect(calls[1]?.sort()).toEqual(["NVDA", "VST"]);
    bump();
    await hub.tick();
    expect(got[1]).toEqual(["NVDA", "VST"]);
  });
  it("C6 (15/9): TSM a 414,66 medido contra el cierre guardado del 14/9 (418,01), no contra el de IEX (418,60), y dice de qué fecha es", async () => {
    const store = new MemoryStore();
    await store.addWatch("TSM");
    await store.addWatch("NUEVO");
    const vela = (date: string, close: number) => ({ date, open: close, high: close, low: close, close, volume: 1 });
    await store.upsertCandles("TSM", [vela("2026-09-11", 433.24), vela("2026-09-14", 418.01)]);
    const asOf = "2026-09-15T19:40:59.858Z";
    const c = { store, pricesDeps: { quotes: async (symbols: string[]) => symbols.map((s) => ({ symbol: s, price: s === "TSM" ? 414.66 : 10, prevClose: s === "TSM" ? 418.6 : 9, asOf })) } } as unknown as Container;
    const hub = new PriceHub(c, { now: () => new Date("2026-09-15T19:41:00Z") });
    await hub.tick();
    expect(hub.get("TSM")).toMatchObject({ price: 414.66, prevClose: 418.01, prevCloseDate: "2026-09-14", change: -3.35, changePct: -0.8 });
    // Sin velas guardadas, queda el cierre de la fuente, sin fecha.
    expect(hub.get("NUEVO")).toMatchObject({ prevClose: 9, prevCloseDate: null });
  });
  it("tolera que la fuente falle: conserva lo último y sigue", async () => {
    const store = new MemoryStore();
    await store.addWatch("VST");
    let fail = false;
    const c = { store, pricesDeps: { quotes: async (symbols: string[]) => { if (fail) throw new Error("alpaca caído"); return symbols.map((s) => ({ symbol: s, price: 10, prevClose: 10, asOf: null })); } } } as unknown as Container;
    const hub = new PriceHub(c);
    await hub.tick();
    fail = true;
    await hub.tick();
    expect(hub.snapshot()).toHaveLength(1);
    expect(hub.lastError).toMatch(/alpaca/);
  });
});
