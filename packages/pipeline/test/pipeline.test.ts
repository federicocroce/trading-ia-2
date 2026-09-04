import { describe, expect, it } from "vitest";
import { DefaultFilter, DefaultRiskEngine, type Broker, type Ingestor, type MarketData, type Order, type OrderIntent, type RawEvent, type Reasoner, type ThesisProposal } from "@thesis/core";
import { randomUUID } from "node:crypto";
import { MemoryStore, approveAndExecute, buildSnapshot, calibrationReport, closeThesis, dailyRun, rejectByHuman, syncOrders } from "../src/index.js";

const ev = (over: Partial<RawEvent> = {}): RawEvent => ({
  id: randomUUID(), ticker: "XXXX", eventType: "earnings", source: "earnings_calendar", eventDate: "2026-09-20", sourceRef: `r${Math.random()}`, title: "Earnings XXXX", payload: {}, observedAt: "2026-09-04T00:00:00Z", ...over,
});

const marketData: MarketData = {
  getQuote: async (t) => ({ ticker: t, price: 10, asOf: "", avgVolume30d: 1_000_000 }),
  getImpliedMove: async (t) => ({ ticker: t, expiration: "2026-09-25", spot: 10, straddle: 1, impliedMovePct: 0.1 }),
  findOption: async (t, type) => ({ symbol: `${t}260925${type === "call" ? "C" : "P"}00010000`, strike: 10, expiration: "2026-09-25", type, bid: 0.9, ask: 1.0, mid: 0.95 }),
};

const proposalFor = (e: RawEvent, pEstimate: number): ThesisProposal => ({
  ticker: e.ticker, eventType: e.eventType, eventDate: e.eventDate, direction: "long", pEstimate, pMarket: 0.5, instrument: "stock",
  entryMax: 10.5, target: 11, invalidation: "Preanuncio negativo de guidance antes del reporte trimestral.", confidence: "med",
  reasoning: "Razonamiento de prueba suficientemente largo para pasar la validación mínima de caracteres.", sources: ["test:1"],
});

class FakeReasoner implements Reasoner {
  promptVersion = "v-test";
  calls = 0;
  constructor(private p: number) {}
  async propose(b: { event: RawEvent }) {
    this.calls++;
    return proposalFor(b.event, this.p);
  }
}

class FakeBroker implements Broker {
  paper = true;
  submitted: OrderIntent[] = [];
  async submit(i: OrderIntent): Promise<Order> {
    this.submitted.push(i);
    return { ...i, id: randomUUID(), brokerOrderId: `b${this.submitted.length}`, status: "filled", filledQty: i.qty, avgFillPrice: i.limitPrice, submittedAt: "t", filledAt: "t" };
  }
  async getOrder(id: string): Promise<Order> {
    throw new Error(id);
  }
  async cancel() {}
}

const mkDeps = (reasoner: Reasoner, events: RawEvent[]) => {
  const store = new MemoryStore();
  const ingestor: Ingestor = { source: "manual", fetch: async () => events };
  return {
    store,
    deps: {
      store,
      ingestors: [ingestor],
      filter: new DefaultFilter(marketData.getQuote),
      reasoner,
      documents: { documentsFor: async () => [{ ref: "test:1", title: "doc", text: "x" }] },
      marketData,
      minEdge: 0.1,
      maxCandidates: 5,
    },
  };
};

