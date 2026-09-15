export interface Thesis {
  id: string;
  ticker: string;
  eventType: string;
  eventDate: string | null;
  direction: "long" | "short";
  pEstimate: number;
  pMarket: number;
  edge: number;
  instrument: "stock" | "call" | "put";
  entryMax: number;
  target: number;
  invalidation: string;
  confidence: string;
  reasoning: string;
  sources: string[];
  status: string;
  rejectionReason: string | null;
  pMarketFromOptions?: boolean;
  promptVersion: string;
  createdAt: string;
  /** El mismo evento tiene una lectura más nueva (15/9): una tesis viva por evento. */
  reemplazadaPor?: { id: string; createdAt: string; status: string; edge: number } | null;
}

export interface Position { symbol: string; quantity: number; avgCost: number; currency: string; market: "us" | "adr" | "ar"; layer: "riesgo" | "nucleo" | "cobertura"; notes: string | null }
export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";
export interface Verdict { verdictDate: string; symbol: string; verb: Verb; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null; /** Fecha de la vela de `close` (15/9): no es la fecha de la corrida. */ closeDate?: string | null; /** Objetivo de la posición, cierre + 2 × (cierre − stop), calculado en core (15/9). En SUMAR, `target` es el de la compra nueva. */ holdTarget?: number | null }
export interface RiskReport {
  totalValue: number;
  /** Fecha de la vela con que se valuó (15/9): no es la fecha de la corrida. */
  asOf?: string | null;
  weights: Array<{ symbol: string; value: number; weightPct: number; close?: number | null; closeDate?: string | null }>;
  concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; bySector: Record<string, number>; byTheme: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
  correlatedPairs: Array<{ a: string; b: string; corr: number }>;
  betas: Record<string, number | null>;
  portfolioBeta: number | null;
  stressSpyMinus20Pct: number | null;
  /** Lo observado, no lo estimado: volatilidad propia, la del SPY, cuánto explica el SPY y la peor rueda. */
  risk?: { portfolioVolPct: number | null; spyVolPct: number | null; r2VsSpy: number | null; worstDayPct: number | null; sessions: number };
  liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
  notes: string[];
}
interface Bucket { n: number; hitRate: number | null; avgAlpha: number | null }
/** `estado`: medidas, esperando su cierre y vencidas sin medir, por horizonte (15/9); las mismas palabras que el Radar. */
export interface Measurement { total: number; pending: number; byVerb: Record<Verb, { h7: Bucket; h30: Bucket }>; estado?: { h7: EstadoMedicion; h30: EstadoMedicion } }
export interface CurveMetrics { totalPct: number; annualPct: number | null; xirrPct: number | null; volPct: number | null; maxDrawdownPct: number }
export interface CurvePoint { date: string; value: number; index: number; spyIndex: number }
export interface CurveReport { from: string; to: string; sessions: number; points: CurvePoint[]; portfolio: CurveMetrics; spy: CurveMetrics; valueUsd: number; investedUsd: number; dividendsUsd: number; /** Lo que un traspaso trae sin operación que lo explique, entrado como aporte (15/9). */ adjustmentsUsd?: number; sameMoneyInSpy: { valueUsd: number; xirrPct: number | null } | null; reading: string; complete: boolean; warnings: string[] }
export interface CurveResponse { curve: CurveReport | null; error: string | null; computedAt: string }
export interface CarteraRun { date: string; verdicts: Verdict[]; risk: RiskReport; errors: Array<{ symbol: string; error: string }>; measured: { measured7: number; measured30: number } }

