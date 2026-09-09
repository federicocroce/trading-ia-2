import { boolean, index, integer, jsonb, numeric, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, date } from "drizzle-orm/pg-core";

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

/** Cartera real del dueño (spec etapa 1: docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md). */
export const marketEnum = pgEnum("market", ["us", "adr", "ar"]);
export const layerEnum = pgEnum("layer", ["riesgo", "nucleo", "cobertura"]);
export const verbEnum = pgEnum("verb", ["VENDER", "REVISAR", "MANTENER", "SUMAR"]);
export const txTypeEnum = pgEnum("tx_type", ["BUY", "SELL", "DIVIDEND", "TRANSFER"]);

export const positions = pgTable("positions", {
  symbol: text("symbol").primaryKey(),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  avgCost: numeric("avg_cost", { precision: 14, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  market: marketEnum("market").notNull(),
  layer: layerEnum("layer").notNull().default("riesgo"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    type: txTypeEnum("type").notNull(),
    quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
    price: numeric("price", { precision: 14, scale: 4 }).notNull(),
    fees: numeric("fees", { precision: 14, scale: 4 }).notNull().default("0"),
    date: date("date").notNull(),
    currency: text("currency").notNull().default("USD"),
    platform: text("platform"),
    externalId: text("external_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("transactions_dedupe").on(t.date, t.symbol, t.type, t.quantity, t.price), uniqueIndex("transactions_external").on(t.externalId)],
);

export const symbolMeta = pgTable("symbol_meta", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  country: text("country"),
  industry: text("industry"),
  marketCap: numeric("market_cap", { precision: 20, scale: 0 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // Etapa 2: perfil ampliado y taxonomía.
  currency: text("currency"),
  shareOutstanding: numeric("share_outstanding", { precision: 18, scale: 4 }),
  assetClass: text("asset_class"),
  sector: text("sector"),
  exposure: text("exposure"),
  role: text("role"),
  themes: jsonb("themes").notNull().default([]),
  themesSource: text("themes_source"),
  // Página por ticker: descripción de Yahoo (cache).
  longName: text("long_name"),
  summary: text("summary"),
  employees: integer("employees"),
  website: text("website"),
  exchangeName: text("exchange_name"),
  firstTradeDate: date("first_trade_date"),
  descriptionUpdatedAt: timestamp("description_updated_at", { withTimezone: true }),
});

/** Velas diarias persistidas por el pipeline (Cartera y Radar); la página por ticker lee de acá. */
export const candlesDaily = pgTable(
  "candles_daily",
  {
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    open: numeric("open", { precision: 14, scale: 4 }).notNull(),
    high: numeric("high", { precision: 14, scale: 4 }).notNull(),
    low: numeric("low", { precision: 14, scale: 4 }).notNull(),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
    volume: numeric("volume", { precision: 18, scale: 0 }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.symbol, t.date] })],
);

/** Noticias de empresa (Finnhub), únicas por símbolo+url. */
export const news = pgTable(
  "news",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    headline: text("headline").notNull(),
    source: text("source"),
    url: text("url").notNull(),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_symbol_url").on(t.symbol, t.url), index("news_symbol_date").on(t.symbol, t.date)],
);

/** Radar (spec etapa 2 §11). */
export const fundamentals = pgTable("fundamentals", {
  symbol: text("symbol").primaryKey(),
  asOf: date("as_of").notNull(),
  metrics: jsonb("metrics").notNull(),
  peers: jsonb("peers").notNull().default([]),
  industry: text("industry"),
  mcapUsd: numeric("mcap_usd", { precision: 20, scale: 0 }),
  dollarVolumeUsd: numeric("dollar_volume_usd", { precision: 20, scale: 0 }).notNull(),
  priceUsd: numeric("price_usd", { precision: 14, scale: 4 }).notNull(),
  nextEarnings: date("next_earnings"),
  insiderBuys90d: integer("insider_buys_90d"),
  insiderSells90d: integer("insider_sells_90d"),
  analyst: jsonb("analyst"),
  earningsSurprises: jsonb("earnings_surprises"),
  metricsRaw: jsonb("metrics_raw"),
  statementsAsOf: date("statements_as_of"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
/** Estados trimestrales de la SEC y ganancia núcleo (spec verificación §4). */
export const statements = pgTable("statements", {
  symbol: text("symbol").primaryKey(),
  cik: text("cik"),
  asOf: date("as_of").notNull(),
  quarters: jsonb("quarters").notNull().default([]),
  core: jsonb("core"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const universeScan = pgTable(
  "universe_scan",
  {
    scanDate: date("scan_date").notNull(),
    symbol: text("symbol").notNull(),
    stage: text("stage").notNull(),
    reason: text("reason"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.scanDate, t.symbol] }), index("universe_scan_stage").on(t.scanDate, t.stage)],
);
export const radarCandidates = pgTable(
  "radar_candidates",
  {
    candidateDate: date("candidate_date").notNull(),
    symbol: text("symbol").notNull(),
    kind: text("kind").notNull(),
    verdict: text("verdict").notNull(),
    score: numeric("score", { precision: 10, scale: 4 }),
    axes: jsonb("axes").notNull().default({}),
    peerGroup: jsonb("peer_group").notNull().default([]),
    rankInGroup: integer("rank_in_group"),
    groupSize: integer("group_size"),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
    entryLow: numeric("entry_low", { precision: 14, scale: 4 }),
    entryHigh: numeric("entry_high", { precision: 14, scale: 4 }),
    stop: numeric("stop", { precision: 14, scale: 4 }),
    target: numeric("target", { precision: 14, scale: 4 }),
    sizeUsd: numeric("size_usd", { precision: 14, scale: 2 }),
    sizeQty: integer("size_qty"),
    riskScore: integer("risk_score"),
    flags: jsonb("flags").notNull().default([]),
    nthAppearance: integer("nth_appearance").notNull().default(1),
    summary: text("summary"),
    whyRanks: text("why_ranks"),
    mainRisk: text("main_risk"),
    moat: text("moat"),
    degradedBy: text("degraded_by"),
    promptVersion: text("prompt_version"),
    spyClose: numeric("spy_close", { precision: 14, scale: 4 }),
    events: jsonb("events").notNull().default([]),
    analystTargets: jsonb("analyst_targets"),
    close7d: numeric("close_7d", { precision: 14, scale: 4 }),
    spy7d: numeric("spy_7d", { precision: 14, scale: 4 }),
    alpha7dPct: numeric("alpha_7d_pct", { precision: 10, scale: 4 }),
    close30d: numeric("close_30d", { precision: 14, scale: 4 }),
    spy30d: numeric("spy_30d", { precision: 14, scale: 4 }),
    alpha30dPct: numeric("alpha_30d_pct", { precision: 10, scale: 4 }),
    close90d: numeric("close_90d", { precision: 14, scale: 4 }),
    spy90d: numeric("spy_90d", { precision: 14, scale: 4 }),
    alpha90dPct: numeric("alpha_90d_pct", { precision: 10, scale: 4 }),
    measuredAt: timestamp("measured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.candidateDate, t.symbol] })],
);
export const contributionPlans = pgTable("contribution_plans", {
  planMonth: text("plan_month").primaryKey(),
  totalUsd: numeric("total_usd", { precision: 14, scale: 2 }).notNull(),
  lines: jsonb("lines").notNull().default([]),
  notes: jsonb("notes").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
/** Eventos materiales detectados en noticias (spec verificación §5). Único por símbolo + URL; los `ruido` también se guardan. */
export const radarEvents = pgTable(
  "radar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    headline: text("headline").notNull(),
    url: text("url").notNull(),
    source: text("source"),
    why: text("why"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    promptVersion: text("prompt_version"),
  },
  (t) => [uniqueIndex("radar_events_symbol_url").on(t.symbol, t.url), index("radar_events_symbol_date").on(t.symbol, t.date)],
);
/** Acciones de analistas extraídas de titulares (spec verificación §6). */
export const analystActions = pgTable(
  "analyst_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    firm: text("firm").notNull(),
    action: text("action").notNull(),
    rating: text("rating"),
    target: numeric("target", { precision: 14, scale: 2 }),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("analyst_actions_symbol_url").on(t.symbol, t.url), index("analyst_actions_symbol_date").on(t.symbol, t.date)],
);
/** Hasta qué fecha se leyeron las noticias de cada símbolo. */
export const radarNewsScans = pgTable("radar_news_scans", {
  symbol: text("symbol").primaryKey(),
  scannedTo: date("scanned_to").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const portfolioVerdicts = pgTable(
  "portfolio_verdicts",
  {
    verdictDate: date("verdict_date").notNull(),
    symbol: text("symbol").notNull(),
    verb: verbEnum("verb").notNull(),
    reason: text("reason").notNull(),
    narrative: text("narrative"),
    warning: text("warning"),
    close: numeric("close", { precision: 14, scale: 4 }).notNull(),
    spot: numeric("spot", { precision: 14, scale: 4 }),
    stop: numeric("stop", { precision: 14, scale: 4 }),
    target: numeric("target", { precision: 14, scale: 4 }),
    gainPct: numeric("gain_pct", { precision: 10, scale: 4 }).notNull(),
    weightPct: numeric("weight_pct", { precision: 8, scale: 4 }).notNull(),
    spyClose: numeric("spy_close", { precision: 14, scale: 4 }),
    degradedBy: text("degraded_by"),
    promptVersion: text("prompt_version"),
    close7d: numeric("close_7d", { precision: 14, scale: 4 }),
    spy7d: numeric("spy_7d", { precision: 14, scale: 4 }),
    alpha7dPct: numeric("alpha_7d_pct", { precision: 10, scale: 4 }),
    close30d: numeric("close_30d", { precision: 14, scale: 4 }),
    spy30d: numeric("spy_30d", { precision: 14, scale: 4 }),
    alpha30dPct: numeric("alpha_30d_pct", { precision: 10, scale: 4 }),
    measuredAt: timestamp("measured_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.verdictDate, t.symbol] })],
);

export const portfolioRisk = pgTable("portfolio_risk", {
  snapshotDate: date("snapshot_date").primaryKey(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Etapa 3: contexto macro argentino por día (dólares, brecha, riesgo país, Merval). */
export const macroArDaily = pgTable("macro_ar_daily", {
  date: date("date").primaryKey(),
  oficial: numeric("oficial", { precision: 14, scale: 4 }),
  mep: numeric("mep", { precision: 14, scale: 4 }),
  ccl: numeric("ccl", { precision: 14, scale: 4 }),
  blue: numeric("blue", { precision: 14, scale: 4 }),
  mayorista: numeric("mayorista", { precision: 14, scale: 4 }),
  brechaPct: numeric("brecha_pct", { precision: 10, scale: 4 }),
  riesgoPais: integer("riesgo_pais"),
  merval: numeric("merval", { precision: 18, scale: 4 }),
  mervalUsd: numeric("merval_usd", { precision: 14, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Última corrida registrada de cada paso programado (para ponerse al día tras un apagado). */
export const jobRuns = pgTable("job_runs", {
  step: text("step").primaryKey(),
  lastDate: text("last_date").notNull(),
  ranAt: timestamp("ran_at", { withTimezone: true }).notNull().defaultNow(),
  detail: text("detail"),
});

/** Lista de seguimiento: tickers elegidos a mano (veredicto diario aunque el ranking no los elija). */
export const watchlist = pgTable("watchlist", {
  symbol: text("symbol").primaryKey(),
  note: text("note"),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  // Foto del alta (habilita el ciclo de vida, portado de v1).
  entryPrice: numeric("entry_price", { precision: 14, scale: 4 }),
  entryAction: text("entry_action"),
  targetPrice: numeric("target_price", { precision: 14, scale: 4 }),
  stopLoss: numeric("stop_loss", { precision: 14, scale: 4 }),
  thesis: text("thesis"),
  horizonDays: integer("horizon_days").notNull().default(30),
  // Estado del ciclo de vida: live | triggered | invalidated | expired.
  status: text("status").notNull().default("live"),
  lastPrice: numeric("last_price", { precision: 14, scale: 4 }),
  lastReturn: numeric("last_return", { precision: 10, scale: 4 }),
  lastEvaluatedAt: timestamp("last_evaluated_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolutionPrice: numeric("resolution_price", { precision: 14, scale: 4 }),
  resolutionReturn: numeric("resolution_return", { precision: 10, scale: 4 }),
});
