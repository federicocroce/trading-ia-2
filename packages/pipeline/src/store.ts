import type { Order, Outcome, Position, RawEvent, RiskReport, SymbolProfile, Thesis, ThesisProposal, Transaction, VerdictRow } from "@thesis/core";
import { computeEdge } from "@thesis/core";
import { randomUUID } from "node:crypto";

/**
 * Lo que el pipeline necesita de la persistencia. `@thesis/db`'s Repo lo implementa;
 * MemoryStore sirve para tests y smoke sin Postgres.
 */
export interface Store {
  insertRawEvents(events: RawEvent[]): Promise<RawEvent[]>;
  markFilter(results: Array<{ id: string; passed: boolean; reason: string | null }>): Promise<void>;
  unfilteredEvents(limit?: number): Promise<RawEvent[]>;
  rawEvent(id: string): Promise<RawEvent | null>;
  ensurePromptVersion(version: string, content: string, notes?: string): Promise<void>;
  insertThesis(rawEventId: string, p: ThesisProposal, promptVersion: string, minEdge: number): Promise<Thesis>;
  thesis(id: string): Promise<Thesis | null>;
  thesesByStatus(status: Thesis["status"] | Thesis["status"][], limit?: number): Promise<Thesis[]>;
  setThesisStatus(id: string, status: Thesis["status"], extra?: { rejectionReason?: Thesis["rejectionReason"]; humanDecision?: string }): Promise<void>;
  comparables(eventType: Thesis["eventType"], limit?: number): Promise<Array<{ thesis: Thesis; outcome: Outcome }>>;
  insertOrder(o: Order): Promise<void>;
  updateOrder(o: Order): Promise<void>;
  ordersForThesis(thesisId: string): Promise<Order[]>;
  openOrders(): Promise<Order[]>;
  insertOutcome(o: Outcome): Promise<void>;
  allOutcomesWithTheses(): Promise<Array<{ thesis: Thesis; outcome: Outcome }>>;
}

/** Lo que la cartera real necesita de la persistencia (spec etapa 1 §3.1). Repo lo implementa junto con Store. */
export interface CarteraStore {
  positions(): Promise<Position[]>;
  upsertPosition(p: Position): Promise<void>;
  deletePosition(symbol: string): Promise<void>;
  transactions(): Promise<Transaction[]>;
  insertTransactions(t: Transaction[]): Promise<number>;
  profile(symbol: string): Promise<{ profile: SymbolProfile; updatedAt: string } | null>;
  saveProfile(p: SymbolProfile): Promise<void>;
  upsertVerdicts(rows: VerdictRow[]): Promise<void>;
  latestVerdicts(): Promise<VerdictRow[]>;
  verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]>;
  setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void>;
  allVerdicts(): Promise<VerdictRow[]>;
  saveRisk(date: string, report: RiskReport): Promise<void>;
  latestRisk(): Promise<{ date: string; report: RiskReport } | null>;
  recentFilingTitles(ticker: string, limit: number): Promise<string[]>;
  recentNewsTitles(query: string, limit: number): Promise<string[]>;
}

export class MemoryStore implements Store, CarteraStore {
  positionsMap = new Map<string, Position>();
  txs = new Map<string, Transaction>();
  profiles = new Map<string, { profile: SymbolProfile; updatedAt: string }>();
  verdicts = new Map<string, VerdictRow>();
  risks = new Map<string, RiskReport>();
  events = new Map<string, RawEvent & { filterPassed: boolean | null; filterReason: string | null }>();
  theses = new Map<string, Thesis>();
  orders = new Map<string, Order>();
  outcomes = new Map<string, Outcome>();
  prompts = new Map<string, string>();
  private keys = new Set<string>();

