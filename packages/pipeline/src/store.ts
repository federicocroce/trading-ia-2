import type { AnalystAction, Candle, CandidateRow, CandidateVerification, ContributionPlan, PreTradeReview, Fundamentals, HechoExterno, HechoTipo, NewsItem, Order, Outcome, PlanLine, Position, RadarEvent, RawEvent, RiskReport, ScanStage, Statements, SymbolDescription, SymbolProfile, Tags, Thesis, ThesisProposal, Transaction, UsageCall, UsageResult, VerdictRow, MacroAr, WatchEval, WatchItem, WatchSnapshot } from "@thesis/core";
import { computeEdge, familyOf } from "@thesis/core";
import { randomUUID } from "node:crypto";

/**
 * Lo que el pipeline necesita de la persistencia. `@thesis/db`'s Repo lo implementa;
 * MemoryStore sirve para tests y smoke sin Postgres.
 */
export interface Store {
  insertRawEvents(events: RawEvent[]): Promise<RawEvent[]>;
  /** Cuáles de estas referencias de una fuente ya están guardadas. Para no volver a bajar lo que ya se vio. */
  knownSourceRefs(source: RawEvent["source"], refs: string[]): Promise<Set<string>>;
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
  thesesForTicker(ticker: string, limit?: number): Promise<Thesis[]>;
  /** Registro de uso de fuentes externas (una fila por pedido saliente). Lo escribe el registrador por lotes. */
  insertCalls(rows: UsageCall[]): Promise<void>;
  setCallResult(id: string, result: UsageResult): Promise<void>;
  /** `from <= at < to`, ISO, en orden. */
  callsBetween(fromIso: string, toIso: string): Promise<UsageCall[]>;
  /** Retención: borra lo anterior a `iso`; devuelve cuántas filas se fueron. */
  deleteCallsBefore(iso: string): Promise<number>;
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
  /** Histórico: veredictos de una fecha exacta y panel de riesgo vigente a esa fecha (el último ≤ fecha). */
  verdictsForDate(date: string): Promise<VerdictRow[]>;
  riskForDate(date: string): Promise<{ date: string; report: RiskReport } | null>;
  verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]>;
  setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void>;
  allVerdicts(): Promise<VerdictRow[]>;
  saveRisk(date: string, report: RiskReport): Promise<void>;
  latestRisk(): Promise<{ date: string; report: RiskReport } | null>;
  recentFilingTitles(ticker: string, limit: number): Promise<string[]>;
  recentNewsTitles(query: string, limit: number): Promise<string[]>;
  /** Etiquetas por símbolo (etapa 2), para concentración por sector y tema. */
  allTags(): Promise<Record<string, Tags>>;
  /** Velas diarias persistidas (la página por ticker lee de acá). */
  upsertCandles(symbol: string, candles: Candle[]): Promise<void>;
}

/** Lo que la página por ticker necesita además (etapa 2b). */
export interface TickerStore {
  description(symbol: string): Promise<SymbolDescription | null>;
  saveDescription(d: SymbolDescription): Promise<void>;
  upsertCandles(symbol: string, candles: Candle[]): Promise<void>;
  candles(symbol: string, fromDate: string): Promise<Candle[]>;
  upsertNews(items: NewsItem[]): Promise<number>;
  news(symbol: string, limit?: number): Promise<NewsItem[]>;
}