export interface Tags { assetClass: string; sector: string; industry: string | null; themes: string[]; themesSource: "regla" | "modelo" | "manual" }
export interface QuarterStatement { start: string; end: string; fp: string; revenue: number | null; operatingIncome: number | null; netIncome: number | null; pretaxIncome: number | null; taxExpense: number | null; operatingCashFlow: number | null; capex: number | null; dilutedShares: number | null; equity: number | null; noncontrolling?: number | null; receivables?: number | null; extraordinary: Array<{ tag: string; value: number }> }
export interface CoreEarnings { asOf: string; revenueTTM: number | null; operatingIncomeTTM: number | null; coreOperatingIncomeTTM: number | null; netIncomeTTM: number | null; coreNetIncomeTTM: number | null; coreEpsTTM: number | null; operatingCashFlowTTM: number | null; freeCashFlowTTM: number | null; equity: number | null; taxRate: number; extraordinaryTTM: number; extraordinaryItems: Array<{ tag: string; quarterEnd: string; value: number }>; deviationPct: number | null; noncontrollingTTM?: number | null; receivablesPctRevenue?: number | null; lastQuarterYoy?: { end: string; revenuePct: number | null; operatingPct: number | null } | null }
export interface Statements { symbol: string; cik: string; asOf: string; quarters: QuarterStatement[]; core: CoreEarnings | null }
export interface RadarEvent { symbol: string; date: string; kind: string; severity: "grave" | "moderado" | "ruido"; headline: string; url: string; source: string | null; why: string | null }
export interface AnalystAction { symbol: string; date: string; firm: string; action: "mantiene" | "sube" | "baja" | "inicia"; rating: string | null; target: number | null; url: string }
export type VerificationVerdict = "apto" | "con_reservas" | "evitar";
export interface VerificationSummary { date: string; verdict: VerificationVerdict; reason: string }
export interface CandidateVerification extends VerificationSummary { symbol: string; lastQuarter: { reportDate: string | null; revenueVsConsensus: string | null; epsVsConsensus: string | null; oneOffs: string[]; guidance: string | null } | null; analysts: Array<{ date: string; firm: string; action: string; target: number | null }>; consensusTarget: number | null; events: Array<{ date: string; kind: string; headline: string }>; valuation: string | null; nextEarnings: string | null; sources: Array<{ title: string; url: string }>; researchText: string; promptVersion: string; model: string | null; detectedAt: string }
export interface EntryTiming { state: "retroceso" | "en_zona" | "esperar_retroceso" | "esperar_confirmacion"; level: number; levelLabel: string; low: number; high: number; validSessions: number; sma20: number; sma50: number | null; atr14: number; extensionAtr: number; rangePct60: number | null; why: string }
export interface CandidateEvent { date: string; kind: string; severity: "grave" | "moderado" | "ruido"; headline: string }
export interface AnalystTargets { n: number; median: number | null; min: number | null; max: number | null; latestDate: string | null }
export interface Candidate {
  candidateDate: string; symbol: string; kind: "stock" | "etf" | "ar" | "cedear" | "watch" | "adr"; verdict: "COMPRAR" | "OBSERVAR" | "NUCLEO"; score: number | null; axes: Record<string, number | null>; peerGroup: string[]; rankInGroup: number | null; groupSize: number | null;
  close: number; entryLow: number | null; entryHigh: number | null; stop: number | null; target: number | null; sizeUsd: number | null; sizeQty: number | null; riskScore: number | null; flags: string[]; nthAppearance: number;
  summary: string | null; whyRanks: string | null; mainRisk: string | null; moat: string | null; degradedBy: string | null; spyClose: number | null; alpha7dPct: number | null; alpha30dPct: number | null; alpha90dPct: number | null; tags: Tags | null;
  events?: CandidateEvent[]; analystTargets?: AnalystTargets | null; verification?: VerificationSummary | null; entry?: EntryTiming | null;
}
export interface CandidateDetail { candidate: Candidate; fundamentals: { metrics: Record<string, number | null>; metricsRaw?: Record<string, number | null> | null; statementsAsOf?: string | null; peers: string[]; mcapUsd: number; dollarVolumeUsd: number; nextEarnings: string | null; insiderBuys90d: number | null; insiderSells90d: number | null; analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null; earningsSurprises: Array<{ period: string; surprisePercent: number | null }> | null } | null; tags: Tags | null; profile: { name: string | null; country: string | null; industry: string | null } | null; peers: Array<{ symbol: string; metrics: Record<string, number | null>; excluded?: string[] }>; medians?: Record<string, number | null> | null; ownExcluded?: string[]; statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[]; newsScannedTo?: string | null; verification?: CandidateVerification | null; /** La verificación es del cuestionario vigente; null = no se sabe (sin verificador). */ verificationCurrent?: boolean | null }
export interface MacroAr { date: string; oficial: number | null; mep: number | null; ccl: number | null; blue: number | null; mayorista: number | null; brechaPct: number | null; riesgoPais: number | null; merval: number | null; mervalUsd: number | null; mervalDate?: string | null }
export type WatchStatus = "live" | "triggered" | "invalidated" | "expired";
export interface WatchItem { symbol: string; note: string | null; addedAt: string; entryPrice: number | null; entryAction: string | null; targetPrice: number | null; stopLoss: number | null; thesis: string | null; horizonDays: number; status: WatchStatus; lastPrice: number | null; lastReturn: number | null; lastEvaluatedAt: string | null; resolvedAt: string | null; resolutionPrice: number | null; resolutionReturn: number | null }
export interface Watchlist { items: WatchItem[]; rows: Candidate[] }
/** `prevCloseDate`: el cambio se mide contra el cierre guardado de esa fecha; null = contra el de la fuente (15/9). */
export interface PriceRow { symbol: string; price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null; stale: boolean; currency: string | null; prevCloseDate?: string | null }
export interface SymbolHit { symbol: string; name: string; exchange: string; type: "accion_us" | "accion_ar" | "cedear" | "etf" | "cripto"; flag: string }
export interface Tape { at: string; tracked: number; gainers: PriceRow[]; losers: PriceRow[] }
/**
 * `adrs`: empresas argentinas con ADR en Nueva York, en dólares contra el SPY (lo que el dueño compra).
 * `acciones`: solo las de BYMA que NO tienen ADR, en pesos contra el Merval. `cedears`: en pesos.
 */