  async insertRawEvents(events: RawEvent[]) {
    const fresh: RawEvent[] = [];
    for (const e of events) {
      const k = `${e.ticker}|${e.eventType}|${e.eventDate}|${e.sourceRef}`;
      if (this.keys.has(k)) continue;
      this.keys.add(k);
      this.events.set(e.id, { ...e, filterPassed: null, filterReason: null });
      fresh.push(e);
    }
    return fresh;
  }
  async markFilter(results: Array<{ id: string; passed: boolean; reason: string | null }>) {
    for (const r of results) {
      const e = this.events.get(r.id);
      if (e) Object.assign(e, { filterPassed: r.passed, filterReason: r.reason });
    }
  }
  async unfilteredEvents(limit = 500) {
    return [...this.events.values()].filter((e) => e.filterPassed === null).slice(0, limit);
  }
  async rawEvent(id: string) {
    return this.events.get(id) ?? null;
  }
  async ensurePromptVersion(version: string, content: string) {
    this.prompts.set(version, content);
  }
  async insertThesis(rawEventId: string, p: ThesisProposal, promptVersion: string, minEdge: number) {
    const edge = computeEdge(p);
    const now = new Date().toISOString();
    const t: Thesis = {
      ...p,
      id: randomUUID(),
      rawEventId,
      edge,
      status: edge >= minEdge ? "proposed" : "rejected",
      rejectionReason: edge >= minEdge ? null : "edge_below_threshold",
      promptVersion,
      createdAt: now,
      updatedAt: now,
    };
    this.theses.set(t.id, t);
    return t;
  }
  async thesis(id: string) {
    return this.theses.get(id) ?? null;
  }
  async thesesByStatus(status: Thesis["status"] | Thesis["status"][], limit = 200) {
    const list = Array.isArray(status) ? status : [status];
    return [...this.theses.values()].filter((t) => list.includes(t.status)).slice(0, limit);
  }
  async setThesisStatus(id: string, status: Thesis["status"], extra: { rejectionReason?: Thesis["rejectionReason"]; humanDecision?: string } = {}) {
    const t = this.theses.get(id);
    if (!t) return;
    t.status = status;
    if (extra.rejectionReason !== undefined) t.rejectionReason = extra.rejectionReason;
    t.updatedAt = new Date().toISOString();
  }
  async comparables(eventType: Thesis["eventType"], limit = 30) {
    return (await this.allOutcomesWithTheses()).filter((x) => x.thesis.eventType === eventType).slice(0, limit);
  }
  async insertOrder(o: Order) {
    this.orders.set(o.id, o);
  }
  async updateOrder(o: Order) {
    this.orders.set(o.id, o);
  }
  async ordersForThesis(thesisId: string) {
    return [...this.orders.values()].filter((o) => o.thesisId === thesisId);
  }
  async openOrders() {
    return [...this.orders.values()].filter((o) => ["pending", "submitted", "partially_filled"].includes(o.status));
  }
  async insertOutcome(o: Outcome) {
    this.outcomes.set(o.thesisId, o);
  }
  async allOutcomesWithTheses() {
    return [...this.outcomes.values()].map((outcome) => ({ outcome, thesis: this.theses.get(outcome.thesisId)! })).filter((x) => x.thesis);
  }

  // ---------- cartera ----------
  async positions() {
    return [...this.positionsMap.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  async upsertPosition(p: Position) {
    this.positionsMap.set(p.symbol.toUpperCase(), { ...p, symbol: p.symbol.toUpperCase() });
  }
  async deletePosition(symbol: string) {
    this.positionsMap.delete(symbol.toUpperCase());
  }
  async transactions() {
    return [...this.txs.values()].sort((a, b) => b.date.localeCompare(a.date));
  }
  async insertTransactions(t: Transaction[]) {
    let n = 0;
    for (const tx of t) {
      const key = tx.externalId ?? `${tx.date}|${tx.symbol.toUpperCase()}|${tx.type}|${tx.quantity}|${tx.price}`;
      if ([...this.txs.values()].some((x) => (x.externalId ?? `${x.date}|${x.symbol}|${x.type}|${x.quantity}|${x.price}`) === key)) continue;
      this.txs.set(tx.id, { ...tx, symbol: tx.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async profile(symbol: string) {
    return this.profiles.get(symbol.toUpperCase()) ?? null;
  }
  async saveProfile(p: SymbolProfile) {
    this.profiles.set(p.symbol.toUpperCase(), { profile: p, updatedAt: new Date().toISOString() });
  }
  async upsertVerdicts(rows: VerdictRow[]) {
    for (const r of rows) {
      const k = `${r.verdictDate}|${r.symbol}`;
      const prev = this.verdicts.get(k);
      this.verdicts.set(k, prev ? { ...r, close7d: prev.close7d, spy7d: prev.spy7d, alpha7dPct: prev.alpha7dPct, close30d: prev.close30d, spy30d: prev.spy30d, alpha30dPct: prev.alpha30dPct, measuredAt: prev.measuredAt } : r);
    }
  }
  async latestVerdicts() {
    const all = [...this.verdicts.values()];
    const last = all.map((v) => v.verdictDate).sort().at(-1);
    return all.filter((v) => v.verdictDate === last).sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  async verdictsToMeasure(before: string, horizon: 7 | 30) {
    return [...this.verdicts.values()].filter((v) => v.verdictDate <= before && (horizon === 7 ? v.close7d : v.close30d) === null);
  }
  async setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>) {
    const k = `${verdictDate}|${symbol}`;
    const v = this.verdicts.get(k);
    if (v) this.verdicts.set(k, { ...v, ...m, measuredAt: new Date().toISOString() });
  }
  async allVerdicts() {
    return [...this.verdicts.values()].sort((a, b) => b.verdictDate.localeCompare(a.verdictDate) || a.symbol.localeCompare(b.symbol));
  }
  async saveRisk(date: string, report: RiskReport) {
    this.risks.set(date, report);
  }
  async latestRisk() {
    const date = [...this.risks.keys()].sort().at(-1);
    return date ? { date, report: this.risks.get(date)! } : null;
  }
  async recentFilingTitles(ticker: string, limit: number) {
    return [...this.events.values()].filter((e) => e.ticker === ticker.toUpperCase() && e.source === "edgar").sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, limit).map((e) => e.title);
  }
  async recentNewsTitles(query: string, limit: number) {
    const q = query.toLowerCase();
    return [...this.events.values()].filter((e) => e.source === "ar_official" && e.title.toLowerCase().includes(q)).sort((a, b) => b.observedAt.localeCompare(a.observedAt)).slice(0, limit).map((e) => e.title);
  }
}