/** Lo que el Radar necesita de la persistencia (spec etapa 2 §11). */
export interface RadarStore {
  tags(symbol: string): Promise<Tags | null>;
  saveTags(symbol: string, t: Tags): Promise<void>;
  allTags(): Promise<Record<string, Tags>>;
  saveFundamentals(f: Fundamentals): Promise<void>;
  fundamentals(symbol: string): Promise<Fundamentals | null>;
  freshFundamentals(maxAgeDays: number, today: string): Promise<Fundamentals[]>;
  /** Estados trimestrales de la SEC con la ganancia núcleo (spec verificación §4). `quarters: []` = se intentó y no hay. */
  statements(symbol: string): Promise<Statements | null>;
  saveStatements(s: Statements): Promise<void>;
  /** Eventos materiales y analistas desde noticias (spec verificación §5 y §6); `radar_news_scans` guarda hasta qué fecha se leyó cada símbolo. */
  upsertEvents(events: RadarEvent[]): Promise<number>;
  eventsFor(symbol: string, since: string): Promise<RadarEvent[]>;
  /** Verificación web por candidata (spec 2026-09-10): la última por símbolo. */
  saveVerification(v: CandidateVerification): Promise<void>;
  verification(symbol: string): Promise<CandidateVerification | null>;
  /** Hechos externos (17/9): la única tabla que escribe el importador. `hechos` = por símbolo desde una fecha, más recientes primero. */
  saveHechos(rows: HechoExterno[]): Promise<number>;
  hechos(symbol: string, desde: string): Promise<HechoExterno[]>;
  hechosPorTipo(tipo: HechoTipo, desde: string): Promise<HechoExterno[]>;
  upsertAnalystActions(actions: AnalystAction[]): Promise<number>;
  analystActions(symbol: string, since: string): Promise<AnalystAction[]>;
  newsScannedTo(symbol: string): Promise<string | null>;
  setNewsScannedTo(symbol: string, date: string): Promise<void>;
  scanUpsert(rows: Array<{ scanDate: string; symbol: string; stage: ScanStage; reason: string | null }>): Promise<void>;
  scanPending(scanDate: string): Promise<string[]>;
  scanStatus(scanDate: string): Promise<Record<ScanStage, number>>;
  scanSymbols(scanDate: string, stage: ScanStage): Promise<string[]>;
  latestScanDate(): Promise<string | null>;
  upsertCandidates(rows: CandidateRow[]): Promise<void>;
  /**
   * Borra las filas de esa fecha y esa familia que la corrida NO volvió a escribir. Existe porque un símbolo
   * que pasa a estar excluido deja de escribirse y su fila vieja del mismo día sobrevive: MIRG.BA el 13/9
   * quedó con su fuerza relativa de −92,68% (la del split sin ajustar) después de que el motor empezara a
   * excluirla, y la pantalla la seguía mostrando. Vale para cualquier exclusión, no solo para los splits.
   */
  pruneCandidates(date: string, kind: CandidateRow["kind"], keep: string[]): Promise<number>;
  latestCandidates(): Promise<CandidateRow[]>;
  /** Histórico: por familia, las filas de la última fecha ≤ la pedida. Fechas de corrida disponibles (desc). */
  candidatesForDate(date: string): Promise<CandidateRow[]>;
  runDates(limit?: number): Promise<string[]>;
  macroArForDate(date: string): Promise<MacroAr | null>;
  candidateHistory(symbol: string, weeks: number): Promise<CandidateRow[]>;
  candidatesToMeasure(before: string, horizon: 7 | 30 | 90): Promise<CandidateRow[]>;
  setCandidateMeasurement(date: string, symbol: string, m: Partial<Pick<CandidateRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct" | "close90d" | "spy90d" | "alpha90dPct">>): Promise<void>;
  allCandidates(): Promise<CandidateRow[]>;
  savePlan(p: ContributionPlan): Promise<void>;
  latestPlan(): Promise<ContributionPlan | null>;
  /** Resultado de los controles automáticos sobre el plan del mes (15/9). */
  savePlanControles(month: string, controles: NonNullable<ContributionPlan["controles"]>): Promise<void>;
  /** Revisión antes de comprar (15/9): una por símbolo y por día. */
  savePreTradeReview(r: PreTradeReview): Promise<void>;
  preTradeReviews(date: string): Promise<PreTradeReview[]>;
  plansToMeasure(before: string): Promise<ContributionPlan[]>;
  updatePlanLines(month: string, lines: PlanLine[]): Promise<void>;
  /** Etapa 3: contexto macro argentino, una fila por día. */
  saveMacroAr(m: MacroAr): Promise<void>;
  latestMacroAr(): Promise<MacroAr | null>;
  macroArSeries(days: number): Promise<MacroAr[]>;
  /** Última corrida de cada paso programado (ponerse al día). `lastDate` es la fecha que cubrió, no la hora en que corrió. */
  markJobRun(step: string, lastDate: string, detail?: string | null): Promise<void>;
  /** Registra una falla sin tocar la última corrida buena (el paso sigue pendiente). */
  markJobError(step: string, error: string): Promise<void>;
  jobRuns(): Promise<Record<string, JobRun>>;
  /** Velas diarias guardadas (las escriben Cartera, Radar y la ficha). */
  candles(symbol: string, since: string): Promise<Candle[]>;
  /** Lista de seguimiento: tickers elegidos a mano que reciben veredicto diario aunque el ranking no los elija. */
  watchlist(): Promise<WatchItem[]>;
  /** Alta con la foto del momento (precio, stop, objetivo, tesis): habilita el ciclo de vida. Idempotente por símbolo. */
  addWatch(symbol: string, snapshot?: WatchSnapshot | null): Promise<void>;
  removeWatch(symbol: string): Promise<void>;
  /** Evaluación diaria del ciclo de vida (portado de v1). */
  updateWatchEval(symbol: string, e: WatchEval): Promise<void>;
  /** Fija el precio de alta de un ítem que no lo tenía (alta vieja). */
  setWatchEntry?(symbol: string, entryPrice: number): Promise<void>;
}

export interface JobRun {
  lastDate: string;
  ranAt: string;
  detail: string | null;
  /** Último error del paso (se limpia cuando vuelve a salir bien). */
  lastError?: string | null;
  lastErrorAt?: string | null;
}

export class MemoryStore implements Store, CarteraStore, RadarStore, TickerStore {
  descriptions = new Map<string, SymbolDescription>();
  candlesMap = new Map<string, Map<string, Candle>>();
  newsMap = new Map<string, NewsItem>();
  tagsMap = new Map<string, Tags>();
  fundamentalsMap = new Map<string, Fundamentals>();
  statementsMap = new Map<string, Statements>();
  radarEvents = new Map<string, RadarEvent>();
  analystActs = new Map<string, AnalystAction>();
  newsScans = new Map<string, string>();
  scan = new Map<string, { scanDate: string; symbol: string; stage: ScanStage; reason: string | null }>();
  candidates = new Map<string, CandidateRow>();
  plans = new Map<string, ContributionPlan>();
  positionsMap = new Map<string, Position>();
  txs = new Map<string, Transaction>();
  profiles = new Map<string, { profile: SymbolProfile; updatedAt: string }>();
  verdicts = new Map<string, VerdictRow>();
  risks = new Map<string, RiskReport>();
  macroAr = new Map<string, MacroAr>();
  jobs = new Map<string, JobRun>();
  watch = new Map<string, WatchItem>();
  hechosMap = new Map<string, HechoExterno>();
  events = new Map<string, RawEvent & { filterPassed: boolean | null; filterReason: string | null }>();
  theses = new Map<string, Thesis>();
  orders = new Map<string, Order>();
  outcomes = new Map<string, Outcome>();
  prompts = new Map<string, string>();
  private keys = new Set<string>();

