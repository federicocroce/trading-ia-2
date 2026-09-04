import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core";

/** Enums espejo de @thesis/core. Si cambian ahí, cambian acá (test de paridad en schema.test.ts). */
export const eventTypeEnum = pgEnum("event_type", ["fda", "earnings", "legal", "macro_ar", "operational"]);
export const eventSourceEnum = pgEnum("event_source", ["edgar", "fda", "earnings_calendar", "alpaca_market", "courtlistener", "news", "ar_official", "manual"]);
export const directionEnum = pgEnum("direction", ["long", "short"]);
export const instrumentEnum = pgEnum("instrument", ["stock", "call", "put"]);
export const confidenceEnum = pgEnum("confidence", ["low", "med", "high"]);
export const thesisStatusEnum = pgEnum("thesis_status", ["proposed", "rejected", "approved", "open", "closed"]);
export const rejectionReasonEnum = pgEnum("rejection_reason", ["edge_below_threshold", "risk_rule", "human"]);
export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "submitted", "filled", "partially_filled", "cancelled", "rejected"]);
export const closeReasonEnum = pgEnum("close_reason", ["event_resolved", "invalidation", "target", "risk_stop", "manual"]);

/** §3.6 raw_events — todo lo ingerido, aunque se descarte. */
export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    eventType: eventTypeEnum("event_type").notNull(),
    source: eventSourceEnum("source").notNull(),
    eventDate: date("event_date"),
    sourceRef: text("source_ref").notNull(),
    title: text("title").notNull(),
    payload: jsonb("payload").notNull().default({}),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    /** Resultado del filtro: null = no evaluado aún. */
    filterPassed: boolean("filter_passed"),
    filterReason: text("filter_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("raw_events_dedupe").on(t.ticker, t.eventType, t.eventDate, t.sourceRef),
    index("raw_events_event_date").on(t.eventDate),
  ],
);

/** Versiones de prompt, para atribuir mejoras (§8 overfitting). */
export const promptVersions = pgTable("prompt_versions", {
  version: text("version").primaryKey(),
  hash: text("hash").notNull(),
  content: text("content").notNull(),
  notes: text("notes").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** §3.3 theses — propuesta del reasoner + ciclo de vida. */
export const theses = pgTable(
  "theses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rawEventId: uuid("raw_event_id").notNull().references(() => rawEvents.id),
    ticker: text("ticker").notNull(),
    eventType: eventTypeEnum("event_type").notNull(),
    eventDate: date("event_date"),
    direction: directionEnum("direction").notNull(),
    pEstimate: numeric("p_estimate", { precision: 5, scale: 4 }).notNull(),
    pMarket: numeric("p_market", { precision: 5, scale: 4 }).notNull(),
    edge: numeric("edge", { precision: 6, scale: 4 }).notNull(),
    instrument: instrumentEnum("instrument").notNull(),
    entryMax: numeric("entry_max", { precision: 12, scale: 4 }).notNull(),
    target: numeric("target", { precision: 12, scale: 4 }).notNull(),
    invalidation: text("invalidation").notNull(),
    confidence: confidenceEnum("confidence").notNull(),
    reasoning: text("reasoning").notNull(),
    sources: jsonb("sources").$type<string[]>().notNull(),
    status: thesisStatusEnum("status").notNull().default("proposed"),
    rejectionReason: rejectionReasonEnum("rejection_reason"),
    /** Decisión humana registrada aparte del estado, para medir si el criterio humano suma (§4). */
    humanDecision: text("human_decision"),
    humanDecidedAt: timestamp("human_decided_at", { withTimezone: true }),
    promptVersion: text("prompt_version").notNull().references(() => promptVersions.version),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("theses_status").on(t.status), index("theses_event_type").on(t.eventType)],
);

/** §3.5 orders — cada orden enlazada a una tesis. */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    thesisId: uuid("thesis_id").notNull().references(() => theses.id),
    ticker: text("ticker").notNull(),
    instrument: instrumentEnum("instrument").notNull(),
    symbol: text("symbol").notNull(),
    side: orderSideEnum("side").notNull(),
    qty: integer("qty").notNull(),
    limitPrice: numeric("limit_price", { precision: 12, scale: 4 }).notNull(),
    notionalUsd: numeric("notional_usd", { precision: 14, scale: 2 }).notNull(),
    brokerOrderId: text("broker_order_id"),
    status: orderStatusEnum("status").notNull().default("pending"),
    filledQty: integer("filled_qty").notNull().default(0),
    avgFillPrice: numeric("avg_fill_price", { precision: 12, scale: 4 }),
    paper: boolean("paper").notNull().default(true),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    filledAt: timestamp("filled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_thesis").on(t.thesisId)],
);

/** §3.6 outcomes — resultado real, fuente de la calibración. */
export const outcomes = pgTable("outcomes", {
  thesisId: uuid("thesis_id").primaryKey().references(() => theses.id),
  predictedOutcomeHappened: boolean("predicted_outcome_happened").notNull(),
  pnlUsd: numeric("pnl_usd", { precision: 14, scale: 2 }).notNull(),
  pnlPct: numeric("pnl_pct", { precision: 8, scale: 4 }).notNull(),
  closeReason: closeReasonEnum("close_reason").notNull(),
  closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
  notes: text("notes").notNull().default(""),
});