describe("dailyRun", () => {
  it("ingesta, filtra, razona y clasifica proposed/rejected por edge", async () => {
    const r = new FakeReasoner(0.7);
    const { deps } = mkDeps(r, [ev(), ev({ eventDate: "2026-09-05" })]); // segundo cae por ventana
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    expect(s.newEvents).toBe(2);
    expect(s.passed).toBe(1);
    expect(s.dropped).toBe(1);
    expect(r.calls).toBe(1);
    expect(s.proposed).toHaveLength(1);
    // pMarket forzado desde opciones: P(>=11 | sigma 0.1) ≈ 0.17 → edge ≈ 0.53
    expect(s.proposed[0]!.pMarket).toBeCloseTo(0.17, 1);
    expect(s.proposed[0]!.edge).toBeGreaterThan(0.1);
  });
  it("tesis sin edge queda registrada como rejected", async () => {
    const { deps } = mkDeps(new FakeReasoner(0.2), [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    expect(s.proposed).toHaveLength(0);
    expect(s.rejected).toHaveLength(1);
    expect(s.rejected[0]!.rejectionReason).toBe("edge_below_threshold");
  });
  it("no re-razona eventos ya vistos (dedupe)", async () => {
    const r = new FakeReasoner(0.7);
    const e = ev();
    const { deps } = mkDeps(r, [e]);
    await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    expect(r.calls).toBe(1);
  });
  it("un error del razonador no tumba la corrida", async () => {
    const bad: Reasoner = { promptVersion: "v", propose: async () => { throw new Error("boom"); } };
    const { deps } = mkDeps(bad, [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    expect(s.errors).toHaveLength(1);
  });
});

describe("approve → risk → broker → close → calibration", () => {
  it("flujo completo en paper", async () => {
    const { store, deps } = mkDeps(new FakeReasoner(0.7), [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    const thesisId = s.proposed[0]!.id;
    const broker = new FakeBroker();
    const snapshot = () => buildSnapshot(store, { equity: 100_000, lastEquity: 100_000 }, false);

    const res = await approveAndExecute(thesisId, { store, risk: new DefaultRiskEngine(), marketData, broker, snapshot });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.order.qty).toBe(1000); // 10% de 100k a $10
    expect((await store.thesis(thesisId))!.status).toBe("open");

    const snap = await snapshot();
    expect(snap.openByThesis[thesisId]).toBe(10_000);
    expect(snap.openByEventType.earnings).toBe(10_000);

    // segunda aprobación de la misma tesis: rechazada
    const again = await approveAndExecute(thesisId, { store, risk: new DefaultRiskEngine(), marketData, broker, snapshot });
    expect(again).toMatchObject({ ok: false, reason: "bad_status" });

    const out = await closeThesis({ thesisId, predictedOutcomeHappened: true, closeReason: "event_resolved" }, { store, broker, marketData });
    expect(out.pnlUsd).toBeCloseTo(1000 * (9.95 - 10), 2); // salida a spot*0.995
    expect((await store.thesis(thesisId))!.status).toBe("closed");
    expect(broker.submitted.at(-1)?.side).toBe("sell");

    const report = calibrationReport(await store.allOutcomesWithTheses(), 100_000);
    expect(report.closed).toBe(1);
    expect(report.hitRate).toBe(1);
    expect(report.criteria.enoughSamples).toBe(false);
    expect(report.criteria.readyForRealMoney).toBe(false);
  });

  it("riesgo bloquea con kill switch y registra rechazo", async () => {
    const { store, deps } = mkDeps(new FakeReasoner(0.7), [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    const res = await approveAndExecute(s.proposed[0]!.id, {
      store, risk: new DefaultRiskEngine(), marketData, broker: new FakeBroker(),
      snapshot: () => buildSnapshot(store, { equity: 100_000, lastEquity: 100_000 }, true),
    });
    expect(res).toMatchObject({ ok: false, reason: "kill_switch" });
    expect((await store.thesis(s.proposed[0]!.id))!.rejectionReason).toBe("risk_rule");
  });

  it("rechazo humano queda registrado", async () => {
    const { store, deps } = mkDeps(new FakeReasoner(0.7), [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    expect(await rejectByHuman(s.proposed[0]!.id, store, "no me convence")).toBe(true);
    expect((await store.thesis(s.proposed[0]!.id))!.rejectionReason).toBe("human");
  });

  it("opciones: usa el contrato ATM y el tope de prima", async () => {
    const r: Reasoner = { promptVersion: "v", propose: async (b) => ({ ...proposalFor(b.event, 0.8), instrument: "call", entryMax: 1.2 }) };
    const { store, deps } = mkDeps(r, [ev()]);
    const s = await dailyRun(deps, { since: "2026-09-01", today: "2026-09-04" });
    const broker = new FakeBroker();
    const res = await approveAndExecute(s.proposed[0]!.id, { store, risk: new DefaultRiskEngine(), marketData, broker, snapshot: () => buildSnapshot(store, { equity: 100_000, lastEquity: 100_000 }, false) });
    expect(res.ok).toBe(true);
    expect(broker.submitted[0]?.symbol).toBe("XXXX260925C00010000");
    expect(broker.submitted[0]?.qty).toBe(30); // 3000 / (1.0 * 100)
  });

  it("syncOrders tolera errores del broker", async () => {
    const store = new MemoryStore();
    await store.insertOrder({ id: "o", thesisId: "t", ticker: "X", instrument: "stock", symbol: "X", side: "buy", qty: 1, limitPrice: 1, notionalUsd: 1, brokerOrderId: "b", status: "submitted", filledQty: 0, avgFillPrice: null, submittedAt: null, filledAt: null });
    expect(await syncOrders(store, new FakeBroker())).toBe(0);
  });
});

describe("calibrationReport", () => {
  const row = (pEst: number, pMkt: number, hit: boolean, pnl: number, i: number) => ({
    thesis: { id: `t${i}`, rawEventId: "", ticker: "X", eventType: "earnings" as const, eventDate: null, direction: "long" as const, pEstimate: pEst, pMarket: pMkt, edge: pEst - pMkt, instrument: "stock" as const, entryMax: 1, target: 1, invalidation: "x", confidence: "med" as const, reasoning: "", sources: [], status: "closed" as const, rejectionReason: null, promptVersion: "v", createdAt: "", updatedAt: "" },
    outcome: { thesisId: `t${i}`, predictedOutcomeHappened: hit, pnlUsd: pnl, pnlPct: pnl / 100, closeReason: "event_resolved" as const, closedAt: `2026-09-${String(i + 1).padStart(2, "0")}T00:00:00Z`, notes: "" },
  });
  it("brier, drawdown y criterios", () => {
    const rows = [row(0.8, 0.5, true, 2000, 0), row(0.7, 0.5, true, 1000, 1), row(0.6, 0.5, false, -3000, 2), row(0.8, 0.5, true, 1500, 3)];
    const r = calibrationReport(rows, 100_000, 2, { minClosed: 4, maxDrawdownPct: 15 });
    expect(r.closed).toBe(4);
    expect(r.hitRate).toBe(0.75);
    expect(r.brierSystem).toBeLessThan(r.brierMarket);
    expect(r.maxDrawdownPct).toBeCloseTo((3000 / 103_000) * 100, 3);
    expect(r.totalPnlUsd).toBe(1500);
    expect(r.humanRejected).toBe(2);
    expect(r.criteria.readyForRealMoney).toBe(true);
  });
  it("sin datos no está listo", () => {
    expect(calibrationReport([], 100_000).criteria.readyForRealMoney).toBe(false);
  });
});