export interface ArgentinaData { macro: MacroAr | null; series: MacroAr[]; adrs?: Candidate[]; acciones: Candidate[]; cedears: Candidate[] }
export interface Novedades { date: string | null; previousDate: string | null; verdictChanges: Array<{ symbol: string; from: string; to: string; reason: string }>; alerts: Array<{ symbol: string; verb: string; reason: string }>; enteredBuy: Array<{ symbol: string; kind: string; score: number | null; held?: boolean }>; leftBuy: Array<{ symbol: string; kind: string; now: string }>; watchResolved: Array<{ symbol: string; status: string; returnPct: number | null; date?: string }>; proposedTheses: Array<{ id: string; ticker: string; eventType: string; direction: string; edge: number; pMarketFromOptions?: boolean; summary: string }>; news: NewsItem[]; empty: boolean }
export interface CatchUpResult { at: string; ran: Array<{ id: string; label: string; ok: boolean; detail: string }> }
/** `ranAtSource`: "registro" = job_runs, con hora; "base" = fecha de los datos (15/9: con job_runs viejo, la hora no se conoce). */
export interface StepStatus { id: string; label: string; schedule: string; lastDate: string | null; ranAt: string | null; ranAtSource?: "registro" | "base" | null; detail: string | null; lastError: string | null; lastErrorAt: string | null; expected: string; due: boolean; running: boolean }
/** `lastRunStep`: de qué paso es `lastRunAt` (no es la última corrida de todo el pipeline). */
export interface CatchUpStatus { now: string; due: Array<{ id: string; label: string; last: string | null; expected: string }>; last: Record<string, { lastDate: string; ranAt: string | null; detail: string | null } | null>; steps: StepStatus[]; lastRunAt: string | null; lastRunStep?: string | null; running: boolean; current: string | null; lastResult: CatchUpResult | null }
export interface UsageSourceRow { source: string; calls: number; ok: number; errors: number; peakPerMinute: number; limitPerMinute: number | null; limitPerDay: number | null; pctMinute: number | null; pctDay: number | null }
/** `limite`: 429 sin detalle (no es la cuota diaria). `exhausted`: 429 por día sin respuestas buenas después (15/9). */
export interface UsageGeminiRow { model: string; keyIndex: number; calls: number; ok: number; rpm: number; rpd: number; limite: number; saturado: number; validacion: number; error: number; tokensIn: number; tokensOut: number; tokensThink: number; costUsd: number; limitPerDay: number | null; pctDay: number | null; exhausted: boolean; lastRpdAt: string | null; lastOkAt: string | null }
export interface UsageStepRow { step: string; source: string; calls: number; errors: number; ms: number }
export type UsageCoverage = "completo" | "parcial" | "sin_registro";
export interface UsageSummary { date: string; total: { calls: number; errors: number; costUsd: number }; bySource: UsageSourceRow[]; gemini: { rows: UsageGeminiRow[]; tokensIn: number; tokensOut: number; tokensThink: number; costUsd: number; failedPct: number | null }; byStep: UsageStepRow[]; warnings: string[]; coverage?: { state: UsageCoverage; from: string | null }; quotaResetAt?: string | null }
export interface UsageDay { date: string; calls: number; errors: number; costUsd: number; bySource: Record<string, number>; geminiCalls: number; geminiFailed: number; coverage?: UsageCoverage }
export interface UsageCallRow { id: string; at: string; source: string; step: string; purpose: string | null; symbol: string | null; endpoint: string; model: string | null; keyIndex: number | null; status: number | null; result: string; tokensIn: number | null; tokensOut: number | null; tokensThink: number | null; ms: number }
export interface UsageCalls { date: string; total: number; calls: UsageCallRow[] }
export interface TopPick { symbol: string; conviction: number; gainPct: number; lossPct: number; base: number; consensus: { target: number; upsidePct: number } | null; reasons: string[]; cautions: string[]; allAligned: boolean; close: number; entryHigh: number | null; stop: number | null; target: number | null; sizeUsd: number | null; sizeQty: number | null; riskScore: number | null; score: number | null; rankInGroup: number | null; groupSize: number | null; summary: string | null; mainRisk: string | null; tags: Tags | null }
export interface MacroRegime { state: "restrictivo" | "neutral" | "expansivo"; asOf: string; tenYearPct: number; change3mBp: number | null; why: string }
export interface RadarTop { date: string | null; overweight: Record<string, number>; regime?: MacroRegime | null; picks: TopPick[] }
export interface PlanLine { symbol: string; kind: "nucleo" | "sumar" | "comprar" | "seguimiento"; amountUsd: number; rationale: string; close: number | null; alpha30dPct: number | null; alpha90dPct: number | null; entryHigh?: number | null; stop?: number | null; target?: number | null; ret12mPct?: number | null; ret12mPartial?: boolean | null; priority?: number | null; entry?: EntryTiming | null; /** Debajo de este precio la orden no se ejecuta: stop + 1 ATR. */ minPrice?: number | null; /** La base única de la orden (15/9): cantidad, riesgo y % se cuentan contra este precio. */ orderPrice?: number | null; qty?: number | null; trancheUsd?: number | null; trancheQty?: number | null; /** De qué rueda es `close`. */ closeDate?: string | null }
/** Controles automáticos sobre una versión del plan (15/9): con un grave, un error o sin controles, no se ejecuta. */
export interface PlanControles { at: string; planBuiltAt: string; graves: number; avisos: number; findings: Array<{ check: string; symbol: string | null; severity: "grave" | "aviso"; detail: string }>; error?: string }
/** Qué cambió respecto del plan anterior y por qué (15/9). `usuario`: lo cambió una acción tuya, no el mercado. */
export interface PlanChange { symbol: string; change: "entra" | "sale" | "monto"; fromUsd: number; toUsd: number; source: "mercado" | "verificacion" | "regla" | "usuario" | "reparto" | "monto"; cause: string }
export interface ContributionPlan { month: string; totalUsd: number; lines: PlanLine[]; notes: string[]; leftOut?: Array<{ symbol: string; reason: string }>; builtAt?: string; controles?: PlanControles | null; changes?: PlanChange[]; previousBuiltAt?: string | null; /** Lo que el plan compraría y espera la revisión antes de comprar (15/9). */ reviewsPending?: string[]; /** En cuántas compras se ejecuta (1 = de una vez). */ tranches?: number; /** Lo que solo la verificación web frena (15/9). */ verificationsPending?: string[] }
export interface ScanStatus { running: boolean; stopRequested: boolean; startedAt: string | null; progress: { done: number; total: number; stage: string } | null; last: { listed: number; prefiltered: number; fundamentalsOk: number; excluded: number; errors: number; stopped: boolean } | null; scanDate: string | null; status: Record<string, number> | null }
interface RBucket { n: number; avgAlpha: number | null; hitRate: number | null }
export type Horizonte = "h7" | "h30" | "h90";
export interface EstadoMedicion { medidas: number; esperando: number; vencidas: number; primera: string | null }
export interface GrupoMedicion { byVerdict: Record<string, Record<Horizonte, RBucket>>; comprarVsObservar: Record<Horizonte, { diff: number | null; nComprar: number; nObservar: number }>; filas: number }
export interface RadarMeasurement { total: number; pending: number; byVerdict: Record<string, Record<Horizonte, RBucket>>; comprarVsObservar: Record<Horizonte, { diff: number | null; nComprar: number; nObservar: number }>; merval?: GrupoMedicion; estado?: Record<Horizonte, EstadoMedicion> }
export interface TaxonomyOptions { assetClasses: string[]; sectors: string[]; themes: string[] }

