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
    const csym = `C${ticker}`;
    await db.delete(schema.portfolioVerdicts).where(eq(schema.portfolioVerdicts.symbol, csym));
    await db.delete(schema.symbolMeta).where(eq(schema.symbolMeta.symbol, csym));
    await db.delete(schema.transactions).where(eq(schema.transactions.symbol, csym));
    await db.delete(schema.positions).where(eq(schema.positions.symbol, csym));
    await db.delete(schema.portfolioRisk).where(eq(schema.portfolioRisk.snapshotDate, "2026-08-01"));
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

  it("cartera: posiciones, operaciones, perfil, veredictos, medición y riesgo", async () => {
    const sym = `C${ticker}`;
    await repo.upsertPosition({ symbol: sym, quantity: 10, avgCost: 5, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await repo.upsertPosition({ symbol: sym, quantity: 12, avgCost: 5.5, currency: "USD", market: "us", layer: "riesgo", notes: "x" });
    expect((await repo.positions()).find((p) => p.symbol === sym)?.quantity).toBe(12);

    const tx = { id: randomUUID(), symbol: sym, type: "BUY" as const, quantity: 1, price: 2, fees: 0, date: "2026-01-02", currency: "USD", platform: "Nexo", externalId: `ext-${sym}`, notes: null };
    expect(await repo.insertTransactions([tx, { ...tx, id: randomUUID() }])).toBe(1);
    expect((await repo.transactions()).some((t) => t.symbol === sym && t.externalId === `ext-${sym}`)).toBe(true);

    await repo.saveProfile({ symbol: sym, name: "N", country: "US", industry: "I", marketCap: 1 });
    expect((await repo.profile(sym))?.profile.country).toBe("US");
    expect(await repo.recentFilingTitles(sym, 5)).toEqual([]);

    const row = { verdictDate: "2026-08-01", symbol: sym, verb: "MANTENER" as const, reason: "r", narrative: null, warning: null, close: 10, spot: 10, stop: 9, target: 12, gainPct: 100, weightPct: 50, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null };
    await repo.upsertVerdicts([row]);
    await repo.upsertVerdicts([{ ...row, reason: "r2" }]);
    expect((await repo.latestVerdicts()).find((v) => v.symbol === sym)?.reason).toBe("r2");
    expect((await repo.verdictsToMeasure("2026-08-08", 7)).some((v) => v.symbol === sym)).toBe(true);
    await repo.setMeasurement("2026-08-01", sym, { close7d: 11, spy7d: 505, alpha7dPct: 9 });
    expect((await repo.verdictsToMeasure("2026-08-08", 7)).some((v) => v.symbol === sym)).toBe(false);
    expect((await repo.allVerdicts()).find((v) => v.symbol === sym)?.alpha7dPct).toBe(9);

    const report = { totalValue: 1, weights: [], concentration: { byCountry: {}, byIndustry: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] };
    await repo.saveRisk("2026-08-01", report);
    await repo.saveRisk("2026-08-01", { ...report, totalValue: 2 });
    expect((await repo.latestRisk())?.report.totalValue).toBe(2);
  });
});
