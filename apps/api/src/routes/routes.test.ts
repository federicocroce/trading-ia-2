import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DefaultFilter, DefaultRiskEngine, type Broker, type MarketData, type Order, type OrderIntent, type RawEvent, type Reasoner } from "@thesis/core";
import { MemoryStore, buildSnapshot } from "@thesis/pipeline";
import { buildApp } from "./index.js";
import { state, type Container } from "../container.js";

const marketData: MarketData = {
  getQuote: async (t) => ({ ticker: t, price: 10, asOf: "", avgVolume30d: 1_000_000 }),
  getImpliedMove: async () => null,
  findOption: async () => null,
};
const broker: Broker & { n: number } = {
  paper: true, n: 0,
  async submit(i: OrderIntent): Promise<Order> { this.n++; return { ...i, id: randomUUID(), brokerOrderId: "b", status: "filled", filledQty: i.qty, avgFillPrice: i.limitPrice, submittedAt: "t", filledAt: "t" }; },
  async getOrder() { throw new Error("x"); },
  async cancel() {},
};
const event: RawEvent = { id: randomUUID(), ticker: "XXXX", eventType: "earnings", source: "manual", eventDate: "2026-09-25", sourceRef: "r", title: "Earnings", payload: {}, observedAt: "2026-09-04T00:00:00Z" };
const reasoner: Reasoner = {
  promptVersion: "v-test",
  propose: async (b) => ({ ticker: b.event.ticker, eventType: "earnings", eventDate: b.event.eventDate, direction: "long", pEstimate: 0.7, pMarket: 0.5, instrument: "stock", entryMax: 10.5, target: 11, invalidation: "Preanuncio negativo de guidance antes del reporte.", confidence: "med", reasoning: "Razonamiento de prueba suficientemente largo para pasar la validación mínima.", sources: ["s"] }),
};

function container(): Container {
  const store = new MemoryStore();
  const account = async () => ({ equity: 100_000, lastEquity: 100_000 });
  return {
    cfg: {} as never,
    store,
    carteraDeps: { store, history: { candles: async () => [] }, profiles: { profile: async () => null }, narrator: null, spot: async () => null },
    radarDeps: { store, taxonomy: { sectors: [], themes: [], industryToSector: {}, industryToThemes: {}, symbolToThemes: {}, symbolToAssetClass: {} } } as never,
    tickerDeps: { store } as never,
    marketData,
    broker,
    risk: new DefaultRiskEngine(),
    runDeps: { store, ingestors: [{ source: "manual", fetch: async () => [event] }], filter: new DefaultFilter(marketData.getQuote), reasoner, documents: { documentsFor: async () => [] }, marketData, minEdge: 0.1, maxCandidates: 5 },
    snapshot: async () => buildSnapshot(store, await account(), state.killSwitch),
    account,
  };
}

describe("API routes", () => {
  it("run → theses → approve → portfolio → close → calibration", async () => {
    const app = buildApp(container());
    expect((await app.request("/health")).status).toBe(200);

    const run = await (await app.request("/run", { method: "POST" })).json();
    expect(run.proposed).toHaveLength(1);
    const id = run.proposed[0].id;

    const list = await (await app.request("/theses?status=proposed")).json();
    expect(list).toHaveLength(1);

    const detail = await (await app.request(`/theses/${id}`)).json();
    expect(detail.event.title).toBe("Earnings");

    const approve = await app.request(`/theses/${id}/approve`, { method: "POST" });
    expect(approve.status).toBe(200);
    expect((await approve.json()).order.qty).toBe(1000);

    const pf = await (await app.request("/portfolio")).json();
    expect(pf.snapshot.openByEventType.earnings).toBe(10_000);

    const bad = await app.request(`/theses/${id}/close`, { method: "POST", body: JSON.stringify({ closeReason: "nope" }), headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(400);

    const close = await app.request(`/theses/${id}/close`, { method: "POST", body: JSON.stringify({ predictedOutcomeHappened: false, closeReason: "invalidation" }), headers: { "Content-Type": "application/json" } });
    expect(close.status).toBe(200);

    const cal = await (await app.request("/calibration")).json();
    expect(cal.closed).toBe(1);
    expect(cal.hitRate).toBe(0);
    expect(cal.criteria.readyForRealMoney).toBe(false);
  });

  it("kill switch bloquea aprobaciones", async () => {
    const app = buildApp(container());
    await app.request("/kill-switch", { method: "POST", body: JSON.stringify({ on: true }), headers: { "Content-Type": "application/json" } });
    const run = await (await app.request("/run", { method: "POST" })).json();
    const res = await app.request(`/theses/${run.proposed[0].id}/approve`, { method: "POST" });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("kill_switch");
    await app.request("/kill-switch", { method: "POST", body: JSON.stringify({ on: false }), headers: { "Content-Type": "application/json" } });
  });
});