export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface ChartBar { time: number; open: number; high: number; low: number; close: number; volume: number; sma20?: number | null; sma50?: number | null; sma200?: number | null; stop?: number | null; rsi14?: number | null; /** Sesión en curso armada con el intradiario: sin cerrar. */ partial?: boolean }
export interface SymbolDescription { symbol: string; longName: string | null; summary: string | null; employees: number | null; website: string | null; exchangeName: string | null; firstTradeDate: string | null; sector: string | null; industry: string | null; country: string | null; updatedAt: string }
export interface NewsItem { symbol: string; date: string; headline: string; source: string | null; url: string; summary: string | null }
export interface Transaction { id: string; symbol: string; type: "BUY" | "SELL" | "DIVIDEND" | "TRANSFER"; quantity: number; price: number; fees: number; date: string; currency: string; platform: string | null; externalId: string | null; notes: string | null }
/** Precio vivo con la variación del día contra el cierre previo. */
export interface Quote { price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null; currency?: string | null; /** Marca del servidor (más de 30 horas): la misma para toda la app (15/9). */ stale?: boolean; /** De qué rueda es `prevClose` (15/9). */ prevCloseDate?: string | null }
export interface TickerPage {
  symbol: string;
  description: SymbolDescription | null;
  quote: Quote | null;
  position: (Position & { valueUsd: number; pnlUsd: number; pnlPct: number; weightPct: number | null }) | null;
  verdict: Verdict | null;
  tags: Tags | null;
  fundamentals: { asOf: string; metrics: Record<string, number | null>; metricsRaw?: Record<string, number | null> | null; statementsAsOf?: string | null; peers: string[]; mcapUsd: number | null; dollarVolumeUsd: number; nextEarnings: string | null; insiderBuys90d: number | null; insiderSells90d: number | null; analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null; earningsSurprises: Array<{ period: string; surprisePercent: number | null }> | null } | null;
  candidate: Candidate | null;
  /** `excluded`: métricas que el puntaje no usa para ese par (15/9: en bancos, el crecimiento de ingresos de Finnhub). */
  peers: Array<{ symbol: string; metrics: Record<string, number | null>; excluded?: string[] }>;
  /** Mediana del grupo completo, la propia incluida: la misma que usa el puntaje. */
  medians?: Record<string, number | null> | null;
  /** Métricas que el puntaje no usa para este símbolo. */
  ownExcluded?: string[];
  statements: Statements | null;
  events: RadarEvent[];
  analystActions: AnalystAction[];
  /** Hasta qué fecha se leyeron las noticias. null = nunca: una lista de eventos vacía no prueba nada. */
  newsScannedTo: string | null;
  verification?: CandidateVerification | null;
  /** ¿La verificación es del cuestionario vigente? null = no se sabe (15/9: NBN estaba APTA con el anterior). */
  verificationCurrent?: boolean | null;
  theses: Thesis[];
  transactions: Transaction[];
  transactionSummary: { buys: { count: number; total: number }; sells: { count: number; total: number }; dividends: { count: number; total: number }; dividendShares?: number; invested: number };
  candles: Candle[];
  /** ATR de 14 ruedas de las velas guardadas: para decir a cuántos ATR está el precio del stop (15/9). */
  atr14?: number | null;
  news: NewsItem[];
  filings: string[];
  arNews: string[];
  errors: string[];
  pending: string[];
  timings: Record<string, number>;
}

