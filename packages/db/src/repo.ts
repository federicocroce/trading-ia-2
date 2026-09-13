import { and, desc, eq, gte, inArray, lt, notInArray, sql } from "drizzle-orm";
import type { AnalystAction, Candle, CandidateRow, CandidateVerification, ContributionPlan, Fundamentals, MacroAr, NewsItem, Order, Outcome,PlanLine, Position, RadarEvent, RawEvent, RiskReport, ScanStage, Statements, SymbolDescription, SymbolProfile, Tags, Thesis, ThesisProposal, Transaction, UsageCall, UsageResult, VerdictRow, WatchEval, WatchItem, WatchSnapshot } from "@thesis/core";
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
  async knownSourceRefs(source: RawEvent["source"], refs: string[]): Promise<Set<string>> {
    if (!refs.length) return new Set();
    const rows = await this.db.select({ ref: s.rawEvents.sourceRef }).from(s.rawEvents).where(and(eq(s.rawEvents.source, source), inArray(s.rawEvents.sourceRef, refs)));
    return new Set(rows.map((r) => r.ref));
  }
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
  async insertThesis(rawEventId: string, p: ThesisProposal & { pMarketFromOptions?: boolean }, promptVersion: string, minEdge: number): Promise<Thesis> {
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
        pMarketFromOptions: p.pMarketFromOptions ?? false,
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
  async thesesForTicker(ticker: string, limit = 20): Promise<Thesis[]> {
    return (await this.db.select().from(s.theses).where(eq(s.theses.ticker, ticker.toUpperCase())).orderBy(desc(s.theses.createdAt)).limit(limit)).map(toThesis);
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
    return { profile: { symbol: r.symbol, name: r.name, country: r.country, industry: r.industry, marketCap: r.marketCap === null ? null : num(r.marketCap), currency: r.currency, shareOutstanding: r.shareOutstanding === null ? null : num(r.shareOutstanding) }, updatedAt: r.updatedAt.toISOString() };
  }
  async saveProfile(p: SymbolProfile): Promise<void> {
    const v = { symbol: p.symbol.toUpperCase(), name: p.name, country: p.country, industry: p.industry, marketCap: p.marketCap === null ? null : str(p.marketCap), currency: p.currency ?? null, shareOutstanding: p.shareOutstanding === null || p.shareOutstanding === undefined ? null : str(p.shareOutstanding), updatedAt: new Date() };
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
  async verdictsForDate(date: string): Promise<VerdictRow[]> {
    return (await this.db.select().from(s.portfolioVerdicts).where(eq(s.portfolioVerdicts.verdictDate, date)).orderBy(s.portfolioVerdicts.symbol)).map((r) => this.rowToVerdict(r));
  }
  async riskForDate(date: string): Promise<{ date: string; report: RiskReport } | null> {
    const r = (await this.db.select().from(s.portfolioRisk).where(sql`${s.portfolioRisk.snapshotDate} <= ${date}`).orderBy(desc(s.portfolioRisk.snapshotDate)).limit(1))[0];
    return r ? { date: r.snapshotDate, report: r.report as RiskReport } : null;
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

  // ---------- radar (spec etapa 2) ----------
  private rowToTags(r: typeof s.symbolMeta.$inferSelect): Tags | null {
    if (!r.assetClass) return null;
    return { assetClass: r.assetClass as Tags["assetClass"], sector: r.sector ?? "Otros", industry: r.industry, themes: (r.themes as string[]) ?? [], themesSource: (r.themesSource as Tags["themesSource"]) ?? "regla" };
  }
  async tags(symbol: string): Promise<Tags | null> {
    const r = (await this.db.select().from(s.symbolMeta).where(eq(s.symbolMeta.symbol, symbol.toUpperCase())))[0];
    return r ? this.rowToTags(r) : null;
  }
  async saveTags(symbol: string, t: Tags): Promise<void> {
    const sym = symbol.toUpperCase();
    const set = { assetClass: t.assetClass, sector: t.sector, industry: t.industry, themes: t.themes, themesSource: t.themesSource, updatedAt: new Date() };
    await this.db.insert(s.symbolMeta).values({ symbol: sym, ...set }).onConflictDoUpdate({ target: s.symbolMeta.symbol, set });
  }
  async allTags(): Promise<Record<string, Tags>> {
    const rows = await this.db.select().from(s.symbolMeta).where(sql`${s.symbolMeta.assetClass} is not null`);
    const out: Record<string, Tags> = {};
    for (const r of rows) {
      const t = this.rowToTags(r);
      if (t) out[r.symbol] = t;
    }
    return out;
  }
  private rowToFundamentals(r: typeof s.fundamentals.$inferSelect): Fundamentals {
    // statementsAsOf: la columna guarda null tanto si nunca se intentó como si se intentó y no hay estados;
    // acá se omite la clave (undefined) en vez de escribir null, así "sin_estados" solo lo decide quien sí llamó a los estados.
    const f: Fundamentals = { symbol: r.symbol, asOf: r.asOf, metrics: r.metrics as Fundamentals["metrics"], peers: (r.peers as string[]) ?? [], industry: r.industry, mcapUsd: r.mcapUsd === null ? null : num(r.mcapUsd), dollarVolumeUsd: num(r.dollarVolumeUsd), priceUsd: num(r.priceUsd), nextEarnings: r.nextEarnings, insiderBuys90d: r.insiderBuys90d, insiderSells90d: r.insiderSells90d, analyst: r.analyst as Fundamentals["analyst"], earningsSurprises: r.earningsSurprises as Fundamentals["earningsSurprises"], metricsRaw: (r.metricsRaw as Fundamentals["metricsRaw"]) ?? null };
    if (r.statementsAsOf !== null) f.statementsAsOf = r.statementsAsOf;
    return f;
  }
  async saveFundamentals(f: Fundamentals): Promise<void> {
    const v = { symbol: f.symbol.toUpperCase(), asOf: f.asOf, metrics: f.metrics, peers: f.peers, industry: f.industry, mcapUsd: f.mcapUsd === null ? null : str(Math.round(f.mcapUsd)), dollarVolumeUsd: str(Math.round(f.dollarVolumeUsd)), priceUsd: str(f.priceUsd), nextEarnings: f.nextEarnings, insiderBuys90d: f.insiderBuys90d, insiderSells90d: f.insiderSells90d, analyst: f.analyst, earningsSurprises: f.earningsSurprises, metricsRaw: f.metricsRaw ?? null, statementsAsOf: f.statementsAsOf ?? null, updatedAt: new Date() };
    await this.db.insert(s.fundamentals).values(v).onConflictDoUpdate({ target: s.fundamentals.symbol, set: v });
  }
  async fundamentals(symbol: string): Promise<Fundamentals | null> {
    const r = (await this.db.select().from(s.fundamentals).where(eq(s.fundamentals.symbol, symbol.toUpperCase())))[0];
    return r ? this.rowToFundamentals(r) : null;
  }
  async freshFundamentals(maxAgeDays: number, today: string): Promise<Fundamentals[]> {
    const since = new Date(Date.parse(today) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    return (await this.db.select().from(s.fundamentals).where(sql`${s.fundamentals.asOf} >= ${since}`)).map((r) => this.rowToFundamentals(r));
  }
  async statements(symbol: string): Promise<Statements | null> {
    const r = (await this.db.select().from(s.statements).where(eq(s.statements.symbol, symbol.toUpperCase())))[0];
    return r ? { symbol: r.symbol, cik: r.cik ?? "", asOf: r.asOf, quarters: (r.quarters as Statements["quarters"]) ?? [], core: (r.core as Statements["core"]) ?? null } : null;
  }
  async saveStatements(st: Statements): Promise<void> {
    const v = { symbol: st.symbol.toUpperCase(), cik: st.cik || null, asOf: st.asOf, quarters: st.quarters, core: st.core, updatedAt: new Date() };
    await this.db.insert(s.statements).values(v).onConflictDoUpdate({ target: s.statements.symbol, set: v });
  }
  async saveVerification(v: CandidateVerification): Promise<void> {
    const row = { symbol: v.symbol.toUpperCase(), date: v.date, verdict: v.verdict, reason: v.reason, lastQuarter: v.lastQuarter, analysts: v.analysts, consensusTarget: v.consensusTarget === null ? null : str(v.consensusTarget), events: v.events, valuation: v.valuation, nextEarnings: v.nextEarnings, sources: v.sources, researchText: v.researchText, promptVersion: v.promptVersion, model: v.model, detectedAt: new Date(v.detectedAt) };
    await this.db.insert(s.radarVerifications).values(row).onConflictDoUpdate({ target: s.radarVerifications.symbol, set: row });
  }
  async verification(symbol: string): Promise<CandidateVerification | null> {
    const r = (await this.db.select().from(s.radarVerifications).where(eq(s.radarVerifications.symbol, symbol.toUpperCase())))[0];
    if (!r) return null;
    return { symbol: r.symbol, date: r.date, verdict: r.verdict as CandidateVerification["verdict"], reason: r.reason, lastQuarter: (r.lastQuarter as CandidateVerification["lastQuarter"]) ?? null, analysts: (r.analysts as CandidateVerification["analysts"]) ?? [], consensusTarget: r.consensusTarget === null ? null : num(r.consensusTarget), events: (r.events as CandidateVerification["events"]) ?? [], valuation: r.valuation, nextEarnings: r.nextEarnings, sources: (r.sources as CandidateVerification["sources"]) ?? [], researchText: r.researchText, promptVersion: r.promptVersion, model: r.model, detectedAt: r.detectedAt.toISOString() };
  }
  async upsertEvents(events: RadarEvent[]): Promise<number> {
    let n = 0;
    for (const e of events) {
      const rows = await this.db.insert(s.radarEvents).values({ symbol: e.symbol.toUpperCase(), date: e.date, kind: e.kind, severity: e.severity, headline: e.headline, url: e.url, source: e.source, why: e.why, detectedAt: new Date(e.detectedAt), promptVersion: e.promptVersion }).onConflictDoNothing().returning({ id: s.radarEvents.id });
      n += rows.length;
    }
    return n;
  }
  async eventsFor(symbol: string, since: string): Promise<RadarEvent[]> {
    const rows = await this.db.select().from(s.radarEvents).where(and(eq(s.radarEvents.symbol, symbol.toUpperCase()), gte(s.radarEvents.date, since))).orderBy(desc(s.radarEvents.date));
    return rows.map((r) => ({ symbol: r.symbol, date: r.date, kind: r.kind as RadarEvent["kind"], severity: r.severity as RadarEvent["severity"], headline: r.headline, url: r.url, source: r.source, why: r.why, detectedAt: r.detectedAt.toISOString(), promptVersion: r.promptVersion }));
  }
  async upsertAnalystActions(actions: AnalystAction[]): Promise<number> {
    let n = 0;
    for (const a of actions) {
      const rows = await this.db.insert(s.analystActions).values({ symbol: a.symbol.toUpperCase(), date: a.date, firm: a.firm, action: a.action, rating: a.rating, target: a.target === null ? null : str(a.target), url: a.url }).onConflictDoNothing().returning({ id: s.analystActions.id });
      n += rows.length;
    }
    return n;
  }
  async analystActions(symbol: string, since: string): Promise<AnalystAction[]> {
    const rows = await this.db.select().from(s.analystActions).where(and(eq(s.analystActions.symbol, symbol.toUpperCase()), gte(s.analystActions.date, since))).orderBy(desc(s.analystActions.date));
    return rows.map((r) => ({ symbol: r.symbol, date: r.date, firm: r.firm, action: r.action as AnalystAction["action"], rating: r.rating, target: r.target === null ? null : num(r.target), url: r.url }));
  }
  async newsScannedTo(symbol: string): Promise<string | null> {
    return (await this.db.select().from(s.radarNewsScans).where(eq(s.radarNewsScans.symbol, symbol.toUpperCase())))[0]?.scannedTo ?? null;
  }
  async setNewsScannedTo(symbol: string, date: string): Promise<void> {
    const v = { symbol: symbol.toUpperCase(), scannedTo: date, updatedAt: new Date() };
    await this.db.insert(s.radarNewsScans).values(v).onConflictDoUpdate({ target: s.radarNewsScans.symbol, set: v });
  }
  async scanUpsert(rows: Array<{ scanDate: string; symbol: string; stage: ScanStage; reason: string | null }>): Promise<void> {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500).map((r) => ({ scanDate: r.scanDate, symbol: r.symbol.toUpperCase(), stage: r.stage, reason: r.reason, updatedAt: new Date() }));
      await this.db.insert(s.universeScan).values(chunk).onConflictDoUpdate({ target: [s.universeScan.scanDate, s.universeScan.symbol], set: { stage: sql`excluded.stage`, reason: sql`excluded.reason`, updatedAt: sql`excluded.updated_at` } });
    }
  }
  async scanPending(scanDate: string): Promise<string[]> {
    return (await this.db.select({ symbol: s.universeScan.symbol }).from(s.universeScan).where(and(eq(s.universeScan.scanDate, scanDate), eq(s.universeScan.stage, "alpaca_ok"))).orderBy(s.universeScan.symbol)).map((r) => r.symbol);
  }
  async scanStatus(scanDate: string): Promise<Record<ScanStage, number>> {
    const rows = await this.db.select({ stage: s.universeScan.stage, n: sql<number>`count(*)::int` }).from(s.universeScan).where(eq(s.universeScan.scanDate, scanDate)).groupBy(s.universeScan.stage);
    const out: Record<ScanStage, number> = { alpaca_ok: 0, finnhub_ok: 0, excluded: 0, error: 0 };
    for (const r of rows) out[r.stage as ScanStage] = Number(r.n);
    return out;
  }
  async scanSymbols(scanDate: string, stage: ScanStage): Promise<string[]> {
    return (await this.db.select({ symbol: s.universeScan.symbol }).from(s.universeScan).where(and(eq(s.universeScan.scanDate, scanDate), eq(s.universeScan.stage, stage))).orderBy(s.universeScan.symbol)).map((r) => r.symbol);
  }
  async latestScanDate(): Promise<string | null> {
    return (await this.db.select({ d: sql<string | null>`max(${s.universeScan.scanDate})` }).from(s.universeScan))[0]?.d ?? null;
  }
  private candidateToRow(c: CandidateRow) {
    const n = (x: number | null) => (x === null ? null : str(x));
    return { candidateDate: c.candidateDate, symbol: c.symbol, kind: c.kind, verdict: c.verdict, score: n(c.score), axes: c.axes, peerGroup: c.peerGroup, rankInGroup: c.rankInGroup, groupSize: c.groupSize, close: str(c.close), entryLow: n(c.entryLow), entryHigh: n(c.entryHigh), stop: n(c.stop), target: n(c.target), sizeUsd: n(c.sizeUsd), sizeQty: c.sizeQty, riskScore: c.riskScore, flags: c.flags, nthAppearance: c.nthAppearance, summary: c.summary, whyRanks: c.whyRanks, mainRisk: c.mainRisk, moat: c.moat, degradedBy: c.degradedBy, promptVersion: c.promptVersion, spyClose: n(c.spyClose), events: c.events ?? [], analystTargets: c.analystTargets ?? null, verification: c.verification ?? null, entry: c.entry ?? null, close7d: n(c.close7d), spy7d: n(c.spy7d), alpha7dPct: n(c.alpha7dPct), close30d: n(c.close30d), spy30d: n(c.spy30d), alpha30dPct: n(c.alpha30dPct), close90d: n(c.close90d), spy90d: n(c.spy90d), alpha90dPct: n(c.alpha90dPct), measuredAt: c.measuredAt ? new Date(c.measuredAt) : null };
  }
  private rowToCandidate(r: typeof s.radarCandidates.$inferSelect): CandidateRow {
    const n = (x: string | null) => (x === null ? null : num(x));
    return { candidateDate: r.candidateDate, symbol: r.symbol, kind: r.kind as CandidateRow["kind"], verdict: r.verdict as CandidateRow["verdict"], score: n(r.score), axes: (r.axes as CandidateRow["axes"]) ?? {}, peerGroup: (r.peerGroup as string[]) ?? [], rankInGroup: r.rankInGroup, groupSize: r.groupSize, close: num(r.close), entryLow: n(r.entryLow), entryHigh: n(r.entryHigh), stop: n(r.stop), target: n(r.target), sizeUsd: n(r.sizeUsd), sizeQty: r.sizeQty, riskScore: r.riskScore, flags: (r.flags as string[]) ?? [], nthAppearance: r.nthAppearance, summary: r.summary, whyRanks: r.whyRanks, mainRisk: r.mainRisk, moat: r.moat, degradedBy: r.degradedBy, promptVersion: r.promptVersion, spyClose: n(r.spyClose), events: (r.events as CandidateRow["events"]) ?? [], analystTargets: (r.analystTargets as CandidateRow["analystTargets"]) ?? null, verification: (r.verification as CandidateRow["verification"]) ?? null, entry: (r.entry as CandidateRow["entry"]) ?? null, close7d: n(r.close7d), spy7d: n(r.spy7d), alpha7dPct: n(r.alpha7dPct), close30d: n(r.close30d), spy30d: n(r.spy30d), alpha30dPct: n(r.alpha30dPct), close90d: n(r.close90d), spy90d: n(r.spy90d), alpha90dPct: n(r.alpha90dPct), measuredAt: r.measuredAt?.toISOString() ?? null };
  }
  /** Upsert por (fecha, símbolo). No pisa la medición ya hecha. */
  async upsertCandidates(rows: CandidateRow[]): Promise<void> {
    for (const c of rows) {
      const row = this.candidateToRow(c);
      const { candidateDate: _d, symbol: _s, close7d: _a, spy7d: _b, alpha7dPct: _c, close30d: _e, spy30d: _f, alpha30dPct: _g, close90d: _h, spy90d: _i, alpha90dPct: _j, measuredAt: _k, ...set } = row;
      await this.db.insert(s.radarCandidates).values(row).onConflictDoUpdate({ target: [s.radarCandidates.candidateDate, s.radarCandidates.symbol], set });
    }
  }
  /**
   * Borra las filas de esa fecha y esa familia que la corrida no volvió a escribir. Un símbolo que pasa a
   * estar excluido deja de escribirse, y sin esto su fila vieja del mismo día sobrevive: MIRG.BA el 13/9
   * quedó mostrando la fuerza relativa de −92,68% que venía de su split sin ajustar, después de que el
   * motor ya la excluyera. Vale para cualquier exclusión, no solo para los splits.
   */
  async pruneCandidates(date: string, kind: CandidateRow["kind"], keep: string[]): Promise<number> {
    const cond = keep.length
      ? and(eq(s.radarCandidates.candidateDate, date), eq(s.radarCandidates.kind, kind), notInArray(s.radarCandidates.symbol, keep))
      : and(eq(s.radarCandidates.candidateDate, date), eq(s.radarCandidates.kind, kind));
    const borradas = await this.db.delete(s.radarCandidates).where(cond).returning({ symbol: s.radarCandidates.symbol });
    return borradas.length;
  }
  /** Última fecha por familia: las filas argentinas (corren otro día) no esconden el último ranking US ni al revés. */
  async latestCandidates(): Promise<CandidateRow[]> {
    const out: CandidateRow[] = [];
    for (const kinds of [["stock", "etf"], ["ar", "cedear"], ["watch"]]) {
      const last = (await this.db.select({ d: sql<string | null>`max(${s.radarCandidates.candidateDate})` }).from(s.radarCandidates).where(inArray(s.radarCandidates.kind, kinds)))[0]?.d;
      if (!last) continue;
      const rows = await this.db.select().from(s.radarCandidates).where(and(eq(s.radarCandidates.candidateDate, last), inArray(s.radarCandidates.kind, kinds))).orderBy(desc(s.radarCandidates.score));
      out.push(...rows.map((r) => this.rowToCandidate(r)));
    }
    return out;
  }
  async candidateHistory(symbol: string, weeks: number): Promise<CandidateRow[]> {
    return (await this.db.select().from(s.radarCandidates).where(eq(s.radarCandidates.symbol, symbol.toUpperCase())).orderBy(desc(s.radarCandidates.candidateDate)).limit(weeks * 7)).map((r) => this.rowToCandidate(r));
  }
  async candidatesToMeasure(before: string, horizon: 7 | 30 | 90): Promise<CandidateRow[]> {
    const col = horizon === 7 ? s.radarCandidates.close7d : horizon === 30 ? s.radarCandidates.close30d : s.radarCandidates.close90d;
    return (await this.db.select().from(s.radarCandidates).where(and(sql`${s.radarCandidates.candidateDate} <= ${before}`, sql`${col} is null`))).map((r) => this.rowToCandidate(r));
  }
  async setCandidateMeasurement(date: string, symbol: string, m: Partial<Pick<CandidateRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct" | "close90d" | "spy90d" | "alpha90dPct">>): Promise<void> {
    const set: Record<string, unknown> = { measuredAt: new Date() };
    for (const [k, v] of Object.entries(m)) set[k] = v === null || v === undefined ? null : str(v);
    await this.db.update(s.radarCandidates).set(set).where(and(eq(s.radarCandidates.candidateDate, date), eq(s.radarCandidates.symbol, symbol)));
  }
  /** Histórico: por familia, las filas de la última fecha ≤ la pedida. */
  async candidatesForDate(date: string): Promise<CandidateRow[]> {
    const out: CandidateRow[] = [];
    for (const kinds of [["stock", "etf"], ["ar", "cedear"], ["watch"]]) {
      const last = (await this.db.select({ d: sql<string | null>`max(${s.radarCandidates.candidateDate})` }).from(s.radarCandidates).where(and(inArray(s.radarCandidates.kind, kinds), sql`${s.radarCandidates.candidateDate} <= ${date}`)))[0]?.d;
      if (!last) continue;
      const rows = await this.db.select().from(s.radarCandidates).where(and(eq(s.radarCandidates.candidateDate, last), inArray(s.radarCandidates.kind, kinds))).orderBy(desc(s.radarCandidates.score));
      out.push(...rows.map((r) => this.rowToCandidate(r)));
    }
    return out;
  }
  /** Fechas con corrida (veredictos o ranking US), de la más nueva a la más vieja. */
  async runDates(limit = 60): Promise<string[]> {
    const v = await this.db.selectDistinct({ d: s.portfolioVerdicts.verdictDate }).from(s.portfolioVerdicts);
    const c = await this.db.selectDistinct({ d: s.radarCandidates.candidateDate }).from(s.radarCandidates).where(inArray(s.radarCandidates.kind, ["stock", "etf"]));
    return [...new Set([...v.map((x) => x.d), ...c.map((x) => x.d)])].sort().reverse().slice(0, limit);
  }
  async allCandidates(): Promise<CandidateRow[]> {
    return (await this.db.select().from(s.radarCandidates).orderBy(desc(s.radarCandidates.candidateDate), s.radarCandidates.symbol)).map((r) => this.rowToCandidate(r));
  }
  private rowToPlan(r: typeof s.contributionPlans.$inferSelect): ContributionPlan {
    return { month: r.planMonth, totalUsd: num(r.totalUsd), lines: (r.lines as PlanLine[]) ?? [], notes: (r.notes as string[]) ?? [], leftOut: (r.leftOut as ContributionPlan["leftOut"]) ?? [], builtAt: r.createdAt.toISOString(), ...(r.tranches === null ? {} : { tranches: r.tranches }) };
  }
  async savePlan(p: ContributionPlan): Promise<void> {
    const v = { planMonth: p.month, totalUsd: str(p.totalUsd), lines: p.lines, notes: p.notes, leftOut: p.leftOut ?? [], tranches: p.tranches ?? null };
    // `createdAt` va en el set a propósito: sin él, el timestamp quedaba congelado en el PRIMER guardado del
    // mes y el plan podía rearmarse diez veces sin que nada lo dijera. El 13/9 la base decía que el plan era
    // del 7 mientras sus precios eran de hoy, y no había forma de saber cuándo se había armado de verdad.
    await this.db.insert(s.contributionPlans).values(v).onConflictDoUpdate({ target: s.contributionPlans.planMonth, set: { ...v, createdAt: new Date() } });
  }
  async latestPlan(): Promise<ContributionPlan | null> {
    const r = (await this.db.select().from(s.contributionPlans).orderBy(desc(s.contributionPlans.planMonth)).limit(1))[0];
    return r ? this.rowToPlan(r) : null;
  }
  /** Planes de meses ≤ `before` con alguna línea sin medir. */
  async plansToMeasure(before: string): Promise<ContributionPlan[]> {
    const rows = await this.db.select().from(s.contributionPlans).where(sql`${s.contributionPlans.planMonth} <= ${before.slice(0, 7)}`);
    return rows.map((r) => this.rowToPlan(r)).filter((p) => p.lines.some((l) => l.alpha30dPct === null || l.alpha90dPct === null));
  }
  async updatePlanLines(month: string, lines: PlanLine[]): Promise<void> {
    await this.db.update(s.contributionPlans).set({ lines }).where(eq(s.contributionPlans.planMonth, month));
  }

  // ---------- página por ticker ----------
  async description(symbol: string): Promise<SymbolDescription | null> {
    const r = (await this.db.select().from(s.symbolMeta).where(eq(s.symbolMeta.symbol, symbol.toUpperCase())))[0];
    if (!r || !r.descriptionUpdatedAt) return null;
    return { symbol: r.symbol, longName: r.longName, summary: r.summary, employees: r.employees, website: r.website, exchangeName: r.exchangeName, firstTradeDate: r.firstTradeDate, sector: r.sector, industry: r.industry, country: r.country, updatedAt: r.descriptionUpdatedAt.toISOString() };
  }
  async saveDescription(d: SymbolDescription): Promise<void> {
    const set = { longName: d.longName, summary: d.summary, employees: d.employees, website: d.website, exchangeName: d.exchangeName, firstTradeDate: d.firstTradeDate, descriptionUpdatedAt: new Date(d.updatedAt), ...(d.country ? { country: d.country } : {}) };
    await this.db.insert(s.symbolMeta).values({ symbol: d.symbol.toUpperCase(), industry: d.industry, ...set }).onConflictDoUpdate({ target: s.symbolMeta.symbol, set });
  }
  async upsertCandles(symbol: string, candles: Candle[]): Promise<void> {
    const sym = symbol.toUpperCase();
    for (let i = 0; i < candles.length; i += 500) {
      const chunk = candles.slice(i, i + 500).map((c) => ({ symbol: sym, date: c.date, open: str(c.open), high: str(c.high), low: str(c.low), close: str(c.close), volume: str(Math.round(c.volume)), adjClose: c.adjClose === null || c.adjClose === undefined ? null : str(c.adjClose) }));
      if (!chunk.length) continue;
      await this.db.insert(s.candlesDaily).values(chunk).onConflictDoUpdate({ target: [s.candlesDaily.symbol, s.candlesDaily.date], set: { open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`, volume: sql`excluded.volume`, adjClose: sql`coalesce(excluded.adj_close, ${s.candlesDaily.adjClose})` } });
    }
  }
  async candles(symbol: string, fromDate: string): Promise<Candle[]> {
    const rows = await this.db.select().from(s.candlesDaily).where(and(eq(s.candlesDaily.symbol, symbol.toUpperCase()), sql`${s.candlesDaily.date} >= ${fromDate}`)).orderBy(s.candlesDaily.date);
    return rows.map((r) => ({ date: r.date, open: num(r.open), high: num(r.high), low: num(r.low), close: num(r.close), volume: num(r.volume), adjClose: r.adjClose === null ? null : num(r.adjClose) }));
  }
  async upsertNews(items: NewsItem[]): Promise<number> {
    let n = 0;
    for (const i of items) {
      const rows = await this.db.insert(s.news).values({ symbol: i.symbol.toUpperCase(), date: i.date, headline: i.headline, source: i.source, url: i.url, summary: i.summary }).onConflictDoNothing().returning({ id: s.news.id });
      n += rows.length;
    }
    return n;
  }
  async news(symbol: string, limit = 20): Promise<NewsItem[]> {
    const rows = await this.db.select().from(s.news).where(eq(s.news.symbol, symbol.toUpperCase())).orderBy(desc(s.news.date), desc(s.news.createdAt)).limit(limit);
    return rows.map((r) => ({ symbol: r.symbol, date: r.date, headline: r.headline, source: r.source, url: r.url, summary: r.summary }));
  }

  // ---------- Argentina (etapa 3) ----------
  private macroToRow(m: MacroAr) {
    const n = (v: number | null) => (v === null ? null : str(v));
    return { date: m.date, oficial: n(m.oficial), mep: n(m.mep), ccl: n(m.ccl), blue: n(m.blue), mayorista: n(m.mayorista), brechaPct: n(m.brechaPct), riesgoPais: m.riesgoPais, merval: n(m.merval), mervalUsd: n(m.mervalUsd), mervalDate: m.mervalDate ?? null };
  }
  private rowToMacro(r: typeof s.macroArDaily.$inferSelect): MacroAr {
    const n = (v: string | null) => (v === null ? null : Number(v));
    return { date: r.date, oficial: n(r.oficial), mep: n(r.mep), ccl: n(r.ccl), blue: n(r.blue), mayorista: n(r.mayorista), brechaPct: n(r.brechaPct), riesgoPais: r.riesgoPais, merval: n(r.merval), mervalUsd: n(r.mervalUsd), mervalDate: r.mervalDate };
  }
  async saveMacroAr(m: MacroAr): Promise<void> {
    const row = this.macroToRow(m);
    const { date: _d, ...set } = row;
    await this.db.insert(s.macroArDaily).values(row).onConflictDoUpdate({ target: s.macroArDaily.date, set });
  }
  async latestMacroAr(): Promise<MacroAr | null> {
    const r = (await this.db.select().from(s.macroArDaily).orderBy(desc(s.macroArDaily.date)).limit(1))[0];
    return r ? this.rowToMacro(r) : null;
  }
  async macroArForDate(date: string): Promise<MacroAr | null> {
    const r = (await this.db.select().from(s.macroArDaily).where(sql`${s.macroArDaily.date} <= ${date}`).orderBy(desc(s.macroArDaily.date)).limit(1))[0];
    return r ? this.rowToMacro(r) : null;
  }
  async macroArSeries(days: number): Promise<MacroAr[]> {
    const rows = await this.db.select().from(s.macroArDaily).orderBy(desc(s.macroArDaily.date)).limit(days);
    return rows.map((r) => this.rowToMacro(r)).reverse();
  }

  // ---------- lista de seguimiento ----------
  async watchlist(): Promise<WatchItem[]> {
    const rows = await this.db.select().from(s.watchlist).orderBy(s.watchlist.symbol);
    const n = (v: string | null) => (v === null ? null : Number(v));
    return rows.map((r) => ({
      symbol: r.symbol, note: r.note, addedAt: r.addedAt.toISOString(),
      entryPrice: n(r.entryPrice), entryAction: r.entryAction, targetPrice: n(r.targetPrice), stopLoss: n(r.stopLoss), thesis: r.thesis, horizonDays: r.horizonDays,
      status: r.status as WatchItem["status"], lastPrice: n(r.lastPrice), lastReturn: n(r.lastReturn), lastEvaluatedAt: r.lastEvaluatedAt?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null, resolutionPrice: n(r.resolutionPrice), resolutionReturn: n(r.resolutionReturn),
    }));
  }
  async addWatch(symbol: string, snap: WatchSnapshot | null = null): Promise<void> {
    const ns = (v: number | null | undefined) => (v === null || v === undefined ? null : str(v));
    await this.db.insert(s.watchlist).values({ symbol: symbol.toUpperCase(), note: snap?.note ?? null, entryPrice: ns(snap?.entryPrice), entryAction: snap?.entryAction ?? null, targetPrice: ns(snap?.targetPrice), stopLoss: ns(snap?.stopLoss), thesis: snap?.thesis ?? null, horizonDays: snap?.horizonDays ?? 30 }).onConflictDoNothing();
  }
  async setWatchEntry(symbol: string, entryPrice: number): Promise<void> {
    await this.db.update(s.watchlist).set({ entryPrice: str(entryPrice) }).where(eq(s.watchlist.symbol, symbol.toUpperCase()));
  }
  async updateWatchEval(symbol: string, e: WatchEval): Promise<void> {
    await this.db.update(s.watchlist).set({ status: e.status, lastPrice: str(e.lastPrice), lastReturn: str(e.lastReturn), lastEvaluatedAt: new Date(e.lastEvaluatedAt), resolvedAt: e.resolvedAt ? new Date(e.resolvedAt) : null, resolutionPrice: e.resolutionPrice === null ? null : str(e.resolutionPrice), resolutionReturn: e.resolutionReturn === null ? null : str(e.resolutionReturn) }).where(eq(s.watchlist.symbol, symbol.toUpperCase()));
  }
  async removeWatch(symbol: string): Promise<void> {
    await this.db.delete(s.watchlist).where(eq(s.watchlist.symbol, symbol.toUpperCase()));
  }

  // ---------- registro de uso de fuentes externas ----------
  async insertCalls(rows: UsageCall[]): Promise<void> {
    if (!rows.length) return;
    await this.db
      .insert(s.externalCalls)
      .values(rows.map((r) => ({ id: r.id, at: new Date(r.at), source: r.source, step: r.step, purpose: r.purpose, symbol: r.symbol, endpoint: r.endpoint, model: r.model, keyIndex: r.keyIndex, status: r.status, result: r.result, tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensThink: r.tokensThink, ms: r.ms })))
      .onConflictDoNothing();
  }
  async setCallResult(id: string, result: UsageResult): Promise<void> {
    await this.db.update(s.externalCalls).set({ result }).where(eq(s.externalCalls.id, id));
  }
  /** Llamadas con `from <= at < to` (ISO), en orden. */
  async callsBetween(fromIso: string, toIso: string): Promise<UsageCall[]> {
    const rows = await this.db.select().from(s.externalCalls).where(and(gte(s.externalCalls.at, new Date(fromIso)), lt(s.externalCalls.at, new Date(toIso)))).orderBy(s.externalCalls.at);
    return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), source: r.source as UsageCall["source"], step: r.step, purpose: r.purpose, symbol: r.symbol, endpoint: r.endpoint, model: r.model, keyIndex: r.keyIndex, status: r.status, result: r.result as UsageResult, tokensIn: r.tokensIn, tokensOut: r.tokensOut, tokensThink: r.tokensThink, ms: r.ms }));
  }
  /** Retención: borra lo anterior a `iso`. Devuelve cuántas filas se fueron. */
  async deleteCallsBefore(iso: string): Promise<number> {
    const gone = await this.db.delete(s.externalCalls).where(lt(s.externalCalls.at, new Date(iso))).returning({ id: s.externalCalls.id });
    return gone.length;
  }

  // ---------- pasos programados ----------
  async markJobRun(step: string, lastDate: string, detail: string | null = null): Promise<void> {
    const ranAt = new Date();
    await this.db.insert(s.jobRuns).values({ step, lastDate, ranAt, detail, lastError: null, lastErrorAt: null }).onConflictDoUpdate({ target: s.jobRuns.step, set: { lastDate, ranAt, detail, lastError: null, lastErrorAt: null } });
  }
  async markJobError(step: string, error: string): Promise<void> {
    const at = new Date();
    // Sin corrida buena previa, la fila nace con lastDate vacío: el paso sigue pendiente.
    await this.db.insert(s.jobRuns).values({ step, lastDate: "", ranAt: at, detail: null, lastError: error, lastErrorAt: at }).onConflictDoUpdate({ target: s.jobRuns.step, set: { lastError: error, lastErrorAt: at } });
  }
  async jobRuns(): Promise<Record<string, { lastDate: string; ranAt: string; detail: string | null; lastError: string | null; lastErrorAt: string | null }>> {
    const rows = await this.db.select().from(s.jobRuns);
    return Object.fromEntries(rows.map((r) => [r.step, { lastDate: r.lastDate, ranAt: r.ranAt.toISOString(), detail: r.detail, lastError: r.lastError, lastErrorAt: r.lastErrorAt?.toISOString() ?? null }]));
  }
}

function toRawEvent(r: typeof s.rawEvents.$inferSelect): RawEvent {
  return { id: r.id, ticker: r.ticker, eventType: r.eventType, source: r.source, eventDate: r.eventDate, sourceRef: r.sourceRef, title: r.title, payload: (r.payload as Record<string, unknown>) ?? {}, observedAt: r.observedAt.toISOString() };
}
function toThesis(r: typeof s.theses.$inferSelect): Thesis {
  return {
    id: r.id,
    rawEventId: r.rawEventId,
    pMarketFromOptions: r.pMarketFromOptions,
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
