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
  promptVersion: string;
  createdAt: string;
}

export interface Position { symbol: string; quantity: number; avgCost: number; currency: string; market: "us" | "adr" | "ar"; layer: "riesgo" | "nucleo" | "cobertura"; notes: string | null }
export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";
export interface Verdict { verdictDate: string; symbol: string; verb: Verb; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null }
export interface RiskReport {
  totalValue: number;
  weights: Array<{ symbol: string; value: number; weightPct: number }>;
  concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; bySector: Record<string, number>; byTheme: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
  correlatedPairs: Array<{ a: string; b: string; corr: number }>;
  betas: Record<string, number | null>;
  portfolioBeta: number | null;
  stressSpyMinus20Pct: number | null;
  liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
  notes: string[];
}
interface Bucket { n: number; hitRate: number | null; avgAlpha: number | null }
export interface Measurement { total: number; pending: number; byVerb: Record<Verb, { h7: Bucket; h30: Bucket }> }
export interface CarteraRun { date: string; verdicts: Verdict[]; risk: RiskReport; errors: Array<{ symbol: string; error: string }>; measured: { measured7: number; measured30: number } }

export interface Tags { assetClass: string; sector: string; industry: string | null; themes: string[]; themesSource: "regla" | "modelo" | "manual" }
export interface Candidate {
  candidateDate: string; symbol: string; kind: "stock" | "etf" | "ar" | "cedear" | "watch"; verdict: "COMPRAR" | "OBSERVAR" | "NUCLEO"; score: number | null; axes: Record<string, number | null>; peerGroup: string[]; rankInGroup: number | null; groupSize: number | null;
  close: number; entryLow: number | null; entryHigh: number | null; stop: number | null; target: number | null; sizeUsd: number | null; sizeQty: number | null; riskScore: number | null; flags: string[]; nthAppearance: number;
  summary: string | null; whyRanks: string | null; mainRisk: string | null; moat: string | null; degradedBy: string | null; spyClose: number | null; alpha7dPct: number | null; alpha30dPct: number | null; alpha90dPct: number | null; tags: Tags | null;
}
export interface CandidateDetail { candidate: Candidate; fundamentals: { metrics: Record<string, number | null>; peers: string[]; mcapUsd: number; dollarVolumeUsd: number; nextEarnings: string | null; insiderBuys90d: number | null; insiderSells90d: number | null; analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null; earningsSurprises: Array<{ period: string; surprisePercent: number | null }> | null } | null; tags: Tags | null; profile: { name: string | null; country: string | null; industry: string | null } | null; peers: Array<{ symbol: string; metrics: Record<string, number | null> }> }
export interface MacroAr { date: string; oficial: number | null; mep: number | null; ccl: number | null; blue: number | null; mayorista: number | null; brechaPct: number | null; riesgoPais: number | null; merval: number | null; mervalUsd: number | null }
export type WatchStatus = "live" | "triggered" | "invalidated" | "expired";
export interface WatchItem { symbol: string; note: string | null; addedAt: string; entryPrice: number | null; entryAction: string | null; targetPrice: number | null; stopLoss: number | null; thesis: string | null; horizonDays: number; status: WatchStatus; lastPrice: number | null; lastReturn: number | null; lastEvaluatedAt: string | null; resolvedAt: string | null; resolutionPrice: number | null; resolutionReturn: number | null }
export interface Watchlist { items: WatchItem[]; rows: Candidate[] }
export interface PriceRow { symbol: string; price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null; stale: boolean; currency: string | null }
export interface Tape { at: string; tracked: number; gainers: PriceRow[]; losers: PriceRow[] }
export interface ArgentinaData { macro: MacroAr | null; series: MacroAr[]; acciones: Candidate[]; cedears: Candidate[] }
export interface CatchUpResult { at: string; ran: Array<{ id: string; label: string; ok: boolean; detail: string }> }
export interface CatchUpStatus { now: string; due: Array<{ id: string; label: string; last: string | null; expected: string }>; last: Record<string, { lastDate: string; ranAt: string | null; detail: string | null } | null>; running: boolean; lastResult: CatchUpResult | null }
export interface TopPick { symbol: string; conviction: number; gainPct: number; lossPct: number; reasons: string[]; cautions: string[]; allAligned: boolean; close: number; entryHigh: number | null; stop: number | null; target: number | null; sizeUsd: number | null; sizeQty: number | null; riskScore: number | null; score: number | null; rankInGroup: number | null; groupSize: number | null; summary: string | null; mainRisk: string | null; tags: Tags | null }
export interface RadarTop { date: string | null; overweight: Record<string, number>; picks: TopPick[] }
export interface PlanLine { symbol: string; kind: "nucleo" | "sumar" | "comprar" | "seguimiento"; amountUsd: number; rationale: string; close: number | null; alpha30dPct: number | null; alpha90dPct: number | null; entryHigh?: number | null; stop?: number | null; target?: number | null; ret12mPct?: number | null; priority?: number | null }
export interface ContributionPlan { month: string; totalUsd: number; lines: PlanLine[]; notes: string[]; leftOut?: Array<{ symbol: string; reason: string }> }
export interface ScanStatus { running: boolean; stopRequested: boolean; startedAt: string | null; progress: { done: number; total: number; stage: string } | null; last: { listed: number; prefiltered: number; fundamentalsOk: number; excluded: number; errors: number; stopped: boolean } | null; scanDate: string | null; status: Record<string, number> | null }
interface RBucket { n: number; avgAlpha: number | null; hitRate: number | null }
export interface RadarMeasurement { total: number; pending: number; byVerdict: Record<string, Record<"h7" | "h30" | "h90", RBucket>>; comprarVsObservar: Record<"h7" | "h30" | "h90", { diff: number | null; nComprar: number; nObservar: number }> }
export interface TaxonomyOptions { assetClasses: string[]; sectors: string[]; themes: string[] }