  async knownSourceRefs(source: RawEvent["source"], refs: string[]) {
    const pedidas = new Set(refs);
    return new Set([...this.events.values()].filter((e) => e.source === source && pedidas.has(e.sourceRef)).map((e) => e.sourceRef));
  }
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
  async thesesForTicker(ticker: string, limit = 20) {
    return [...this.theses.values()].filter((t) => t.ticker === ticker.toUpperCase()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  // ---------- página por ticker ----------
  async description(symbol: string) {
    return this.descriptions.get(symbol.toUpperCase()) ?? null;
  }
  async saveDescription(d: SymbolDescription) {
    this.descriptions.set(d.symbol.toUpperCase(), d);
  }
  async upsertCandles(symbol: string, candles: Candle[]) {
    const sym = symbol.toUpperCase();
    const m = this.candlesMap.get(sym) ?? new Map<string, Candle>();
    for (const c of candles) m.set(c.date, c);
    this.candlesMap.set(sym, m);
  }
  async candles(symbol: string, fromDate: string) {
    return [...(this.candlesMap.get(symbol.toUpperCase())?.values() ?? [])].filter((c) => c.date >= fromDate).sort((a, b) => a.date.localeCompare(b.date));
  }
  async upsertNews(items: NewsItem[]) {
    let n = 0;
    for (const i of items) {
      const k = `${i.symbol.toUpperCase()}|${i.url}`;
      if (this.newsMap.has(k)) continue;
      this.newsMap.set(k, { ...i, symbol: i.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async news(symbol: string, limit = 20) {
    return [...this.newsMap.values()].filter((n) => n.symbol === symbol.toUpperCase()).sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
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
  async verdictsForDate(date: string) {
    return (await this.allVerdicts()).filter((v) => v.verdictDate === date);
  }
  async riskForDate(date: string) {
    const d = [...this.risks.keys()].filter((k) => k <= date).sort().at(-1);
    return d ? { date: d, report: this.risks.get(d)! } : null;
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

  // ---------- radar ----------
  async tags(symbol: string) {
    return this.tagsMap.get(symbol.toUpperCase()) ?? null;
  }
  async saveTags(symbol: string, t: Tags) {
    this.tagsMap.set(symbol.toUpperCase(), t);
  }
  async allTags() {
    return Object.fromEntries(this.tagsMap);
  }
  async saveFundamentals(f: Fundamentals) {
    this.fundamentalsMap.set(f.symbol.toUpperCase(), { ...f, symbol: f.symbol.toUpperCase() });
  }
  async fundamentals(symbol: string) {
    return this.fundamentalsMap.get(symbol.toUpperCase()) ?? null;
  }
  async freshFundamentals(maxAgeDays: number, today: string) {
    const since = new Date(Date.parse(today) - maxAgeDays * 86_400_000).toISOString().slice(0, 10);
    return [...this.fundamentalsMap.values()].filter((f) => f.asOf >= since);
  }
  async statements(symbol: string) {
    return this.statementsMap.get(symbol.toUpperCase()) ?? null;
  }
  async saveStatements(s: Statements) {
    this.statementsMap.set(s.symbol.toUpperCase(), { ...s, symbol: s.symbol.toUpperCase() });
  }
  verifications = new Map<string, CandidateVerification>();
  async saveVerification(v: CandidateVerification) {
    this.verifications.set(v.symbol.toUpperCase(), { ...v, symbol: v.symbol.toUpperCase() });
  }
  async verification(symbol: string) {
    return this.verifications.get(symbol.toUpperCase()) ?? null;
  }
  async saveHechos(rows: HechoExterno[]) {
    for (const h of rows) this.hechosMap.set(`${h.symbol.toUpperCase()}|${h.tipo}|${h.fecha}|${h.fuente.url}`, { ...h, symbol: h.symbol.toUpperCase() });
    return rows.length;
  }
  async hechos(symbol: string, desde: string) {
    return [...this.hechosMap.values()].filter((h) => h.symbol === symbol.toUpperCase() && h.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  async hechosPorTipo(tipo: HechoTipo, desde: string) {
    return [...this.hechosMap.values()].filter((h) => h.tipo === tipo && h.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  async upsertEvents(events: RadarEvent[]) {
    let n = 0;
    for (const e of events) {
      const k = `${e.symbol.toUpperCase()}|${e.url}`;
      if (this.radarEvents.has(k)) continue;
      this.radarEvents.set(k, { ...e, symbol: e.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async eventsFor(symbol: string, since: string) {
    return [...this.radarEvents.values()].filter((e) => e.symbol === symbol.toUpperCase() && e.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  }
  async upsertAnalystActions(actions: AnalystAction[]) {
    let n = 0;
    for (const a of actions) {
      const k = `${a.symbol.toUpperCase()}|${a.url}`;
      if (this.analystActs.has(k)) continue;
      this.analystActs.set(k, { ...a, symbol: a.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async analystActions(symbol: string, since: string) {
    return [...this.analystActs.values()].filter((a) => a.symbol === symbol.toUpperCase() && a.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  }
  async newsScannedTo(symbol: string) {
    return this.newsScans.get(symbol.toUpperCase()) ?? null;
  }
  async setNewsScannedTo(symbol: string, date: string) {
    this.newsScans.set(symbol.toUpperCase(), date);
  }
  async scanUpsert(rows: Array<{ scanDate: string; symbol: string; stage: ScanStage; reason: string | null }>) {
    for (const r of rows) this.scan.set(`${r.scanDate}|${r.symbol.toUpperCase()}`, { ...r, symbol: r.symbol.toUpperCase() });
  }
  async scanPending(scanDate: string) {
    return [...this.scan.values()].filter((r) => r.scanDate === scanDate && r.stage === "alpaca_ok").map((r) => r.symbol).sort();
  }
  async scanStatus(scanDate: string) {
    const out: Record<ScanStage, number> = { alpaca_ok: 0, finnhub_ok: 0, excluded: 0, error: 0 };
    for (const r of this.scan.values()) if (r.scanDate === scanDate) out[r.stage]++;
    return out;
  }
  async scanSymbols(scanDate: string, stage: ScanStage) {
    return [...this.scan.values()].filter((r) => r.scanDate === scanDate && r.stage === stage).map((r) => r.symbol).sort();
  }
  async latestScanDate() {
    return [...this.scan.values()].map((r) => r.scanDate).sort().at(-1) ?? null;
  }
  async saveMacroAr(m: MacroAr) {
    this.macroAr.set(m.date, m);
  }
  async latestMacroAr() {
    const date = [...this.macroAr.keys()].sort().at(-1);
    return date ? this.macroAr.get(date)! : null;
  }
  async macroArSeries(days: number) {
    return [...this.macroAr.values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, days).reverse();
  }
  async watchlist() {
    return [...this.watch.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
  }
  async addWatch(symbol: string, snap: WatchSnapshot | null = null) {
    const sym = symbol.toUpperCase();
    if (this.watch.has(sym)) return;
    this.watch.set(sym, { symbol: sym, note: snap?.note ?? null, addedAt: new Date().toISOString(), entryPrice: snap?.entryPrice ?? null, entryAction: snap?.entryAction ?? null, targetPrice: snap?.targetPrice ?? null, stopLoss: snap?.stopLoss ?? null, thesis: snap?.thesis ?? null, horizonDays: snap?.horizonDays ?? 30, status: "live", lastPrice: null, lastReturn: null, lastEvaluatedAt: null, resolvedAt: null, resolutionPrice: null, resolutionReturn: null });
  }
  async removeWatch(symbol: string) {
    this.watch.delete(symbol.toUpperCase());
  }
  async updateWatchEval(symbol: string, e: WatchEval) {
    const cur = this.watch.get(symbol.toUpperCase());
    if (cur) this.watch.set(cur.symbol, { ...cur, ...e });
  }
  async setWatchEntry(symbol: string, entryPrice: number) {
    const cur = this.watch.get(symbol.toUpperCase());
    if (cur) this.watch.set(cur.symbol, { ...cur, entryPrice });
  }
  calls: UsageCall[] = [];
  async insertCalls(rows: UsageCall[]) {
    const seen = new Set(this.calls.map((c) => c.id));
    for (const r of rows) if (!seen.has(r.id)) this.calls.push({ ...r });
  }
  async setCallResult(id: string, result: UsageResult) {
    const c = this.calls.find((x) => x.id === id);
    if (c) c.result = result;
  }
  async callsBetween(fromIso: string, toIso: string) {
    return this.calls.filter((c) => c.at >= fromIso && c.at < toIso).sort((a, b) => a.at.localeCompare(b.at));
  }
  async deleteCallsBefore(iso: string) {
    const before = this.calls.length;
    this.calls = this.calls.filter((c) => c.at >= iso);
    return before - this.calls.length;
  }
  async markJobRun(step: string, lastDate: string, detail: string | null = null) {
    this.jobs.set(step, { lastDate, ranAt: new Date().toISOString(), detail, lastError: null, lastErrorAt: null });
  }
  async markJobError(step: string, error: string) {
    const cur = this.jobs.get(step);
    this.jobs.set(step, { lastDate: cur?.lastDate ?? "", ranAt: cur?.ranAt ?? "", detail: cur?.detail ?? null, lastError: error, lastErrorAt: new Date().toISOString() });
  }
  async jobRuns() {
    return Object.fromEntries(this.jobs);
  }
  async pruneCandidates(date: string, kind: CandidateRow["kind"], keep: string[]) {
    const vivos = new Set(keep);
    let n = 0;
    for (const [k, c] of [...this.candidates]) {
      if (c.candidateDate === date && c.kind === kind && !vivos.has(c.symbol)) {
        this.candidates.delete(k);
        n++;
      }
    }
    return n;
  }
  async upsertCandidates(rows: CandidateRow[]) {
    for (const c of rows) {
      const k = `${c.candidateDate}|${c.symbol}`;
      const prev = this.candidates.get(k);
      this.candidates.set(k, prev ? { ...c, close7d: prev.close7d, spy7d: prev.spy7d, alpha7dPct: prev.alpha7dPct, close30d: prev.close30d, spy30d: prev.spy30d, alpha30dPct: prev.alpha30dPct, close90d: prev.close90d, spy90d: prev.spy90d, alpha90dPct: prev.alpha90dPct, measuredAt: prev.measuredAt } : c);
    }
  }
  /** Última fecha por familia: las filas argentinas (corren otro día) no esconden el último ranking US ni al revés. */
  async candidatesForDate(date: string) {
    const all = [...this.candidates.values()].filter((c) => c.candidateDate <= date);
    const family = (c: CandidateRow) => familyOf(c.kind);
    const last: Record<string, string | undefined> = {};
    for (const c of all) if (!last[family(c)] || c.candidateDate > last[family(c)]!) last[family(c)] = c.candidateDate;
    return all.filter((c) => c.candidateDate === last[family(c)]).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  }
  async runDates(limit = 60) {
    const dates = new Set<string>([...this.verdicts.values()].map((v) => v.verdictDate));
    for (const c of this.candidates.values()) if (c.kind === "stock" || c.kind === "etf") dates.add(c.candidateDate);
    return [...dates].sort().reverse().slice(0, limit);
  }
  async macroArForDate(date: string) {
    const d = [...this.macroAr.keys()].filter((k) => k <= date).sort().at(-1);
    return d ? this.macroAr.get(d)! : null;
  }
  async latestCandidates() {
    const all = [...this.candidates.values()];
    const family = (c: CandidateRow) => familyOf(c.kind);
    const last: Record<string, string | undefined> = {};
    for (const c of all) if (!last[family(c)] || c.candidateDate > last[family(c)]!) last[family(c)] = c.candidateDate;
    return all.filter((c) => c.candidateDate === last[family(c)]).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  }
  async candidateHistory(symbol: string, weeks: number) {
    return [...this.candidates.values()].filter((c) => c.symbol === symbol.toUpperCase()).sort((a, b) => b.candidateDate.localeCompare(a.candidateDate)).slice(0, weeks * 7);
  }
  async candidatesToMeasure(before: string, horizon: 7 | 30 | 90) {
    return [...this.candidates.values()].filter((c) => c.candidateDate <= before && (horizon === 7 ? c.close7d : horizon === 30 ? c.close30d : c.close90d) === null);
  }
  async setCandidateMeasurement(date: string, symbol: string, m: Partial<Pick<CandidateRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct" | "close90d" | "spy90d" | "alpha90dPct">>) {
    const k = `${date}|${symbol}`;
    const c = this.candidates.get(k);
    if (c) this.candidates.set(k, { ...c, ...m, measuredAt: new Date().toISOString() });
  }
  async allCandidates() {
    return [...this.candidates.values()].sort((a, b) => b.candidateDate.localeCompare(a.candidateDate) || a.symbol.localeCompare(b.symbol));
  }
  async savePlan(p: ContributionPlan) {
    // Como en Postgres: una versión nueva del plan no tiene controles, y el momento en que se armó lo pone el guardado.
    this.plans.set(p.month, { ...p, controles: null, builtAt: new Date().toISOString() });
  }
  async savePlanControles(month: string, controles: NonNullable<ContributionPlan["controles"]>) {
    const p = this.plans.get(month);
    if (p) this.plans.set(month, { ...p, controles });
  }
  private reviews = new Map<string, PreTradeReview>();
  async savePreTradeReview(r: PreTradeReview) {
    this.reviews.set(`${r.date}|${r.symbol.toUpperCase()}`, { ...r, symbol: r.symbol.toUpperCase() });
  }
  async preTradeReviews(date: string) {
    return [...this.reviews.values()].filter((r) => r.date === date);
  }
  async latestPlan() {
    const m = [...this.plans.keys()].sort().at(-1);
    return m ? this.plans.get(m)! : null;
  }
  async plansToMeasure(before: string) {
    return [...this.plans.values()].filter((p) => p.month <= before.slice(0, 7) && p.lines.some((l) => l.alpha30dPct === null || l.alpha90dPct === null));
  }
  async updatePlanLines(month: string, lines: PlanLine[]) {
    const p = this.plans.get(month);
    if (p) this.plans.set(month, { ...p, lines });
  }
}
