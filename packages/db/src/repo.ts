import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Order, Outcome, RawEvent, Thesis, ThesisProposal } from "@thesis/core";
import { computeEdge } from "@thesis/core";
import type { Db } from "./index.js";
import * as s from "./schema.js";

const num = (v: string | number | null | undefined): number => (v === null || v === undefined ? Number.NaN : Number(v));
const str = (n: number) => String(n);

/** Repositorio único (v1). Todo lo que toca la DB pasa por acá. */
export class Repo {
  constructor(private readonly db: Db) {}

  // ---------- raw_events ----------
  /** Inserta ignorando duplicados (índice único de dedupe). Devuelve los realmente nuevos. */
  async insertRawEvents(events: RawEvent[]): Promise<RawEvent[]> {
    if (!events.length) return [];
    const rows = await this.db
      .insert(s.rawEvents)
      .values(events.map((e) => ({ id: e.id, ticker: e.ticker, eventType: e.eventType, source: e.source, eventDate: e.eventDate, sourceRef: e.sourceRef, title: e.title, payload: e.payload, observedAt: new Date(e.observedAt) })))
      .onConflictDoNothing()
      .returning({ id: s.rawEvents.id });
    const ids = new Set(rows.map((r) => r.id));
    return events.filter((e) => ids.has(e.id));
  }

  async markFilter(results: Array<{ id: string; passed: boolean; reason: string | null }>): Promise<void> {
    for (const r of results) {
      await this.db.update(s.rawEvents).set({ filterPassed: r.passed, filterReason: r.reason }).where(eq(s.rawEvents.id, r.id));
    }
  }

  async unfilteredEvents(limit = 500): Promise<RawEvent[]> {
    const rows = await this.db.select().from(s.rawEvents).where(sql`${s.rawEvents.filterPassed} is null`).orderBy(desc(s.rawEvents.observedAt)).limit(limit);
    return rows.map(toRawEvent);
  }

  async rawEvent(id: string): Promise<RawEvent | null> {
    const r = await this.db.select().from(s.rawEvents).where(eq(s.rawEvents.id, id)).limit(1);
    return r[0] ? toRawEvent(r[0]) : null;
  }

  // ---------- prompt_versions ----------
  async ensurePromptVersion(version: string, content: string, notes = ""): Promise<void> {
    await this.db.insert(s.promptVersions).values({ version, hash: version.split("-").pop() ?? version, content, notes }).onConflictDoNothing();
  }

  // ---------- theses ----------
  async insertThesis(rawEventId: string, p: ThesisProposal, promptVersion: string, minEdge: number): Promise<Thesis> {
    const edge = computeEdge(p);
    const status = edge >= minEdge ? "proposed" : "rejected";
    const [row] = await this.db
      .insert(s.theses)
      .values({
        rawEventId,
        ticker: p.ticker.toUpperCase(),
        eventType: p.eventType,
        eventDate: p.eventDate,
        direction: p.direction,
        pEstimate: str(p.pEstimate),
        pMarket: str(p.pMarket),
        edge: str(edge),
        instrument: p.instrument,
        entryMax: str(p.entryMax),
        target: str(p.target),
        invalidation: p.invalidation,
        confidence: p.confidence,
        reasoning: p.reasoning,
        sources: p.sources,
        status,
        rejectionReason: status === "rejected" ? "edge_below_threshold" : null,
        promptVersion,
      })
      .returning();
    return toThesis(row!);
  }

  async thesis(id: string): Promise<Thesis | null> {
    const r = await this.db.select().from(s.theses).where(eq(s.theses.id, id)).limit(1);
    return r[0] ? toThesis(r[0]) : null;
  }

  async thesesByStatus(status: Thesis["status"] | Thesis["status"][], limit = 200): Promise<Thesis[]> {
    const list = Array.isArray(status) ? status : [status];
    const rows = await this.db.select().from(s.theses).where(inArray(s.theses.status, list)).orderBy(desc(s.theses.createdAt)).limit(limit);
    return rows.map(toThesis);
  }

  async setThesisStatus(id: string, status: Thesis["status"], extra: { rejectionReason?: Thesis["rejectionReason"]; humanDecision?: string } = {}): Promise<void> {
    await this.db
      .update(s.theses)
      .set({
        status,
        updatedAt: new Date(),
        ...(extra.rejectionReason !== undefined ? { rejectionReason: extra.rejectionReason } : {}),
        ...(extra.humanDecision !== undefined ? { humanDecision: extra.humanDecision, humanDecidedAt: new Date() } : {}),
      })
      .where(eq(s.theses.id, id));
  }

  /** Tesis cerradas del mismo tipo con su outcome (comparables para el razonador). */
  async comparables(eventType: Thesis["eventType"], limit = 30): Promise<Array<{ thesis: Thesis; outcome: Outcome }>> {
    const rows = await this.db
      .select({ t: s.theses, o: s.outcomes })
      .from(s.theses)
      .innerJoin(s.outcomes, eq(s.outcomes.thesisId, s.theses.id))
      .where(and(eq(s.theses.eventType, eventType), eq(s.theses.status, "closed")))
      .orderBy(desc(s.outcomes.closedAt))
      .limit(limit);
    return rows.map((r) => ({ thesis: toThesis(r.t), outcome: toOutcome(r.o) }));
  }