export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number }
export interface ChartBar { time: number; open: number; high: number; low: number; close: number; volume: number }
export interface SymbolDescription { symbol: string; longName: string | null; summary: string | null; employees: number | null; website: string | null; exchangeName: string | null; firstTradeDate: string | null; sector: string | null; industry: string | null; country: string | null; updatedAt: string }
export interface NewsItem { symbol: string; date: string; headline: string; source: string | null; url: string; summary: string | null }
export interface Transaction { id: string; symbol: string; type: "BUY" | "SELL" | "DIVIDEND" | "TRANSFER"; quantity: number; price: number; fees: number; date: string; currency: string; platform: string | null; externalId: string | null; notes: string | null }
/** Precio vivo con la variación del día contra el cierre previo. */
export interface Quote { price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null; currency?: string | null }
export interface TickerPage {
  symbol: string;
  description: SymbolDescription | null;
  quote: Quote | null;
  position: (Position & { valueUsd: number; pnlUsd: number; pnlPct: number; weightPct: number | null }) | null;
  verdict: Verdict | null;
  tags: Tags | null;
  fundamentals: { asOf: string; metrics: Record<string, number | null>; peers: string[]; mcapUsd: number | null; dollarVolumeUsd: number; nextEarnings: string | null; insiderBuys90d: number | null; insiderSells90d: number | null; analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null; earningsSurprises: Array<{ period: string; surprisePercent: number | null }> | null } | null;
  candidate: Candidate | null;
  peers: Array<{ symbol: string; metrics: Record<string, number | null> }>;
  theses: Thesis[];
  transactions: Transaction[];
  transactionSummary: { buys: { count: number; total: number }; sells: { count: number; total: number }; dividends: { count: number; total: number }; invested: number };
  candles: Candle[];
  news: NewsItem[];
  filings: string[];
  arNews: string[];
  errors: string[];
  pending: string[];
  timings: Record<string, number>;
}

const base = "/api";

async function j<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(base + path, { headers: { "Content-Type": "application/json" }, ...init });
  const body = (await res.json().catch(() => ({}))) as T & { error?: unknown; detail?: string; reason?: string };
  if (!res.ok) throw new Error(body.detail ? `${body.reason}: ${body.detail}` : JSON.stringify(body.error ?? body));
  return body;
}

export const api = {
  health: () => j<{ ok: boolean; killSwitch: boolean; lastRun: { at: string; summary: Record<string, unknown> } | null }>("/health"),
  theses: (status: string) => j<Thesis[]>(`/theses?status=${status}`),
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
  prices: {
    get: (symbols: string[]) => (symbols.length ? j<PriceRow[]>(`/prices?symbols=${symbols.join(",")}`) : Promise.resolve([] as PriceRow[])),
    tape: () => j<Tape>("/prices/tape"),
  },
  catchup: {
    status: () => j<CatchUpStatus>("/catchup"),
    run: () => j<CatchUpResult>("/catchup", { method: "POST" }),
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
