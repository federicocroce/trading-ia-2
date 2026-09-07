import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Order, Outcome, Position, RawEvent, RiskReport, SymbolProfile, Thesis, ThesisProposal, Transaction, VerdictRow } from "@thesis/core";
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
  // ---------- cartera (spec etapa 1) ----------
  async positions(): Promise<Position[]> {
    const rows = await this.db.select().from(s.positions).orderBy(s.positions.symbol);
    return rows.map((r) => ({ symbol: r.symbol, quantity: num(r.quantity), avgCost: num(r.avgCost), currency: r.currency, market: r.market, layer: r.layer, notes: r.notes }));
  }
  async upsertPosition(p: Position): Promise<void> {
    const v = { symbol: p.symbol.toUpperCase(), quantity: str(p.quantity), avgCost: str(p.avgCost), currency: p.currency, market: p.market, layer: p.layer, notes: p.notes, updatedAt: new Date() };
    await this.db.insert(s.positions).values(v).onConflictDoUpdate({ target: s.positions.symbol, set: v });
  }
  async deletePosition(symbol: string): Promise<void> {
    await this.db.delete(s.positions).where(eq(s.positions.symbol, symbol.toUpperCase()));
  }
  async transactions(): Promise<Transaction[]> {
    const rows = await this.db.select().from(s.transactions).orderBy(desc(s.transactions.date));
    return rows.map((r) => ({ id: r.id, symbol: r.symbol, type: r.type, quantity: num(r.quantity), price: num(r.price), fees: num(r.fees), date: r.date, currency: r.currency, platform: r.platform, externalId: r.externalId, notes: r.notes }));
  }
  /** Ignora duplicados por external_id o por (fecha, símbolo, tipo, cantidad, precio). Devuelve cuántas entraron. */
  async insertTransactions(txs: Transaction[]): Promise<number> {
    if (!txs.length) return 0;
    let inserted = 0;
    for (const t of txs) {
      const rows = await this.db
        .insert(s.transactions)
        .values({ id: t.id, symbol: t.symbol.toUpperCase(), type: t.type, quantity: str(t.quantity), price: str(t.price), fees: str(t.fees), date: t.date, currency: t.currency, platform: t.platform, externalId: t.externalId, notes: t.notes })
        .onConflictDoNothing()
        .returning({ id: s.transactions.id });
      inserted += rows.length;
    }
    return inserted;
  }
  async profile(symbol: string): Promise<{ profile: SymbolProfile; updatedAt: string } | null> {
    const r = (await this.db.select().from(s.symbolMeta).where(eq(s.symbolMeta.symbol, symbol.toUpperCase())))[0];
    if (!r) return null;
    return { profile: { symbol: r.symbol, name: r.name, country: r.country, industry: r.industry, marketCap: r.marketCap === null ? null : num(r.marketCap) }, updatedAt: r.updatedAt.toISOString() };
  }
  async saveProfile(p: SymbolProfile): Promise<void> {
    const v = { symbol: p.symbol.toUpperCase(), name: p.name, country: p.country, industry: p.industry, marketCap: p.marketCap === null ? null : str(p.marketCap), updatedAt: new Date() };
    await this.db.insert(s.symbolMeta).values(v).onConflictDoUpdate({ target: s.symbolMeta.symbol, set: v });
  }
  private verdictToRow(v: VerdictRow) {
    const n = (x: number | null) => (x === null ? null : str(x));
    return { verdictDate: v.verdictDate, symbol: v.symbol, verb: v.verb, reason: v.reason, narrative: v.narrative, warning: v.warning, close: str(v.close), spot: n(v.spot), stop: n(v.stop), target: n(v.target), gainPct: str(v.gainPct), weightPct: str(v.weightPct), spyClose: n(v.spyClose), degradedBy: v.degradedBy, promptVersion: v.promptVersion, close7d: n(v.close7d), spy7d: n(v.spy7d), alpha7dPct: n(v.alpha7dPct), close30d: n(v.close30d), spy30d: n(v.spy30d), alpha30dPct: n(v.alpha30dPct), measuredAt: v.measuredAt ? new Date(v.measuredAt) : null };
  }
  private rowToVerdict(r: typeof s.portfolioVerdicts.$inferSelect): VerdictRow {
    const n = (x: string | null) => (x === null ? null : num(x));
    return { verdictDate: r.verdictDate, symbol: r.symbol, verb: r.verb, reason: r.reason, narrative: r.narrative, warning: r.warning, close: num(r.close), spot: n(r.spot), stop: n(r.stop), target: n(r.target), gainPct: num(r.gainPct), weightPct: num(r.weightPct), spyClose: n(r.spyClose), degradedBy: r.degradedBy, promptVersion: r.promptVersion, close7d: n(r.close7d), spy7d: n(r.spy7d), alpha7dPct: n(r.alpha7dPct), close30d: n(r.close30d), spy30d: n(r.spy30d), alpha30dPct: n(r.alpha30dPct), measuredAt: r.measuredAt?.toISOString() ?? null };
  }
  /** Upsert por (fecha, símbolo). No pisa la medición ya hecha. */
  async upsertVerdicts(rows: VerdictRow[]): Promise<void> {
    for (const v of rows) {
      const row = this.verdictToRow(v);
      const { verdictDate: _d, symbol: _s, close7d: _a, spy7d: _b, alpha7dPct: _c, close30d: _e, spy30d: _f, alpha30dPct: _g, measuredAt: _h, ...set } = row;
      await this.db.insert(s.portfolioVerdicts).values(row).onConflictDoUpdate({ target: [s.portfolioVerdicts.verdictDate, s.portfolioVerdicts.symbol], set });
    }
  }
  async latestVerdicts(): Promise<VerdictRow[]> {
    const last = (await this.db.select({ d: sql<string | null>`max(${s.portfolioVerdicts.verdictDate})` }).from(s.portfolioVerdicts))[0]?.d;
    if (!last) return [];
    return (await this.db.select().from(s.portfolioVerdicts).where(eq(s.portfolioVerdicts.verdictDate, last)).orderBy(s.portfolioVerdicts.symbol)).map((r) => this.rowToVerdict(r));
  }
  async verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]> {
    const col = horizon === 7 ? s.portfolioVerdicts.close7d : s.portfolioVerdicts.close30d;
    return (await this.db.select().from(s.portfolioVerdicts).where(and(sql`${s.portfolioVerdicts.verdictDate} <= ${before}`, sql`${col} is null`))).map((r) => this.rowToVerdict(r));
  }
  async setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void> {
    const set: Record<string, unknown> = { measuredAt: new Date() };
    for (const [k, v] of Object.entries(m)) set[k] = v === null || v === undefined ? null : str(v);
    await this.db.update(s.portfolioVerdicts).set(set).where(and(eq(s.portfolioVerdicts.verdictDate, verdictDate), eq(s.portfolioVerdicts.symbol, symbol)));
  }
  async allVerdicts(): Promise<VerdictRow[]> {
    return (await this.db.select().from(s.portfolioVerdicts).orderBy(desc(s.portfolioVerdicts.verdictDate), s.portfolioVerdicts.symbol)).map((r) => this.rowToVerdict(r));
  }
  async saveRisk(date: string, report: RiskReport): Promise<void> {
    await this.db.insert(s.portfolioRisk).values({ snapshotDate: date, report }).onConflictDoUpdate({ target: s.portfolioRisk.snapshotDate, set: { report } });
  }
  async latestRisk(): Promise<{ date: string; report: RiskReport } | null> {
    const r = (await this.db.select().from(s.portfolioRisk).orderBy(desc(s.portfolioRisk.snapshotDate)).limit(1))[0];
    return r ? { date: r.snapshotDate, report: r.report as RiskReport } : null;
  }
  /** Títulos de filings recientes del ticker (contexto para la narrativa). */
  async recentFilingTitles(ticker: string, limit = 8): Promise<string[]> {
    const rows = await this.db.select({ title: s.rawEvents.title }).from(s.rawEvents).where(and(eq(s.rawEvents.ticker, ticker.toUpperCase()), eq(s.rawEvents.source, "edgar"))).orderBy(desc(s.rawEvents.observedAt)).limit(limit);
    return rows.map((r) => r.title);
  }
  /** Noticias argentinas que mencionan a la empresa (contexto para ADRs). */
  async recentNewsTitles(query: string, limit = 5): Promise<string[]> {
    const rows = await this.db.select({ title: s.rawEvents.title }).from(s.rawEvents).where(and(eq(s.rawEvents.source, "ar_official"), sql`${s.rawEvents.title} ilike ${"%" + query + "%"}`)).orderBy(desc(s.rawEvents.observedAt)).limit(limit);
    return rows.map((r) => r.title);
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