  // ---------- orders ----------
  async insertOrder(o: Order): Promise<void> {
    await this.db.insert(s.orders).values({
      id: o.id,
      thesisId: o.thesisId,
      ticker: o.ticker,
      instrument: o.instrument,
      symbol: o.symbol,
      side: o.side,
      qty: o.qty,
      limitPrice: str(o.limitPrice),
      notionalUsd: str(o.notionalUsd),
      brokerOrderId: o.brokerOrderId,
      status: o.status,
      filledQty: o.filledQty,
      avgFillPrice: o.avgFillPrice === null ? null : str(o.avgFillPrice),
      paper: true,
      submittedAt: o.submittedAt ? new Date(o.submittedAt) : null,
      filledAt: o.filledAt ? new Date(o.filledAt) : null,
    });
  }

  async updateOrder(o: Order): Promise<void> {
    await this.db
      .update(s.orders)
      .set({ status: o.status, filledQty: o.filledQty, avgFillPrice: o.avgFillPrice === null ? null : str(o.avgFillPrice), filledAt: o.filledAt ? new Date(o.filledAt) : null })
      .where(eq(s.orders.id, o.id));
  }

  async ordersForThesis(thesisId: string): Promise<Order[]> {
    const rows = await this.db.select().from(s.orders).where(eq(s.orders.thesisId, thesisId));
    return rows.map(toOrder);
  }

  async openOrders(): Promise<Order[]> {
    const rows = await this.db.select().from(s.orders).where(inArray(s.orders.status, ["pending", "submitted", "partially_filled"]));
    return rows.map(toOrder);
  }

  // ---------- outcomes ----------
  async insertOutcome(o: Outcome): Promise<void> {
    await this.db.insert(s.outcomes).values({
      thesisId: o.thesisId,
      predictedOutcomeHappened: o.predictedOutcomeHappened,
      pnlUsd: str(o.pnlUsd),
      pnlPct: str(o.pnlPct),
      closeReason: o.closeReason,
      closedAt: new Date(o.closedAt),
      notes: o.notes,
    });
  }

  async allOutcomesWithTheses(): Promise<Array<{ thesis: Thesis; outcome: Outcome }>> {
    const rows = await this.db.select({ t: s.theses, o: s.outcomes }).from(s.outcomes).innerJoin(s.theses, eq(s.theses.id, s.outcomes.thesisId)).orderBy(s.outcomes.closedAt);
    return rows.map((r) => ({ thesis: toThesis(r.t), outcome: toOutcome(r.o) }));
  }
}

function toRawEvent(r: typeof s.rawEvents.$inferSelect): RawEvent {
  return { id: r.id, ticker: r.ticker, eventType: r.eventType, source: r.source, eventDate: r.eventDate, sourceRef: r.sourceRef, title: r.title, payload: (r.payload as Record<string, unknown>) ?? {}, observedAt: r.observedAt.toISOString() };
}
function toThesis(r: typeof s.theses.$inferSelect): Thesis {
  return {
    id: r.id,
    rawEventId: r.rawEventId,
    ticker: r.ticker,
    eventType: r.eventType,
    eventDate: r.eventDate,
    direction: r.direction,
    pEstimate: num(r.pEstimate),
    pMarket: num(r.pMarket),
    edge: num(r.edge),
    instrument: r.instrument,
    entryMax: num(r.entryMax),
    target: num(r.target),
    invalidation: r.invalidation,
    confidence: r.confidence,
    reasoning: r.reasoning,
    sources: r.sources,
    status: r.status,
    rejectionReason: r.rejectionReason,
    promptVersion: r.promptVersion,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}
function toOrder(r: typeof s.orders.$inferSelect): Order {
  return {
    id: r.id,
    thesisId: r.thesisId,
    ticker: r.ticker,
    instrument: r.instrument,
    symbol: r.symbol,
    side: r.side,
    qty: r.qty,
    limitPrice: num(r.limitPrice),
    notionalUsd: num(r.notionalUsd),
    brokerOrderId: r.brokerOrderId,
    status: r.status,
    filledQty: r.filledQty,
    avgFillPrice: r.avgFillPrice === null ? null : num(r.avgFillPrice),
    submittedAt: r.submittedAt?.toISOString() ?? null,
    filledAt: r.filledAt?.toISOString() ?? null,
  };
}
function toOutcome(r: typeof s.outcomes.$inferSelect): Outcome {
  return { thesisId: r.thesisId, predictedOutcomeHappened: r.predictedOutcomeHappened, pnlUsd: num(r.pnlUsd), pnlPct: num(r.pnlPct), closeReason: r.closeReason, closedAt: r.closedAt.toISOString(), notes: r.notes };
}