const base = "/api";

/** Fecha de corrida que se está viendo (histórico). null = la última. Las lecturas la mandan como ?date= y la API la respeta donde aplica. */
let viewDate: string | null = null;
export function setViewDate(d: string | null) { viewDate = d; }
export function getViewDate(): string | null { return viewDate; }
export const isHistorical = () => viewDate !== null;

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  const url = method === "GET" && viewDate ? `${path}${path.includes("?") ? "&" : "?"}date=${viewDate}` : path;
  const res = await fetch(base + url, { headers: { "Content-Type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; detail?: string; reason?: string };
  if (!res.ok) throw new Error(body.detail ? `${body.reason}: ${body.detail}` : JSON.stringify(body.error ?? body));
  return body;
}

export const api = {
  health: () => j<{ ok: boolean; killSwitch: boolean; lastRun: { at: string; summary: Record<string, unknown> } | null }>("/health"),
  theses: (status: string) => j<Thesis[]>(`/theses?status=${status}`),
  /** Cuántas tesis hay con esos estados y cuántas muestra la lista como máximo (15/9). */
  thesesTotal: (status: string) => j<{ total: number; limit: number }>(`/theses/total?status=${status}`),
  thesis: (id: string) => j<{ thesis: Thesis; event: { title: string; source: string; payload: Record<string, unknown> } | null; orders: Array<{ side: string; qty: number; limitPrice: number; status: string; avgFillPrice: number | null; symbol: string }> }>(`/theses/${id}`),
  approve: (id: string) => j<{ ok: boolean }>(`/theses/${id}/approve`, { method: "POST" }),
  reject: (id: string, note: string) => j<{ ok: boolean }>(`/theses/${id}/reject`, { method: "POST", body: JSON.stringify({ note }) }),
  close: (id: string, body: { predictedOutcomeHappened: boolean; closeReason: string; notes?: string }) => j<unknown>(`/theses/${id}/close`, { method: "POST", body: JSON.stringify(body) }),
  portfolio: () => j<{ snapshot: { capitalUsd: number; dailyPnlUsd: number; killSwitch: boolean; openByEventType: Record<string, number> }; account: { equity: number } }>("/portfolio"),
  killSwitch: (on: boolean) => j<{ killSwitch: boolean }>("/kill-switch", { method: "POST", body: JSON.stringify({ on }) }),
  run: () => j<{ proposed: unknown[]; rejected: unknown[]; errors: unknown[]; newEvents: number; passed: number }>("/run", { method: "POST" }),
  cartera: {
    positions: () => j<Position[]>("/cartera/positions"),
    quotes: () => j<{ asOf: string; quotes: Record<string, Quote | null> }>("/cartera/quotes"),
    upsertPosition: (p: Position) => j<{ ok: boolean }>("/cartera/positions", { method: "POST", body: JSON.stringify(p) }),
    deletePosition: (symbol: string) => j<{ ok: boolean }>(`/cartera/positions/${symbol}`, { method: "DELETE" }),
    run: () => j<CarteraRun>("/cartera/run", { method: "POST" }),
    verdicts: () => j<Verdict[]>("/cartera/verdicts"),
    risk: () => j<{ date: string; report: RiskReport } | null>("/cartera/risk"),
    measurement: () => j<Measurement>("/cartera/measurement"),
    curve: () => j<CurveResponse>("/cartera/curve"),
  },
  radar: {
    candidates: (q: Record<string, string> = {}) => j<Candidate[]>(`/radar/candidates?${new URLSearchParams(q)}`),
    candidate: (symbol: string) => j<CandidateDetail>(`/radar/candidates/${symbol}`),
    etfs: () => j<Candidate[]>("/radar/etfs"),
    scan: () => j<{ started: boolean }>("/radar/scan", { method: "POST" }),
    stopScan: () => j<{ stopRequested: boolean }>("/radar/scan/stop", { method: "POST" }),
    scanStatus: () => j<ScanStatus>("/radar/scan-status"),
    rank: () => j<{ candidates: Candidate[]; skipped: unknown[]; errors: Array<{ symbol: string; error: string }> }>("/radar/rank", { method: "POST" }),
    refresh: () => j<{ refreshed: number; errors: unknown[] }>("/radar/refresh", { method: "POST" }),
    top: (n = 5) => j<RadarTop>(`/radar/top?n=${n}`),
    argentina: () => j<ArgentinaData>("/radar/argentina"),
    watchlist: () => j<Watchlist>("/radar/watchlist"),
    addWatch: (symbol: string) => j<Watchlist>("/radar/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
    removeWatch: (symbol: string) => j<Watchlist>(`/radar/watchlist/${symbol}`, { method: "DELETE" }),
    refreshWatchlist: () => j<{ symbols: number; rows: number; errors: Array<{ symbol: string; error: string }> }>("/radar/watchlist/refresh", { method: "POST" }),
    refreshArgentina: () => j<{ acciones: number; cedears: number; errors: Array<{ symbol: string; error: string }> }>("/radar/argentina", { method: "POST" }),
    plan: () => j<ContributionPlan | null>("/radar/plan"),
    buildPlan: (amountUsd?: number) => j<ContributionPlan>(`/radar/plan${amountUsd ? `?amount=${Math.round(amountUsd)}` : ""}`, { method: "POST" }),
    measurement: () => j<RadarMeasurement>("/radar/measurement"),
  },
  taxonomy: {
    options: () => j<TaxonomyOptions>("/taxonomy/options"),
    get: (symbol: string) => j<Tags>(`/taxonomy/${symbol}`),
    put: (symbol: string, body: { assetClass?: string; sector?: string; themes?: string[] }) => j<Tags>(`/taxonomy/${symbol}`, { method: "PUT", body: JSON.stringify(body) }),
  },
  symbols: { search: (q: string) => j<SymbolHit[]>(`/symbols/search?q=${encodeURIComponent(q)}`) },
  prices: {
    get: (symbols: string[]) => (symbols.length ? j<PriceRow[]>(`/prices?symbols=${symbols.join(",")}`) : Promise.resolve([] as PriceRow[])),
    all: () => j<{ at: string | null; error: string | null; rows: PriceRow[] }>("/prices/all"),
    tape: () => j<Tape>("/prices/tape"),
  },
  novedades: () => j<Novedades>("/novedades"),
  runs: { dates: () => j<string[]>("/runs/dates") },
  catchup: {
    status: () => j<CatchUpStatus>("/catchup"),
    /** Uso de fuentes externas del día (registro por llamada). */
    usage: (date?: string) => j<UsageSummary>(date ? `/usage?date=${date}` : "/usage"),
    run: () => j<CatchUpResult>("/catchup", { method: "POST" }),
    runStep: (id: string) => j<CatchUpResult>(`/catchup/run/${id}`, { method: "POST" }),
  },
  /** Pestaña Uso: resumen del día, serie diaria y lista de llamadas con filtros. */
  usage: {
    summary: (date?: string) => j<UsageSummary>(date ? `/usage?date=${date}` : "/usage"),
    daily: (days: number, date?: string) => j<UsageDay[]>(`/usage/daily?days=${days}${date ? `&date=${date}` : ""}`),
    calls: (p: { date?: string; source?: string; step?: string; result?: string; symbol?: string; limit?: number }) => {
      const qs = Object.entries(p).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
      return j<UsageCalls>(`/usage/calls${qs ? `?${qs}` : ""}`);
    },
  },
  ticker: {
    get: (symbol: string, o: { live?: boolean } = {}) => j<TickerPage>(`/ticker/${symbol}${o.live === false ? "?live=0" : ""}`),
    chart: (symbol: string, range: string, interval: string) => j<ChartBar[]>(`/ticker/${symbol}/chart?range=${range}&interval=${interval}`),
  },
  calibration: () =>
    j<{
      closed: number; brierSystem: number; brierMarket: number; hitRate: number; avgPnlPct: number; totalPnlUsd: number; maxDrawdownPct: number; humanRejected: number;
      byEventType: Record<string, { n: number; hitRate: number; avgPnlPct: number; brierSystem: number; brierMarket: number }>;
      criteria: Record<string, boolean>;
    }>("/calibration"),
};
