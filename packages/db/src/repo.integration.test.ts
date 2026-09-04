import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { Repo, createDb, schema } from "./index.js";

const url = process.env["DATABASE_URL"];
const d = url ? describe : describe.skip;

d("Repo (Postgres real)", () => {
  const db = createDb(url);
  const repo = new Repo(db);
  const ticker = `T${randomUUID().slice(0, 4).toUpperCase()}`;

  // Corre contra la DB que apunte DATABASE_URL (puede ser la de desarrollo): no dejar residuos,
  // o aparecen en calibración y como comparables del razonador.
  afterAll(async () => {
    const mine = db.select({ id: schema.theses.id }).from(schema.theses).where(eq(schema.theses.ticker, ticker));
    await db.delete(schema.outcomes).where(inArray(schema.outcomes.thesisId, mine));
    await db.delete(schema.orders).where(eq(schema.orders.ticker, ticker));
    await db.delete(schema.theses).where(eq(schema.theses.ticker, ticker));
    await db.delete(schema.rawEvents).where(eq(schema.rawEvents.ticker, ticker));
    await db.delete(schema.promptVersions).where(eq(schema.promptVersions.version, "v-test"));
  });

  it("raw_events: inserta, dedupea y marca filtro", async () => {
    const ev = { id: randomUUID(), ticker, eventType: "earnings" as const, source: "manual" as const, eventDate: "2026-10-01", sourceRef: "ref1", title: "t", payload: { a: 1 }, observedAt: new Date().toISOString() };
    expect(await repo.insertRawEvents([ev])).toHaveLength(1);
    expect(await repo.insertRawEvents([{ ...ev, id: randomUUID() }])).toHaveLength(0);
    const pending = await repo.unfilteredEvents();
    expect(pending.some((e) => e.id === ev.id)).toBe(true);
    await repo.markFilter([{ id: ev.id, passed: true, reason: null }]);
    expect((await repo.unfilteredEvents()).some((e) => e.id === ev.id)).toBe(false);
  });

  it("theses/orders/outcomes: ciclo completo con numéricos correctos", async () => {
    const ev = { id: randomUUID(), ticker, eventType: "fda" as const, source: "manual" as const, eventDate: "2026-11-20", sourceRef: `ref-${randomUUID()}`, title: "pdufa", payload: {}, observedAt: new Date().toISOString() };
    await repo.insertRawEvents([ev]);
    await repo.ensurePromptVersion("v-test", "content");
    const t = await repo.insertThesis(ev.id, {
      ticker, eventType: "fda", eventDate: "2026-11-20", direction: "long", pEstimate: 0.7123, pMarket: 0.5, instrument: "call", entryMax: 1.25, target: 15,
      invalidation: "CRL anunciado antes de la fecha PDUFA por la FDA.", confidence: "high", reasoning: "Razonamiento de prueba con más de cincuenta caracteres para validar.", sources: ["x"],
    }, "v-test", 0.1);
    expect(t.status).toBe("proposed");
    expect(t.edge).toBeCloseTo(0.2123, 4);
    expect(typeof t.pEstimate).toBe("number");

    await repo.setThesisStatus(t.id, "approved", { humanDecision: "approve" });
    await repo.insertOrder({ id: randomUUID(), thesisId: t.id, ticker, instrument: "call", symbol: `${ticker}261120C00015000`, side: "buy", qty: 10, limitPrice: 1.2, notionalUsd: 1200, brokerOrderId: "b1", status: "submitted", filledQty: 0, avgFillPrice: null, submittedAt: new Date().toISOString(), filledAt: null });
    await repo.setThesisStatus(t.id, "open");
    const open = await repo.openOrders();
    const mine = open.find((o) => o.thesisId === t.id)!;
    expect(mine.notionalUsd).toBe(1200);
    await repo.updateOrder({ ...mine, status: "filled", filledQty: 10, avgFillPrice: 1.15, filledAt: new Date().toISOString() });
    expect((await repo.ordersForThesis(t.id))[0]?.avgFillPrice).toBe(1.15);

    await repo.insertOutcome({ thesisId: t.id, predictedOutcomeHappened: true, pnlUsd: 800, pnlPct: 69.5652, closeReason: "event_resolved", closedAt: new Date().toISOString(), notes: "" });
    await repo.setThesisStatus(t.id, "closed");
    const comps = await repo.comparables("fda");
    expect(comps.some((c) => c.thesis.id === t.id && c.outcome.pnlUsd === 800)).toBe(true);
    expect((await repo.thesesByStatus("closed")).some((x) => x.id === t.id)).toBe(true);
  });
});
