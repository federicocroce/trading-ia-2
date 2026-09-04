import type { Order, Outcome, RawEvent, Thesis, ThesisProposal } from "@thesis/core";
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

export class MemoryStore implements Store {
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
}
