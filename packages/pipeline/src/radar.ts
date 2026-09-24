import { AR_BENCHMARK } from "./argentina.js";
import {
  AXES,
  AXIS_METRICS,
  alphaPct,
  applyCoreMetrics,
  atr,
  explainPlanChange,
  todayLocal,
  type PlanReview,
  type PlanSymbolInput,
  type PreTradeReviewer,
  sanitizeMetrics,
  assetClassFor,
  computeTrailingStop,
  decideCandidate,
  seleccionarCandidatas,
  lugarParaNueva,
  type EvaluadaRadar,
  decideEtf,
  holdingsOverlap,
  isEligibleAsset,
  mergeThemes,
  overlapCaution,
  passesPreFilter,
  residentWeeks,
  planContribution,
  qualityBar,
  rankStocks,
  sectorFor,
  themesFor,
  hechosVigentes,
  simbolosConPuerta,
  VENTANAS_DIAS,
  VENTANA_MAXIMA_DIAS,
  type AssetInfo,
  type Candle,
  type CandidateEvent,
  type CandidateRow,
  type CardInput,
  type CardWriter,
  type ContributionPlan,
  type PlanVerification,
  verificationLabel,
  etfReasonText,
  PLAN_BLOCKERS,
  type CandidateVerifier,
  type CoreEarnings,
  type VerificationSummary,
  assessRegime,
  type EtfConfig,
  type EventClassifier,
  type FinnhubMetrics,
  type Fundamentals,
  type HechoExterno,
  type NewsItem,
  type Overlap,
  type PriceHistory,
  type QuarterStatement,
  type RadarPolicy,
  type RankedStock,
  type ScanStage,
  type SnapshotLite,
  type Statements,
  type SymbolProfile,
  type Tags,
  type TaxonomyConfig,
  topPicks,
  verificationOrder,
  returnPct,
  totalReturnPct,
} from "@thesis/core";
import { scanEventsFor, type EventScan } from "./radar-events.js";
import { VERIFY_PER_RUN_DEFAULT, verificacionGuardada, verifyFor, type VerifyBudget } from "./radar-verify.js";
import type { CarteraStore, RadarStore, TickerStore } from "./store.js";

/**
 * Radar (spec etapa 2): universo semanal reanudable, ranking contra pares, candidatos,
 * ETFs, refresco diario, plan del aporte y medición contra SPY. El modelo solo escribe y degrada.
 */
export interface FundamentalsSource {
  profile(symbol: string): Promise<SymbolProfile | null>;
  metrics(symbol: string): Promise<FinnhubMetrics | null>;
  peers(symbol: string): Promise<string[]>;
  recommendation(symbol: string): Promise<Fundamentals["analyst"]>;
  earningsSurprises(symbol: string): Promise<Fundamentals["earningsSurprises"]>;
  insiders(symbol: string, days: number, today: string): Promise<{ buys: number; sells: number }>;
  nextEarnings(symbol: string, today: string): Promise<string | null>;
}
export interface RadarDeps {
  store: CarteraStore & RadarStore & Pick<TickerStore, "news" | "upsertNews">;
  assets: { list(): Promise<AssetInfo[]>; snapshots(symbols: string[]): Promise<SnapshotLite[]> };
  fundamentals: FundamentalsSource;
  history: PriceHistory;
  cardWriter: CardWriter | null;
  taxonomy: TaxonomyConfig;
  etfs: EtfConfig[];
  policy: RadarPolicy;
  /** Días de decisión de la Fed (config/fomc.json). Sin esto el plan no mira el calendario. */
  fomc?: string[];
  /** Títulos de filings recientes del símbolo (contexto de la ficha). */
  filings: (symbol: string) => Promise<string[]>;
  /**
   * Filings que prueban una oferta de compra en curso (DEFM14A, PREM14A, SC 14D9, 425), con ventana de meses.
   * Va aparte de `filings` porque hay que buscarlos POR FORMULARIO: el DEFM14A de AES es del 15/5/2026 y quedaría
   * enterrado bajo las decenas de 8-K y Form 4 que presentó después.
   */
  filingsDeOferta: (symbol: string) => Promise<string[]>;
  /** Estados de la SEC (spec verificación §4). Sin él, el ranking usa solo Finnhub. */
  statements?: { quarters(symbol: string, today: string): Promise<Statements | null> } | null;
  /** Noticias por símbolo (Finnhub) para eventos materiales y analistas (spec verificación §5, §6). Sin él no se buscan. */
  news?: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> } | null;
  /** Clasificador de titulares (modelo). null con noticias = todo lo material queda `eventos_sin_clasificar`. */
  eventClassifier?: EventClassifier | null;
  /** Verificación web por candidata (spec 2026-09-10): solo para lo que queda COMPRAR. null = sin verificador. */
  verifier?: CandidateVerifier | null;
  /** Revisión antes de comprar (15/9): segunda búsqueda sobre lo que el plan compraría. null = sin revisor, no se exige. */
  reviewer?: PreTradeReviewer | null;
  log?: (msg: string, extra?: unknown) => void;
  onProgress?: (s: { done: number; total: number; stage: string }) => void;
  shouldStop?: () => boolean;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const ageDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY;
const FRESH_DAYS = 7;
const HISTORY_DAYS = 260;
/** Bono a 10 años en Yahoo (rendimiento × 10): base del régimen macro. */
export const TNX_SYMBOL = "^TNX";
const STATEMENTS_CONCURRENCY = 4;

// ---------- taxonomía ----------

export async function tagSymbol(deps: RadarDeps, symbol: string, profile: { industry: string | null; country: string | null } | null, proposedThemes: string[] = [], source: "regla" | "modelo" = "regla"): Promise<Tags> {
  const etf = deps.etfs.find((e) => e.symbol === symbol);
  const current = await deps.store.tags(symbol);
  const industry = profile?.industry ?? current?.industry ?? null;
  const byRule = themesFor({ symbol, industry, ...(etf ? { etf } : {}) }, deps.taxonomy);
  const merged = mergeThemes(current ? { themes: current.themes, source: current.themesSource } : null, source === "regla" ? byRule : proposedThemes, source, deps.taxonomy);
  const tags: Tags = {
    assetClass: current?.themesSource === "manual" ? current.assetClass : assetClassFor({ symbol, country: profile?.country ?? null, isEtf: !!etf }, deps.taxonomy),
    sector: current?.themesSource === "manual" ? current.sector : sectorFor(industry, deps.taxonomy),
    industry,
    themes: merged.themes,
    themesSource: merged.source,
  };
  await deps.store.saveTags(symbol, tags);
  if (industry && !deps.taxonomy.industryToSector[industry]) deps.log?.(`[radar] industria sin sector en config/taxonomia.json: "${industry}" (${symbol})`);
  return tags;
}

/** Aplica las reglas de taxonomía a símbolos ya conocidos (perfil o fundamentals). Manual no se pisa. */
export async function applyTaxonomy(deps: RadarDeps, symbols: string[]): Promise<number> {
  let n = 0;
  for (const s of symbols) {
    const sym = s.toUpperCase();
    const p = await deps.store.profile(sym);
    const f = p ? null : await deps.store.fundamentals(sym);
    await tagSymbol(deps, sym, p ? { industry: p.profile.industry, country: p.profile.country } : f ? { industry: f.industry, country: null } : null);
    n++;
  }
  return n;
}

// ---------- universo ----------

export interface ScanSummary {
  scanDate: string;
  listed: number;
  prefiltered: number;
  fundamentalsOk: number;
  excluded: number;
  errors: number;
  stopped: boolean;
}

export async function scanUniverse(deps: RadarDeps, opts: { scanDate: string; today: string }): Promise<ScanSummary> {
  const log = deps.log ?? (() => {});
  const { store, policy } = deps;
  const status = await store.scanStatus(opts.scanDate);
  let listed = Object.values(status).reduce((a, b) => a + b, 0);
  let prefiltered = status.alpaca_ok + status.finnhub_ok + status.error;

  // Fase A: lista + pre-filtro con precios de Alpaca. Solo si este barrido no empezó.
  if (listed === 0) {
    const assets = await deps.assets.list();
    listed = assets.length;
    const rows: Array<{ scanDate: string; symbol: string; stage: ScanStage; reason: string | null }> = [];
    const eligible: string[] = [];
    for (const a of assets) {
      const r = isEligibleAsset(a);
      if (r.ok) eligible.push(a.symbol);
      else rows.push({ scanDate: opts.scanDate, symbol: a.symbol, stage: "excluded", reason: r.reason ?? "no elegible" });
    }
    const snaps = await deps.assets.snapshots(eligible);
    prefiltered = 0;
    for (const s of snaps) {
      const r = passesPreFilter(s, policy.prefilter);
      if (r.ok) prefiltered++;
      rows.push({ scanDate: opts.scanDate, symbol: s.symbol, stage: r.ok ? "alpaca_ok" : "excluded", reason: r.reason ?? null });
    }
    await store.scanUpsert(rows);
    log(`[radar] barrido ${opts.scanDate}: ${listed} listados, ${prefiltered} pasan el pre-filtro`);
  }

  // Fase B: fundamentals de Finnhub para lo pendiente. Reanudable.
  const pending = await store.scanPending(opts.scanDate);
  const prices = new Map<string, number | null>();
  for (let i = 0; i < pending.length; i += 100) {
    for (const s of await deps.assets.snapshots(pending.slice(i, i + 100))) prices.set(s.symbol, s.price);
  }
  let fundamentalsOk = 0;
  let excluded = 0;
  let errors = 0;
  let stopped = false;
  let done = 0;
  for (const sym of pending) {
    if (deps.shouldStop?.()) {
      stopped = true;
      break;
    }
    try {
      const existing = await store.fundamentals(sym);
      if (existing && ageDays(existing.asOf, opts.today) < FRESH_DAYS) {
        await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "finnhub_ok", reason: "fundamentals frescos" }]);
        continue;
      }
      const priceUsd = prices.get(sym) ?? null;
      const profile = await deps.fundamentals.profile(sym);
      const metrics = await deps.fundamentals.metrics(sym);
      if (priceUsd === null || !profile || !metrics) {
        await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "excluded", reason: priceUsd === null ? "sin precio" : !profile ? "sin perfil" : "sin métricas" }]);
        excluded++;
        continue;
      }
      // Listado extranjero (Finnhub mapea ADRs a su bolsa local): la capitalización queda desconocida y,
      // si el volumen de Finnhub falta o no llega al umbral, se pide el consolidado US a Yahoo y se usa el mayor.
      const foreign = (!!profile.currency && profile.currency !== "USD") || (!!profile.country && profile.country !== "US");
      const finnhubVol = (metrics["3MonthAverageTradingVolume"] ?? 0) * 1e6 * priceUsd;
      let volumeOverrideUsd: number | null = null;
      if (finnhubVol < policy.quality.minDollarVolumeUsd) {
        const c = await deps.history.candles(sym, 45).catch(() => [] as Candle[]);
        const last30 = c.slice(-30);
        if (last30.length >= 10) volumeOverrideUsd = (last30.reduce((a, x) => a + x.volume, 0) / last30.length) * priceUsd;
      }
      const qb = qualityBar({ profile: { shareOutstanding: profile.shareOutstanding ?? null, currency: profile.currency ?? null, country: profile.country, industry: profile.industry, name: profile.name, marketCap: profile.marketCap ?? null }, metrics, priceUsd }, policy.quality, { volumeOverrideUsd, allowUnknownMcap: foreign });
      await store.saveProfile(profile);
      if (!qb.ok) {
        await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "excluded", reason: qb.reason ?? "quality bar" }]);
        excluded++;
        continue;
      }
      const peers = await deps.fundamentals.peers(sym);
      await store.saveFundamentals({ symbol: sym, asOf: opts.today, metrics, peers, industry: profile.industry, mcapUsd: qb.mcapUsd, dollarVolumeUsd: qb.dollarVolumeUsd!, priceUsd, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null, currency: profile.currency ?? null });
      await tagSymbol(deps, sym, { industry: profile.industry, country: profile.country });
      await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "finnhub_ok", reason: null }]);
      fundamentalsOk++;
    } catch (e) {
      await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "error", reason: String(e).slice(0, 200) }]);
      errors++;
      log(`[radar] ${sym} error`, { error: String(e).slice(0, 120) });
    } finally {
      done++;
      if (done % 25 === 0) deps.onProgress?.({ done, total: pending.length, stage: "finnhub" });
    }
  }
  deps.onProgress?.({ done, total: pending.length, stage: stopped ? "detenido" : "listo" });
  return { scanDate: opts.scanDate, listed, prefiltered, fundamentalsOk, excluded, errors, stopped };
}

// ---------- candidatos ----------

export async function candlesFor(deps: RadarDeps, symbols: string[]): Promise<{ candles: Record<string, Candle[]>; errors: Array<{ symbol: string; error: string }> }> {
  const candles: Record<string, Candle[]> = {};
  const errors: Array<{ symbol: string; error: string }> = [];
  for (let i = 0; i < symbols.length; i += 10) {
    const batch = symbols.slice(i, i + 10);
    const res = await Promise.allSettled(batch.map((s) => deps.history.candles(s, HISTORY_DAYS)));
    res.forEach((r, j) => {
      const sym = batch[j]!;
      if (r.status === "fulfilled") candles[sym] = r.value;
      else errors.push({ symbol: sym, error: String(r.reason) });
    });
  }
  for (const [sym, c] of Object.entries(candles)) if (c.length) await deps.store.upsertCandles(sym, c).catch(() => {});
  return { candles, errors };
}

/** 1 + la aparición anterior si fue hace ≤ 10 días (rank semanal con refrescos diarios en el medio). */
async function nthAppearanceFor(deps: RadarDeps, symbol: string, today: string): Promise<number> {
  const hist = await deps.store.candidateHistory(symbol, deps.policy.candidates.chronicWeeks + 1);
  // Semanas calendario consecutivas, no corridas: correr el ranking tres veces en una noche no vuelve
  // crónico a nadie. Se incluye `today` para que la semana en curso cuente ya en la primera corrida.
  return residentWeeks(hist.map((h) => h.candidateDate), today);
}

function ownMetrics(f: Fundamentals): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const axis of AXES) for (const spec of AXIS_METRICS[axis]) out[spec.key] = f.metrics[spec.key] ?? null;
  return out;
}

function emptyRow(date: string, symbol: string, kind: CandidateRow["kind"], verdict: CandidateRow["verdict"], close: number): CandidateRow {
  return { candidateDate: date, symbol, kind, verdict, score: null, axes: {}, peerGroup: [], rankInGroup: null, groupSize: null, close, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
}

export interface RankSummary {
  candidates: CandidateRow[];
  skipped: Array<{ symbol: string; reason: string }>;
  errors: Array<{ symbol: string; error: string }>;
}

/** Fundamentals frescos, restringidos a lo aprobado en el último barrido (lo excluido después no rankea aunque siga fresco). */
/**
 * El universo del ranking: lo que el último barrido dejó bien, con fundamentales frescas CONTADAS DESDE EL BARRIDO.
 * El 15/9 se contaban desde hoy: las del barrido del 7/9 (el del 13/9 no las volvió a pedir porque tenían 6 días)
 * quedaron viejas a mitad de semana, y un ranking tomó 37 empresas en vez de 2.724: el Radar pasó de 38 acciones a 5.
 */
export async function universoDelRanking(deps: Pick<RadarDeps, "store">, today: string): Promise<{ all: Map<string, Fundamentals>; scanDate: string | null; scanOk: number }> {
  const scanDate = await deps.store.latestScanDate();
  const fresh = await deps.store.freshFundamentals(FRESH_DAYS, scanDate && scanDate < today ? scanDate : today);
  const okList = scanDate ? await deps.store.scanSymbols(scanDate, "finnhub_ok") : null;
  const ok = okList ? new Set(okList) : null;
  return { all: new Map(fresh.filter((f) => !ok || ok.has(f.symbol)).map((f) => [f.symbol, f])), scanDate, scanOk: okList?.length ?? 0 };
}
async function rankableFundamentals(deps: RadarDeps, today: string): Promise<Map<string, Fundamentals>> {
  return (await universoDelRanking(deps, today)).all;
}
/** Por debajo de esta fracción del barrido, el universo está roto (fundamentales viejas) y el ranking no pisa el Radar. */
const UNIVERSO_MINIMO = 0.5;

/** Escribe la ficha de un candidato y aplica sus efectos (degradar, temas). Devuelve null si el modelo falló. */
async function writeCardFor(deps: RadarDeps, f: Fundamentals, r: RankedStock, verdict: "COMPRAR" | "OBSERVAR", d: { flags: string[]; close: number; stop: number | null; target: number | null; riskScore: number }, ins: { buys: number; sells: number } | null, extra: { core?: CoreEarnings | null; quarters?: QuarterStatement[] | undefined; events?: CandidateEvent[] | undefined } = {}): Promise<{ card: { summary: string; whyRanks: string; mainRisk: string; moat: string }; degrade: boolean; degradeReason: string | null } | null> {
  if (!deps.cardWriter) return null;
  const sym = f.symbol;
  const tags = (await deps.store.tags(sym)) ?? (await tagSymbol(deps, sym, { industry: f.industry, country: null }));
  const profile = await deps.store.profile(sym);
  const input: CardInput = { symbol: sym, name: profile?.profile.name ?? null, industry: f.industry, sector: tags.sector, themes: tags.themes, themeOptions: deps.taxonomy.themes, verdict, score: r.score, axes: r.axes, rankInGroup: r.rankInGroup, groupSize: r.groupSize, basis: r.basis, own: ownMetrics(f), medians: r.medians, peers: r.group, flags: d.flags, insiders: ins, analyst: f.analyst, surprises: f.earningsSurprises, filings: await deps.filings(sym).catch(() => []), close: d.close, stop: d.stop, target: d.target, riskScore: d.riskScore, ...(extra.quarters !== undefined ? { quarters: extra.quarters } : {}), ...(extra.core !== undefined ? { core: extra.core } : {}), ...(extra.events !== undefined ? { events: extra.events } : {}) };
  const c = await deps.cardWriter.write(input);
  if (c.themes.length) await tagSymbol(deps, sym, { industry: f.industry, country: null }, c.themes, "modelo");
  return { card: { summary: c.summary, whyRanks: c.whyRanks, mainRisk: c.mainRisk, moat: c.moat }, degrade: c.degrade, degradeReason: c.degradeReason ?? null };
}

/** Pide (o lee de caché, 7 días) los estados de `symbols`, recalcula sus métricas en `all` y las persiste. Devuelve el núcleo por símbolo (null = no hay). */
/** Estados guardados antes de la enmienda de calidad (2026-09-10) no traen minoritarios ni cuentas a cobrar: se piden de nuevo aunque estén frescos. */
const hasQualityFields = (st: Statements): boolean => st.quarters.every((q) => "noncontrolling" in q) && (st.core === null || "lastQuarterYoy" in st.core);

/** Estados del símbolo: los guardados si están frescos y completos; si no, se piden a la SEC y se guardan. Un fallo de red deja lo que había. */
export async function statementsFor(deps: RadarDeps, sym: string, today: string): Promise<Statements | null> {
  const src = deps.statements;
  if (!src) return null;
  let st = await deps.store.statements(sym);
  if (!st || ageDays(st.asOf, today) >= FRESH_DAYS || !hasQualityFields(st)) {
    const fetched = await src.quarters(sym, today).catch((e) => { deps.log?.(`[radar] estados de ${sym} fallaron`, { error: String(e).slice(0, 120) }); return undefined; });
    if (fetched !== undefined) {
      st = fetched ?? { symbol: sym, cik: "", asOf: today, quarters: [], core: null };
      await deps.store.saveStatements(st);
    }
  }
  return st ?? null;
}

/** Hechos externos vigentes del símbolo (17/9), para el ranking, el refresco y el comando mercado. Un fallo de lectura = sin hechos. */
export async function hechosDe(deps: Pick<RadarDeps, "store">, symbol: string, today: string): Promise<HechoExterno[]> {
  return hechosVigentes(await deps.store.hechos(symbol, addDays(today, -VENTANA_MAXIMA_DIAS)).catch(() => [] as HechoExterno[]), today);
}

export async function withStatements(deps: RadarDeps, all: Map<string, Fundamentals>, symbols: string[], today: string): Promise<Map<string, CoreEarnings | null>> {
  const cores = new Map<string, CoreEarnings | null>();
  if (!deps.statements) return cores;
  const { store } = deps;
  const pending = [...new Set(symbols)].filter((s) => all.has(s));
  for (let i = 0; i < pending.length; i += STATEMENTS_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + STATEMENTS_CONCURRENCY).map(async (sym) => {
      const st = await statementsFor(deps, sym, today);
      const core = st?.core ?? null;
      cores.set(sym, core);
      const f = all.get(sym)!;
      const conCore = applyCoreMetrics(f, core, f.priceUsd);
      // Saneo antes de puntuar: se anulan los números que harían parecer mejor a la empresa sin medir el
      // negocio (ROE con patrimonio borrado, margen neto inflado por ganancia no operativa). Nunca se
      // anula un castigo. `metricsRaw` conserva lo que vino de la fuente.
      const limpio = sanitizeMetrics(conCore.metrics);
      if (limpio.removed.length) deps.log?.(`[radar] ${sym}: ${limpio.removed.length} métrica(s) fuera del puntaje`, { removed: limpio.removed });
      const updated = { ...conCore, metrics: limpio.metrics };
      all.set(sym, updated);
      await store.saveFundamentals(updated);
    }));
  }
  return cores;
}

/** Barrido de noticias del símbolo (ventana completa en el ranking, incremental en el refresco). null si el Radar no tiene fuente de noticias. */
async function scanCandidateEvents(deps: RadarDeps, sym: string, today: string, full: boolean): Promise<EventScan | null> {
  if (!deps.news) return null;
  const profile = await deps.store.profile(sym);
  return scanEventsFor({ store: deps.store, news: deps.news, classifier: deps.eventClassifier ?? null, ...(deps.log ? { log: deps.log } : {}) }, sym, { today, name: profile?.profile.name ?? null, full });
}

/**
 * Símbolos en cartera, en mayúsculas. Una posición tiene un solo stop, el de seguimiento que muestra Cartera;
 * lo que no está en cartera es una compra nueva y su stop lleva el aire mínimo de `entryStop` (2026-09-13).
 */
export async function heldSymbols(store: Pick<CarteraStore, "positions">): Promise<Set<string>> {
  return new Set((await store.positions()).map((p) => p.symbol.toUpperCase()));
}

/** Por qué una evaluada que pasó los filtros no quedó en el Radar (24/9: antes no se guardaba). */
function motivoFueraDelCorte(verdict: "COMPRAR" | "OBSERVAR", c: RadarPolicy["candidates"]): string {
  const tope = Math.max(c.maxRows ?? c.top * 2, c.top);
  return verdict === "OBSERVAR" ? `OBSERVAR fuera de las ${c.top} por puntaje: el resto del tope es para lo que se puede comprar` : `COMPRAR sin lugar: el tope de ${tope} filas está lleno`;
}

/** Lo que comparten las filas de una corrida: lo que ya se calculó una vez y las listas donde se anotan las fallas. */
interface ContextoFila {
  today: string;
  portfolioUsd: number | null;
  held: Set<string>;
  spyClose: number | null;
  verifyBudget: VerifyBudget;
  errors: Array<{ symbol: string; error: string }>;
  skipped: Array<{ symbol: string; reason: string }>;
}

/**
 * La fila completa de una acción que entra al Radar: datos de Finnhub que solo valen para candidatas, noticias,
 * verificación y ficha, con las mismas reglas. La usan el ranking del domingo y, desde el 24/9, el refresco diario
 * cuando una COMPRAR nueva entra a mitad de semana: una sola construcción, no dos. null = quedó excluida o falló
 * (anotado en el contexto).
 */
async function filaDeAccion(deps: RadarDeps, ctx: ContextoFila, r: RankedStock, f0: Fundamentals, candles: Candle[], symCore: CoreEarnings | null | undefined, filings: string[], hechos: HechoExterno[]): Promise<CandidateRow | null> {
  const log = deps.log ?? (() => {});
  const { store, policy } = deps;
  const sym = r.symbol;
  let f = f0;
  try {
    // Datos que solo valen la pena para los candidatos.
    const [nextEarnings, ins, analyst, surprises] = await Promise.all([
      deps.fundamentals.nextEarnings(sym, ctx.today).catch(() => null),
      deps.fundamentals.insiders(sym, 90, ctx.today).catch(() => null),
      deps.fundamentals.recommendation(sym).catch(() => null),
      deps.fundamentals.earningsSurprises(sym).catch(() => null),
    ]);
    f = { ...f, nextEarnings, insiderBuys90d: ins?.buys ?? null, insiderSells90d: ins?.sells ?? null, analyst, earningsSurprises: surprises };
    await store.saveFundamentals(f);
    const nth = await nthAppearanceFor(deps, sym, ctx.today);
    const ev = await scanCandidateEvents(deps, sym, ctx.today, true);
    // Los filings de oferta y los hechos llegan ya pedidos (se piden para toda la preselección al elegir las filas):
    // un DEFM14A o un SC 14D9 prueban que el precio lo fija un acuerdo (AES, 16/9).
    const input = { f, candles, nthAppearance: nth, portfolioUsd: ctx.portfolioUsd, today: ctx.today, held: ctx.held.has(sym), filings, hechos, ...(deps.verifier ? { verificationVersion: deps.verifier.promptVersion } : {}), ...(symCore !== undefined ? { core: symCore } : {}), ...(ev ? { events: ev.events, eventsUnclassified: ev.unclassified, analystTargets: ev.analystTargets } : {}) };
    let d = decideCandidate(input, policy);
    if ("excluded" in d) {
      ctx.skipped.push({ symbol: sym, reason: d.reasons.join(",") });
      return null;
    }
    // Verificación web solo para lo que ya es COMPRAR por reglas: el dictamen vuelve a pasar por las reglas.
    // Un OBSERVAR no se verifica, pero muestra la que ya tiene guardada, igual que en el refresco (15/9).
    const verification = (await verifyIfBuy(deps, sym, d, ctx.today, ctx.verifyBudget)) ?? (await verificacionGuardada(deps, sym));
    if (verification !== undefined) {
      const again = decideCandidate({ ...input, verification }, policy);
      if (!("excluded" in again)) d = again;
    }
    let verdict = d.verdict;
    let degradedBy: string | null = null;
    let card: { summary: string; whyRanks: string; mainRisk: string; moat: string } | null = null;
    if (deps.cardWriter) {
      try {
        const w = await writeCardFor(deps, f, r, verdict, d, ins, { ...(symCore !== undefined ? { core: symCore } : {}), quarters: deps.statements ? ((await store.statements(sym))?.quarters.slice(-4) ?? []) : undefined, ...(ev ? { events: ev.events } : {}) });
        if (w) {
          card = w.card;
          if (w.degrade && verdict === "COMPRAR") {
            verdict = "OBSERVAR";
            degradedBy = "narrator";
            d.flags.push(`degradado: ${w.degradeReason ?? "sin motivo"}`);
          }
        }
      } catch (e) {
        ctx.errors.push({ symbol: sym, error: String(e) });
        log(`[radar] ficha falló para ${sym}`, { error: String(e).slice(0, 120) });
      }
    }
    const fila: CandidateRow = { ...emptyRow(ctx.today, sym, "stock", verdict, d.close), score: r.score, axes: r.axes, peerGroup: r.group, rankInGroup: r.rankInGroup, groupSize: r.groupSize, entryLow: d.entryLow, entryHigh: d.entryHigh, stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore, flags: d.flags, nthAppearance: nth, summary: card?.summary ?? null, whyRanks: card?.whyRanks ?? null, mainRisk: card?.mainRisk ?? null, moat: card?.moat ?? null, degradedBy, promptVersion: deps.cardWriter?.promptVersion ?? null, spyClose: ctx.spyClose, events: ev?.events ?? [], analystTargets: ev?.analystTargets ?? null, verification: verification ?? null, entry: d.entry };
    log(`[radar] ${sym} ${verdict}`, { score: r.score, rank: `${r.rankInGroup}/${r.groupSize}` });
    return fila;
  } catch (e) {
    ctx.errors.push({ symbol: sym, error: String(e) });
    return null;
  }
}

export async function rankRadar(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null }): Promise<RankSummary> {
  const log = deps.log ?? (() => {});
  const { store, policy } = deps;
  const held = await heldSymbols(store);
  const { all, scanDate, scanOk } = await universoDelRanking(deps, opts.today);
  // Con el universo roto no se rearma nada: una lista chica reemplazaría a la buena (15/9: 37 de 2.724, Radar de 38 a 5).
  if (scanOk > 0 && all.size < scanOk * UNIVERSO_MINIMO) {
    const error = `universo rankeable: ${all.size} de ${scanOk} del barrido del ${scanDate}; faltan fundamentales frescas, así que no se rearma el Radar`;
    log(`[radar] ${error}`);
    return { candidates: [], skipped: [], errors: [{ symbol: "*", error }] };
  }
  // La puerta de entrada (17/9): símbolos con un hecho verificado de guía subida en 90 días. Se piden sus estados junto
  // con la preselección y se evalúan con las mismas reglas; si quedan COMPRAR, entran a las filas aunque el tope esté
  // lleno (son como mucho PUERTA_TOPE). FIVE en el puesto 412 con la guía subida dos veces es el caso.
  const puerta = simbolosConPuerta(await store.hechosPorTipo("guia", addDays(opts.today, -VENTANAS_DIAS.guia)).catch(() => [] as HechoExterno[]), opts.today).filter((s) => all.has(s));
  // Dos pasadas (spec verificación §4): la primera con Finnhub elige a quién pedirle estados; la segunda rankea con la ganancia núcleo.
  const first = rankStocks(all, policy.weights).ranked.slice(0, policy.candidates.preselect);
  const cores = await withStatements(deps, all, [...first.flatMap((r) => [r.symbol, ...r.group]), ...puerta], opts.today);
  const { ranked, skipped } = rankStocks(all, policy.weights);
  const pre = ranked.slice(0, policy.candidates.preselect);
  const porPuerta = new Set(puerta.filter((s) => !pre.some((r) => r.symbol === s)));
  const preConPuerta: RankedStock[] = [...pre, ...[...porPuerta].map((s) => ranked.find((r) => r.symbol === s)).filter((r): r is RankedStock => !!r)];
  const coreOf = (sym: string): CoreEarnings | null | undefined => (deps.statements ? (cores.get(sym) ?? null) : undefined);
  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  if (spy.length) await store.upsertCandles("SPY", spy).catch(() => {});
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const { candles, errors } = await candlesFor(deps, preConPuerta.map((r) => r.symbol));
  const verifyBudget: VerifyBudget = { left: policy.candidates.verifyPerRun ?? VERIFY_PER_RUN_DEFAULT };

  // Filtro técnico sobre TODA la pre-selección: entran las `top` mejores por puntaje y, además, cualquier COMPRAR
  // que quede abajo del corte, hasta `maxRows` (16/9: 13 COMPRAR con puestos 77 a 149 no se veían). El filtro es
  // puro y las velas de la preselección ya están bajadas, así que evaluarlas todas no cuesta un pedido más.
  // Los formularios de oferta y los hechos se piden acá, para TODAS las filas (17/9): una empresa vendida por contrato
  // no puede contar como COMPRAR al elegir qué se guarda. Se cachean para no volver a pedirlos abajo.
  const filingsPor = new Map<string, string[]>();
  const hechosPor = new Map<string, HechoExterno[]>();
  const evaluadas: Array<{ item: RankedStock; verdict: "COMPRAR" | "OBSERVAR" }> = [];
  // La consulta en vivo a EDGAR falla abierta (una fila no puede perderse por eso), pero en silencio nadie se
  // entera de que esa fila corrió sin la regla de oferta (17/9): se cuenta y se avisa después del loop.
  let filingsTotal = 0;
  let filingsFallidos = 0;
  const posicion = new Map(ranked.map((r, i) => [r.symbol, i + 1]));
  const afuera: EvaluadaRadar[] = [];
  const evaluada = (symbol: string, veredicto: EvaluadaRadar["veredicto"], motivo: string): EvaluadaRadar => ({ fecha: opts.today, symbol, posicion: posicion.get(symbol) ?? null, veredicto, motivo, origen: "ranking" });
  for (const r of preConPuerta) {
    const c = candles[r.symbol];
    if (!c) {
      afuera.push(evaluada(r.symbol, null, "sin velas"));
      continue;
    }
    const f = all.get(r.symbol)!;
    const rCore = coreOf(r.symbol);
    filingsTotal++;
    const filings = await deps.filingsDeOferta(r.symbol).catch(() => { filingsFallidos++; return [] as string[]; });
    const hechos = await hechosDe(deps, r.symbol, opts.today);
    filingsPor.set(r.symbol, filings);
    hechosPor.set(r.symbol, hechos);
    const d = decideCandidate({ f, candles: c, nthAppearance: 1, portfolioUsd: opts.portfolioUsd, today: opts.today, filings, hechos, ...(rCore !== undefined ? { core: rCore } : {}) }, policy);
    if ("excluded" in d) {
      skipped.push({ symbol: r.symbol, reason: d.reasons.join(",") });
      afuera.push(evaluada(r.symbol, null, d.reasons.join(",")));
      continue;
    }
    evaluadas.push({ item: r, verdict: d.verdict });
  }
  if (filingsFallidos > 0) {
    log(`[radar] formularios de oferta: ${filingsFallidos} de ${filingsTotal} consultas fallaron: esas filas se evaluaron sin la regla de oferta`);
    errors.push({ symbol: "*", error: `formularios de oferta: ${filingsFallidos} de ${filingsTotal} consultas fallaron` });
  }
  const kept: RankedStock[] = seleccionarCandidatas(evaluadas, { top: policy.candidates.top, maxRows: policy.candidates.maxRows });
  for (const e of evaluadas) if (porPuerta.has(e.item.symbol) && e.verdict === "COMPRAR" && !kept.includes(e.item)) kept.push(e.item);
  for (const e of evaluadas) if (!kept.includes(e.item)) afuera.push(evaluada(e.item.symbol, e.verdict, motivoFueraDelCorte(e.verdict, policy.candidates)));

  const rows: CandidateRow[] = [];
  const ctx: ContextoFila = { today: opts.today, portfolioUsd: opts.portfolioUsd, held, spyClose, verifyBudget, errors, skipped };
  for (const r of kept) {
    const fila = await filaDeAccion(deps, ctx, r, all.get(r.symbol)!, candles[r.symbol]!, coreOf(r.symbol), filingsPor.get(r.symbol) ?? [], hechosPor.get(r.symbol) ?? []);
    if (fila) rows.push(fila);
    else afuera.push(evaluada(r.symbol, null, skipped.find((x) => x.symbol === r.symbol)?.reason ?? "falló al completar la fila"));
  }
  await store.guardarEvaluadas(afuera).catch((e) => log(`[radar] no se pudieron guardar las evaluadas: ${String(e).slice(0, 120)}`));

  // ETFs curados.
  const { candles: etfCandles, errors: etfErrors } = await candlesFor(deps, deps.etfs.map((e) => e.symbol));
  errors.push(...etfErrors);
  for (const cfg of deps.etfs) {
    const c = etfCandles[cfg.symbol];
    if (!c) continue;
    const d = decideEtf(cfg, c, spy, policy.technical, { newEntry: !held.has(cfg.symbol) });
    if ("excluded" in d) {
      skipped.push({ symbol: cfg.symbol, reason: d.reasons.join(",") });
      continue;
    }
    await tagSymbol(deps, cfg.symbol, { industry: null, country: "US" });
    rows.push({ ...emptyRow(opts.today, cfg.symbol, "etf", d.verdict, d.close), axes: { rs3m: d.rs3m, rs6m: d.rs6m, rs12m: d.rs12m, distSma200Pct: d.distSma200Pct, atrPct: d.atrPct }, entry: d.entry, entryLow: d.entry?.low ?? d.close, entryHigh: d.entry?.high ?? Math.round(d.close * 102) / 100, stop: d.stop, target: d.target, flags: [...d.reasons, ...d.limitations], spyClose });
  }
  await store.upsertCandidates(rows);
  // Lo que hoy quedó excluido no puede seguir en pantalla con los números de la corrida anterior del mismo
  // día. MIRG.BA el 13/9: el motor empezó a excluirla por el split sin ajustar y su fila de la mañana
  // sobrevivió, mostrando la fuerza relativa de −92,68% que el arreglo venía justamente a sacar.
  // Solo se poda si la corrida produjo filas de esa familia: un barrido que falló entero no borra nada.
  await pruneFamilias(store, opts.today, rows);
  return { candidates: rows, skipped, errors };
}

/** Borra, por familia, las filas de hoy que esta corrida no volvió a escribir. */
export async function pruneFamilias(store: Pick<RadarStore, "pruneCandidates">, today: string, rows: CandidateRow[]): Promise<void> {
  const porTipo = new Map<CandidateRow["kind"], string[]>();
  for (const r of rows) porTipo.set(r.kind, [...(porTipo.get(r.kind) ?? []), r.symbol]);
  for (const [kind, symbols] of porTipo) await store.pruneCandidates(today, kind, symbols).catch(() => 0);
}

/** Refresco diario: velas nuevas → cierre, stop, objetivo, filtros y verdict. Conserva score, ficha y aparición. */
export async function refreshRadar(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null; only?: string[] }): Promise<{ refreshed: number; errors: Array<{ symbol: string; error: string }> }> {
  const { store, policy } = deps;
  const todas = await store.latestCandidates();
  // Refresco parcial (15/9): solo los símbolos recién verificados. Nunca cambia la fecha de la familia: el Radar es
  // "las filas de la última fecha", y una sola fila con fecha nueva dejaría sola a esa. Si la corrida del día no
  // pasó todavía, no se toca nada (la corrida completa las va a traer).
  const soloEstos = opts.only ? new Set(opts.only.map((s) => s.toUpperCase())) : null;
  if (soloEstos && todas.some((c) => (c.kind === "stock" || c.kind === "etf") && c.candidateDate !== opts.today)) return { refreshed: 0, errors: [] };
  const latest = soloEstos ? todas.filter((c) => soloEstos.has(c.symbol.toUpperCase())) : todas;
  if (!latest.length) return { refreshed: 0, errors: [] };
  const held = await heldSymbols(store);
  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const { candles, errors } = await candlesFor(deps, latest.map((c) => c.symbol));
  const needCards = deps.cardWriter && latest.some((c) => c.kind === "stock" && c.summary === null);
  const ranked = needCards ? new Map(rankStocks(await rankableFundamentals(deps, opts.today), policy.weights).ranked.map((r) => [r.symbol, r])) : null;
  const rows: CandidateRow[] = [];
  const verifyBudget: VerifyBudget = { left: policy.candidates.verifyPerRun ?? VERIFY_PER_RUN_DEFAULT };
  // Igual que en `rankRadar`: la consulta en vivo a EDGAR falla abierta por fila, pero se cuenta para avisar.
  let filingsTotal = 0;
  let filingsFallidos = 0;
  // Por convicción: el presupuesto de verificación va primero a lo que el plan va a comprar (ver `verificationOrder`).
  for (const prev of verificationOrder(latest, await store.allTags())) {
    // Solo la familia US: Argentina y seguimiento tienen su propio refresco.
    if (prev.kind !== "stock" && prev.kind !== "etf") continue;
    const c = candles[prev.symbol];
    if (!c || !c.length) continue;
    if (prev.kind === "etf") {
      const cfg = deps.etfs.find((e) => e.symbol === prev.symbol);
      if (!cfg) continue;
      const d = decideEtf(cfg, c, spy, policy.technical, { newEntry: !held.has(cfg.symbol) });
      if ("excluded" in d) continue;
      rows.push({ ...prev, candidateDate: opts.today, verdict: d.verdict, close: d.close, entry: d.entry, entryLow: d.entry?.low ?? d.close, entryHigh: d.entry?.high ?? Math.round(d.close * 102) / 100, stop: d.stop, target: d.target, flags: [...d.reasons, ...d.limitations], axes: { rs3m: d.rs3m, rs6m: d.rs6m, rs12m: d.rs12m, distSma200Pct: d.distSma200Pct, atrPct: d.atrPct }, spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });
      continue;
    }
    const f = await store.fundamentals(prev.symbol);
    if (!f) {
      errors.push({ symbol: prev.symbol, error: "sin fundamentals" });
      continue;
    }
    // Solo se aísla lo que puede fallar por I/O externo (lectura de estados, barrido de noticias): un error acá
    // no debe perder la fila del símbolo, así que no se propaga; el candidato sigue con lo que ya tenía
    // (`eventsUnclassified` true, `events` de la corrida anterior) hasta el próximo intento.
    let core: CoreEarnings | null | undefined;
    let ev: EventScan | null;
    try {
      // Se piden de nuevo solo si vencieron (7 días) o vienen del formato anterior a la enmienda de calidad.
      core = deps.statements ? ((await statementsFor(deps, prev.symbol, opts.today))?.core ?? null) : undefined;
      ev = await scanCandidateEvents(deps, prev.symbol, opts.today, false);
    } catch (e) {
      errors.push({ symbol: prev.symbol, error: String(e) });
      core = undefined;
      ev = null;
    }
    const evEvents = ev?.events ?? prev.events ?? [];
    const eventsUnclassified = ev ? ev.unclassified : true;
    // La verificación guardada entra desde la PRIMERA decisión. Si se pasaba solo cuando el símbolo quedaba
    // COMPRAR, un OBSERVAR conservaba su dictamen en la columna y lo perdía en las banderas: la fila decía
    // "con reservas" en la ficha y no lo mostraba, y esa salvedad dejaba de contar (SOLV, TER y VIST el 11/9).
    // Y es la de la tabla, no la copia de la fila anterior (15/9, BLBD): sin verificador, la de la fila.
    const guardada = deps.verifier ? await verificacionGuardada(deps, prev.symbol) : prev.verification;
    // Igual que en la corrida completa: un DEFM14A o un SC 14D9 sacan la fila del plan (AES, 16/9).
    filingsTotal++;
    const filingsPrev = await deps.filingsDeOferta(prev.symbol).catch(() => { filingsFallidos++; return [] as string[]; });
    const hechosPrev = await hechosDe(deps, prev.symbol, opts.today);
    const input = { f, candles: c, nthAppearance: prev.nthAppearance, portfolioUsd: opts.portfolioUsd, today: opts.today, held: held.has(prev.symbol.toUpperCase()), filings: filingsPrev, hechos: hechosPrev, ...(deps.verifier ? { verificationVersion: deps.verifier.promptVersion } : {}), ...(core !== undefined ? { core } : {}), events: evEvents, eventsUnclassified, analystTargets: ev?.analystTargets ?? prev.analystTargets ?? null, ...(guardada ? { verification: guardada } : {}) };
    let d = decideCandidate(input, policy);
    let verification: VerificationSummary | null | undefined = guardada;
    if (!("excluded" in d)) {
      const v = await verifyIfBuy(deps, prev.symbol, d, opts.today, verifyBudget);
      if (v !== undefined) {
        verification = v;
        const again = decideCandidate({ ...input, verification: v }, policy);
        if (!("excluded" in again)) d = again;
      }
    }
    if ("excluded" in d) {
      // El stop se recalcula con las velas de hoy. Antes se arrastraba el de `prev` mientras el cierre sí se
      // actualizaba: BEAM quedó con el stop congelado en 27,13 desde el 7/9 mientras el precio caía a 24,37,
      // así que la fila mostraba un nivel de salida que ya no correspondía a ninguna vela.
      rows.push({ ...prev, candidateDate: opts.today, verdict: "OBSERVAR", close: c[c.length - 1]!.close, stop: computeTrailingStop(c), entry: null, flags: [...prev.flags.filter((x) => !x.startsWith("degradado")), ...d.reasons], spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, events: evEvents, analystTargets: ev?.analystTargets ?? prev.analystTargets ?? null });
      continue;
    }
    let degraded = prev.degradedBy === "narrator";
    let card = { summary: prev.summary, whyRanks: prev.whyRanks, mainRisk: prev.mainRisk, moat: prev.moat };
    let degradeFlag: string | null = null;
    // Ficha pendiente (cuota agotada en el ranking): se completa acá, con las mismas reglas.
    if (prev.summary === null && deps.cardWriter && ranked) {
      const r = ranked.get(prev.symbol);
      if (r) {
        try {
          const w = await writeCardFor(deps, f, r, d.verdict, d, f.insiderBuys90d === null ? null : { buys: f.insiderBuys90d, sells: f.insiderSells90d ?? 0 }, { ...(core !== undefined ? { core } : {}), quarters: deps.statements ? ((await store.statements(prev.symbol))?.quarters.slice(-4) ?? []) : undefined, events: evEvents });
          if (w) {
            card = w.card;
            if (w.degrade && d.verdict === "COMPRAR") {
              degraded = true;
              degradeFlag = `degradado: ${w.degradeReason ?? "sin motivo"}`;
            }
          }
        } catch (e) {
          errors.push({ symbol: prev.symbol, error: String(e) });
        }
      }
    }
    rows.push({ ...prev, candidateDate: opts.today, verdict: degraded && d.verdict === "COMPRAR" ? "OBSERVAR" : d.verdict, degradedBy: degraded ? "narrator" : null, ...card, promptVersion: prev.promptVersion ?? deps.cardWriter?.promptVersion ?? null, close: d.close, entryLow: d.entryLow, entryHigh: d.entryHigh, stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore, flags: [...d.flags, ...prev.flags.filter((x) => x.startsWith("degradado")), ...(degradeFlag ? [degradeFlag] : [])], spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, events: evEvents, analystTargets: ev?.analystTargets ?? prev.analystTargets ?? null, verification: verification ?? null, entry: d.entry });
  }
  if (filingsFallidos > 0) {
    deps.log?.(`[radar] formularios de oferta: ${filingsFallidos} de ${filingsTotal} consultas fallaron: esas filas se evaluaron sin la regla de oferta`);
    errors.push({ symbol: "*", error: `formularios de oferta: ${filingsFallidos} de ${filingsTotal} consultas fallaron` });
  }
  // El refresco parcial (tras verificar) no suma filas: si lo hiciera, cambiaría el Radar a mitad de la mañana.
  const salen = soloEstos ? [] : await sumarNuevasDelDia(deps, { today: opts.today, portfolioUsd: opts.portfolioUsd, held, spyClose, verifyBudget, errors, skipped: [] }, latest, rows);
  const quedan = rows.filter((r) => !(r.kind === "stock" && salen.includes(r.symbol)));
  await store.upsertCandidates(quedan);
  if (salen.length) await store.pruneCandidates(opts.today, "stock", quedan.filter((r) => r.kind === "stock").map((r) => r.symbol));
  return { refreshed: quedan.length, errors };
}

/**
 * ¿Por qué no está este símbolo en el Radar? (24/9: de trece COMPRAR que faltaban, nueve no tenían respuesta). En
 * orden: está (y en qué fila); quedó afuera y con qué motivo (`radar_evaluadas`, dos semanas); o ni llegó a evaluarse,
 * con su puesto en el ranking contra el tamaño de la preselección. Solo lectura.
 */
export async function porQueNoEsta(deps: Pick<RadarDeps, "store" | "policy">, symbol: string, today: string): Promise<string[]> {
  const sym = symbol.toUpperCase();
  const fila = (await deps.store.latestCandidates()).find((c) => c.symbol.toUpperCase() === sym);
  if (fila) return [`${sym} está en el Radar: ${fila.kind}, ${fila.verdict}, fila del ${fila.candidateDate}`];
  const ev = await deps.store.evaluadas(sym, addDays(today, -14));
  if (ev.length) return ev.map((e) => `${e.fecha} · ${e.origen} · puesto ${e.posicion ?? "—"} · ${e.veredicto ?? "excluida"} · ${e.motivo}`);
  const { all } = await universoDelRanking(deps, today);
  if (!all.has(sym)) return [`${sym} no está en el universo del barrido (sin fundamentales frescas, o no pasó el filtro de calidad)`];
  const ranked = rankStocks(all, deps.policy.weights);
  const i = ranked.ranked.findIndex((r) => r.symbol === sym);
  if (i < 0) return [`${sym} no rankea: ${ranked.skipped.find((x) => x.symbol === sym)?.reason ?? "sin puntaje"}`];
  if (i < deps.policy.candidates.preselect) return [`${sym} está en el puesto ${i + 1} de ${ranked.ranked.length}, dentro de la preselección de ${deps.policy.candidates.preselect}, pero no hay registro de su evaluación en dos semanas: la próxima corrida del Radar lo escribe`];
  return [`${sym} está en el puesto ${i + 1} de ${ranked.ranked.length} por puntaje: fuera de la preselección de ${deps.policy.candidates.preselect}, así que no se evalúa`];
}

/**
 * A mitad de semana, la preselección del ranking se vuelve a evaluar con las velas del día, y una COMPRAR que no está en
 * el Radar entra con la misma regla del domingo (`lugarParaNueva`): en un lugar libre hasta el tope, o en el de la
 * OBSERVAR de peor puntaje fuera de las `top` que no esté en cartera (24/9: GLXY cruzó su media de 200 el lunes y el Radar
 * la veía recién el domingo siguiente, mientras sus COMPRAR bajaban de 52 a 31). La fila nueva se arma con
 * `filaDeAccion`, igual que en el ranking, y entra solo si al completarse sigue COMPRAR.
 *
 * Agrega las filas a `rows` y devuelve los símbolos que salen. Cada evaluada que no entra, y cada fila que cede su
 * lugar, queda en `radar_evaluadas` con su motivo.
 */
async function sumarNuevasDelDia(deps: RadarDeps, ctx: ContextoFila, latest: CandidateRow[], rows: CandidateRow[]): Promise<string[]> {
  const log = deps.log ?? (() => {});
  const { policy, store } = deps;
  const { all, scanOk } = await universoDelRanking(deps, ctx.today);
  if (!all.size || (scanOk > 0 && all.size < scanOk * UNIVERSO_MINIMO)) return [];
  const ranked = rankStocks(all, policy.weights).ranked;
  const posicion = new Map(ranked.map((r, i) => [r.symbol, i + 1]));
  const yaEstan = new Set(latest.map((c) => c.symbol.toUpperCase()));
  const nuevas = ranked.slice(0, policy.candidates.preselect).filter((r) => !yaEstan.has(r.symbol.toUpperCase()));
  if (!nuevas.length) return [];
  const { candles } = await candlesFor(deps, nuevas.map((r) => r.symbol));
  const afuera: EvaluadaRadar[] = [];
  const evaluada = (symbol: string, veredicto: EvaluadaRadar["veredicto"], motivo: string): EvaluadaRadar => ({ fecha: ctx.today, symbol, posicion: posicion.get(symbol) ?? null, veredicto, motivo, origen: "refresco" });
  const comprables: Array<{ r: RankedStock; core: CoreEarnings | null | undefined; filings: string[]; hechos: HechoExterno[] }> = [];
  let fallidos = 0;
  for (const r of nuevas) {
    const c = candles[r.symbol];
    if (!c || !c.length) {
      afuera.push(evaluada(r.symbol, null, "sin velas"));
      continue;
    }
    const core = deps.statements ? ((await statementsFor(deps, r.symbol, ctx.today).catch(() => null))?.core ?? null) : undefined;
    const filings = await deps.filingsDeOferta(r.symbol).catch(() => { fallidos++; return [] as string[]; });
    const hechos = await hechosDe(deps, r.symbol, ctx.today);
    const d = decideCandidate({ f: all.get(r.symbol)!, candles: c, nthAppearance: 1, portfolioUsd: ctx.portfolioUsd, today: ctx.today, filings, hechos, ...(core !== undefined ? { core } : {}) }, policy);
    if ("excluded" in d) afuera.push(evaluada(r.symbol, null, d.reasons.join(",")));
    else if (d.verdict === "OBSERVAR") afuera.push(evaluada(r.symbol, "OBSERVAR", "OBSERVAR: a mitad de semana entra solo lo que queda COMPRAR"));
    else comprables.push({ r, core, filings, hechos });
  }
  if (fallidos > 0) ctx.errors.push({ symbol: "*", error: `formularios de oferta (nuevas del día): ${fallidos} consultas fallaron` });

  const actuales = rows.filter((x) => x.kind === "stock").map((x) => ({ symbol: x.symbol, score: x.score, verdict: x.verdict as "COMPRAR" | "OBSERVAR" }));
  const salen: string[] = [];
  for (const { r, core, filings, hechos } of comprables) {
    const lugar = lugarParaNueva(actuales, ctx.held, { top: policy.candidates.top, maxRows: policy.candidates.maxRows });
    if (!lugar) {
      afuera.push(evaluada(r.symbol, "COMPRAR", `COMPRAR sin lugar: el tope de ${Math.max(policy.candidates.maxRows ?? policy.candidates.top * 2, policy.candidates.top)} filas no tiene ninguna OBSERVAR que pueda ceder su lugar`));
      continue;
    }
    const fila = await filaDeAccion(deps, ctx, r, all.get(r.symbol)!, candles[r.symbol]!, core, filings, hechos);
    if (!fila || fila.verdict !== "COMPRAR") {
      afuera.push(evaluada(r.symbol, fila ? (fila.verdict === "COMPRAR" ? "COMPRAR" : "OBSERVAR") : null, fila ? `al completar la fila quedó ${fila.verdict}` : (ctx.skipped.find((x) => x.symbol === r.symbol)?.reason ?? "falló al completar la fila")));
      continue;
    }
    rows.push(fila);
    actuales.push({ symbol: fila.symbol, score: fila.score, verdict: "COMPRAR" });
    if (!lugar.libre) {
      salen.push(lugar.sale);
      actuales.splice(actuales.findIndex((a) => a.symbol === lugar.sale), 1);
      afuera.push(evaluada(lugar.sale, "OBSERVAR", `salió del Radar: le cedió su lugar a ${fila.symbol}, que quedó COMPRAR`));
    }
    log(`[radar] ${fila.symbol} entra a mitad de semana${lugar.libre ? "" : ` en el lugar de ${lugar.sale}`}`);
  }
  await store.guardarEvaluadas(afuera).catch((e) => log(`[radar] no se pudieron guardar las evaluadas: ${String(e).slice(0, 120)}`));
  return salen;
}

/**
 * Verificación web para un candidato que quedó COMPRAR (acciones). `undefined` = no aplica (sin verificador, no es
 * COMPRAR o no es acción): la decisión no cambia. `null` = aplica pero no respondió: bandera pendiente.
 */
async function verifyIfBuy(deps: RadarDeps, sym: string, d: { verdict: "COMPRAR" | "OBSERVAR"; flags: string[] }, today: string, budget: VerifyBudget): Promise<VerificationSummary | null | undefined> {
  if (!deps.verifier || d.verdict !== "COMPRAR") return undefined;
  // Lo que una regla fija deja afuera del plan no se verifica (15/9): con 20 búsquedas por día, SNDK (subió más de 100%)
  // y los bancos sin estados se llevaban las primeras de la mañana y el plan igual no los compraba. Queda la guardada.
  if (d.flags.some((f) => PLAN_BLOCKERS[f])) return undefined;
  const profile = await deps.store.profile(sym).catch(() => null);
  const context = `banderas del Radar: ${d.flags.join(", ") || "ninguna"}`;
  return verifyFor(deps, sym, { today, name: profile?.profile.name ?? null, context, budget });
}

// ---------- medición ----------

export async function measureRadar(deps: Pick<RadarDeps, "store" | "history">, opts: { today: string }): Promise<{ candidates: Record<"7" | "30" | "90", number>; planLines: number }> {
  const out = { candidates: { "7": 0, "30": 0, "90": 0 } as Record<"7" | "30" | "90", number>, planLines: 0 };
  const cache = new Map<string, Candle[]>();
  const candlesOf = async (s: string) => {
    if (!cache.has(s)) cache.set(s, await deps.history.candles(s, HISTORY_DAYS).catch(() => []));
    return cache.get(s)!;
  };
  const firstOnOrAfter = (c: Candle[], date: string) => c.find((x) => x.date >= date) ?? null;
  for (const h of [7, 30, 90] as const) {
    for (const r of await deps.store.candidatesToMeasure(addDays(opts.today, -h), h)) {
      // Acciones argentinas contra el Merval (en pesos); los CEDEARs son un chequeo de precio, no una apuesta.
      if (r.kind === "cedear") continue;
      const target = addDays(r.candidateDate, h);
      const [own, spy] = await Promise.all([candlesOf(r.symbol), candlesOf(r.kind === "ar" ? AR_BENCHMARK : "SPY")]);
      const a = firstOnOrAfter(own, target);
      const b = firstOnOrAfter(spy, target);
      if (!a || !b || r.spyClose === null || r.close <= 0) continue;
      const alpha = alphaPct(r.close, a.close, r.spyClose, b.close);
      const m = h === 7 ? { close7d: a.close, spy7d: b.close, alpha7dPct: alpha } : h === 30 ? { close30d: a.close, spy30d: b.close, alpha30dPct: alpha } : { close90d: a.close, spy90d: b.close, alpha90dPct: alpha };
      await deps.store.setCandidateMeasurement(r.candidateDate, r.symbol, m);
      out.candidates[String(h) as "7" | "30" | "90"]++;
    }
  }
  for (const p of await deps.store.plansToMeasure(opts.today)) {
    const base = `${p.month}-01`;
    let changed = false;
    const lines = [...p.lines];
    for (const l of lines) {
      if (l.close === null || l.spyClose === null) continue;
      for (const h of [30, 90] as const) {
        const key = h === 30 ? "alpha30dPct" : "alpha90dPct";
        if (l[key] !== null || ageDays(base, opts.today) < h) continue;
        const [own, spy] = await Promise.all([candlesOf(l.symbol), candlesOf("SPY")]);
        const a = firstOnOrAfter(own, addDays(base, h));
        const b = firstOnOrAfter(spy, addDays(base, h));
        if (!a || !b) continue;
        l[key] = alphaPct(l.close, a.close, l.spyClose, b.close);
        changed = true;
        out.planLines++;
      }
    }
    if (changed) await deps.store.updatePlanLines(p.month, lines);
  }
  return out;
}

// ---------- solapamiento con la cartera ----------

const OVERLAP_SINCE_DAYS = 200;
/** Ventana de velas para el ATR de 14 ruedas del plan: sobra para 14 ruedas aun con feriados. */
const ATR_SINCE_DAYS = 60;

/**
 * Para cada COMPRAR del Radar, la posición tuya con la que más se mueve (correlación > 0.7, misma ventana que el
 * panel de riesgo). Velas guardadas de ambos lados; no pide nada a la red. Sin posiciones, nada que solapar.
 */
export async function candidateOverlap(store: Pick<CarteraStore, "positions"> & Pick<RadarStore, "candles">, candidates: CandidateRow[], coreSymbols: Iterable<string> = []): Promise<Record<string, Overlap>> {
  const buys = candidates.filter((c) => c.kind === "stock" && c.verdict === "COMPRAR").map((c) => c.symbol);
  if (!buys.length) return {};
  // El núcleo no cuenta (14/9): casi toda acción de EE.UU. se mueve con VTI, que es el mercado. Parecerse al mercado
  // no es duplicar una apuesta; la regla de diversificación sacaría a las buenas apenas el núcleo estuviera comprado.
  const core = new Set(coreSymbols);
  const positions = (await store.positions()).filter((p) => p.layer !== "nucleo" && !core.has(p.symbol));
  if (!positions.length) return {};
  const since = new Date(Date.now() - OVERLAP_SINCE_DAYS * 86_400_000).toISOString().slice(0, 10);
  const load = async (symbols: string[]) => {
    const out: Record<string, Candle[]> = {};
    await Promise.all(symbols.map(async (s) => { out[s] = await store.candles(s, since).catch(() => [] as Candle[]); }));
    return out;
  };
  const [cand, held] = await Promise.all([load(buys), load(positions.map((p) => p.symbol))]);
  return holdingsOverlap(cand, held);
}

// ---------- plan del aporte ----------

/**
 * Rearma el plan con el último monto que pidió el dueño (14/9). El plan es la única fuente de COMPRAR en todas las
 * pantallas, así que no puede quedar atrás del Radar: el 13/9 a la noche entraron ORRF y HSBC y el plan seguía siendo
 * el de las 16:37. Se llama después de cada corrida que cambia sus entradas (ranking, refresco, seguimiento, Cartera).
 * Sin plan previo no inventa uno: el monto lo elige el dueño.
 */
export async function replan(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null }): Promise<ContributionPlan | null> {
  const last = await deps.store.latestPlan();
  if (!last) return null;
  return buildContributionPlan(deps, { month: opts.today.slice(0, 7), portfolioUsd: opts.portfolioUsd, today: opts.today, amountUsd: last.totalUsd });
}

/**
 * Revisión antes de comprar (15/9): revisa lo que el plan vigente dejó pendiente (`reviewsPending`) y lo guarda. Quien
 * la llama rearma el plan después. `symbols` limita a cuáles (la API saltea los que fallaron hace poco).
 */
export async function reviewPending(deps: RadarDeps, opts: { today: string; symbols?: string[]; budget?: number }): Promise<{ reviewed: string[]; errors: Array<{ symbol: string; error: string }> }> {
  const reviewer = deps.reviewer;
  // Con el agente (22/9) la revisión la escribe el agente por cron: acá no se llama.
  if (!reviewer || reviewer.porAgente) return { reviewed: [], errors: [] };
  const plan = await deps.store.latestPlan();
  const pendientes = (opts.symbols ?? plan?.reviewsPending ?? []).slice(0, opts.budget ?? 6);
  const filas = new Map((await deps.store.latestCandidates()).map((c) => [c.symbol, c]));
  const veredictos = await deps.store.latestVerdicts();
  const reviewed: string[] = [];
  const errors: Array<{ symbol: string; error: string }> = [];
  for (const sym of pendientes) {
    const c = filas.get(sym);
    const v = veredictos.find((x) => x.symbol === sym);
    try {
      const name = (await deps.store.profile(sym).catch(() => null))?.profile.name ?? null;
      const r = await reviewer.review({
        symbol: sym, name, today: opts.today,
        verification: c?.verification ? { verdict: c.verification.verdict, reason: c.verification.reason, date: c.verification.date } : null,
        line: { kind: v?.verb === "SUMAR" ? "sumar" : "comprar", close: c?.close ?? v?.close ?? null, stop: c?.stop ?? v?.stop ?? null },
      });
      await deps.store.savePreTradeReview({ ...r, symbol: sym, date: opts.today, promptVersion: reviewer.promptVersion });
      reviewed.push(sym);
      deps.log?.(`[revisión] ${sym}: ${r.verdict} — ${r.reason}`);
    } catch (e) {
      errors.push({ symbol: sym, error: (e instanceof Error ? e.message : String(e)).slice(0, 200) });
    }
  }
  return { reviewed, errors };
}

export async function buildContributionPlan(deps: RadarDeps, opts: { month: string; portfolioUsd: number | null; amountUsd?: number; today?: string }): Promise<ContributionPlan> {
  const { store, policy } = deps;
  const positions = await store.positions();
  const risk = await store.latestRisk();
  const weights = new Map((risk?.report.weights ?? []).map((w) => [w.symbol, w]));
  const tags = await store.allTags();
  const verdicts = await store.latestVerdicts();
  const candidates = await store.latestCandidates();
  const closes: Record<string, number> = {};
  // El veredicto de Cartera se calcula en otro momento que el Radar, así que su cierre puede ser de otra
  // rueda. Manda el del Radar cuando existe: dos pantallas no pueden mostrar dos precios del mismo símbolo.
  for (const v of verdicts) closes[v.symbol] = v.close;
  for (const c of candidates) closes[c.symbol] = c.close;
  const portfolioValueUsd = opts.portfolioUsd ?? risk?.report.totalValue ?? policy.sizing.fallbackPortfolioUsd;
  const etfOf = (s: string) => deps.etfs.find((e) => e.symbol === s);
  const overweight = Object.fromEntries(Object.entries(risk?.report.concentration.byTheme ?? {}).filter(([, pct]) => pct > 40));
  const overlap = await candidateOverlap(store, candidates, deps.etfs.filter((e) => e.role === "nucleo").map((e) => e.symbol));
  // ATR de 14 ruedas de lo que el plan puede comprar o sumar: el stop no puede quedar dentro del ruido (14/9, TSM y APH).
  // Al día de la fila, no del calendario: el ATR tiene que ser el de las mismas velas que dieron el stop.
  const atrOf = new Map<string, number | null>();
  const fechaDe = new Map<string, string>([...verdicts.filter((v) => v.verb === "SUMAR").map((v) => [v.symbol, v.verdictDate] as const), ...candidates.filter((c) => c.verdict === "COMPRAR").map((c) => [c.symbol, c.candidateDate] as const)]);
  await Promise.all([...fechaDe].map(async ([sym, fecha]) => {
    const desde = new Date(Date.parse(fecha) - ATR_SINCE_DAYS * 86_400_000).toISOString().slice(0, 10);
    const velas = (await store.candles(sym, desde).catch(() => [] as Candle[])).filter((v) => v.date <= fecha);
    atrOf.set(sym, atr(velas, 14));
  }));
  // Régimen macro (pieza 4): el 10 años de Yahoo (^TNX); se guarda para que el panel lo lea sin volver a pedirlo.
  const tnx = await deps.history.candles(TNX_SYMBOL, HISTORY_DAYS).catch(() => [] as Candle[]);
  if (tnx.length) await store.upsertCandles(TNX_SYMBOL, tnx).catch(() => {});
  const regime = assessRegime(tnx);
  const conviction = new Map(topPicks(candidates, tags, overweight, 1000, overlap, regime).map((p) => [p.symbol, p.conviction]));
  // Coherencia (pieza 3): una posición subponderada no se suma si el ETF de su tema está en OBSERVAR (oro bajo la media con NEM).
  const etfObserved = candidates.filter((c) => c.kind === "etf" && c.verdict === "OBSERVAR");
  const sumarCaution = (symbol: string): string | null => {
    const themes = new Set(tags[symbol]?.themes ?? []);
    if (!themes.size) return null;
    const hit = etfObserved.find((e) => (deps.etfs.find((cfg) => cfg.symbol === e.symbol)?.themes ?? []).some((t) => themes.has(t)));
    // En palabras y solo los motivos (15/9: decía "QQQ está en OBSERVAR: bajo_stop", con el código crudo).
    const motivos = hit ? hit.flags.filter((f) => f !== "fr_sin_dividendos").map(etfReasonText) : [];
    return hit ? `el ETF de su tema (${hit.symbol}) está en OBSERVAR: ${motivos.join(", ") || "sin fuerza"}` : null;
  };
  const candidatePorSimbolo = new Map(candidates.map((c) => [c.symbol, c]));
  // Revisión antes de comprar (15/9): la de hoy, con el prompt vigente. Sin revisor no se exige (undefined); sin la de
  // hoy, pendiente (null): el plan la compra con el aviso en la línea (18/9) y la anota en `reviewsPending` para que se corra.
  const hoy = opts.today ?? todayLocal();
  const revisiones = deps.reviewer ? new Map((await store.preTradeReviews(hoy)).filter((r) => r.promptVersion === deps.reviewer!.promptVersion).map((r) => [r.symbol.toUpperCase(), r])) : null;
  const reviewOf = (sym: string): PlanReview | null | undefined => {
    if (!revisiones) return undefined;
    const r = revisiones.get(sym.toUpperCase());
    return r ? { verdict: r.verdict, reason: r.reason } : null;
  };
  // Verificación tal como la usa el plan (13/9): vigente = hecha con el cuestionario actual. Sin verificador no se
  // exige (undefined); con verificador y sin dictamen, pendiente (null): compra con el aviso en la línea (18/9).
  const planVerification = (v: VerificationSummary | null | undefined): PlanVerification | null | undefined => {
    if (!deps.verifier) return undefined;
    if (!v) return null;
    return { verdict: v.verdict, reason: v.reason, current: v.promptVersion === deps.verifier.promptVersion };
  };
  const plan = planContribution(
    {
      month: opts.month,
      portfolioValueUsd,
      positions: positions.map((p) => ({ symbol: p.symbol, valueUsd: weights.get(p.symbol)?.value ?? (closes[p.symbol] ?? p.avgCost) * p.quantity, assetClass: tags[p.symbol]?.assetClass ?? (etfOf(p.symbol) ? "etf" : p.market === "adr" ? "adr" : p.market === "ar" ? "accion_ar" : "accion_us"), ...(etfOf(p.symbol) || p.layer === "nucleo" ? { role: (etfOf(p.symbol)?.role ?? "nucleo") as EtfConfig["role"] } : {}) })),
      // El stop y el precio salen de la fila del Radar cuando el símbolo está en la corrida de hoy. Antes
      // el plan usaba los del veredicto de Cartera, calculados en otro momento: TSM mostraba 428,03 en el
      // plan y 433,24 en el Radar, con dos stops distintos, o sea dos órdenes para la misma posición.
      // Y el objetivo también: con el stop de un lado y el objetivo del otro, TSM el 13/9 mostraba 472,46 en el
      // plan y 498,44 en el Radar. Los dos números de una orden salen de la misma fila.
      sumarCandidates: verdicts.filter((v) => v.verb === "SUMAR").map((v) => {
        const c = candidatePorSimbolo.get(v.symbol);
        // Un SUMAR también es una compra: si el Radar lo verificó, el dictamen vale igual que para una nueva.
        return { symbol: v.symbol, valueUsd: weights.get(v.symbol)?.value ?? 0, weightPct: v.weightPct, stop: c ? c.stop : v.stop, target: c ? c.target : v.target, caution: sumarCaution(v.symbol), verification: c ? planVerification(c.verification) : undefined, atr: atrOf.get(v.symbol) ?? null, review: reviewOf(v.symbol) };
      }),
      // El plan reparte dólares: las filas argentinas (pesos) y los CEDEARs no entran.
      // Prioridad: acciones por convicción (la misma del panel "lo que más recomienda"), seguimiento por menor riesgo, ETFs por fuerza relativa 6m.
      buyCandidates: candidates
        .filter((c): c is CandidateRow & { kind: "stock" | "etf" | "watch" } => c.verdict === "COMPRAR" && (c.kind === "stock" || c.kind === "etf" || c.kind === "watch"))
        .map((c) => ({
          symbol: c.symbol, kind: c.kind, score: c.score, sizeUsd: c.sizeUsd, close: c.close, entryLow: c.entryLow, entryHigh: c.entryHigh, stop: c.stop, target: c.target,
          priority: c.kind === "stock" ? (conviction.get(c.symbol) ?? null) : c.kind === "watch" ? -(c.riskScore ?? 10) : (c.axes["rs6m"] ?? null),
          // La salvedad que más pesa al comprar: si se mueve como algo tuyo, la línea del plan lo dice.
          cautions: overlap[c.symbol] ? [overlapCaution(overlap[c.symbol]!)] : [],
          // Para lo que ya tenés manda Cartera (18/9): con REVISAR o VENDER el plan no la compra como nueva.
          cartera: (() => { const v = verdicts.find((x) => x.symbol.toUpperCase() === c.symbol.toUpperCase()); return v ? { verb: v.verb, reason: v.reason } : null; })(),
          // Verificación web (18/9): solo "evitar" la deja afuera; con reservas, pendiente o anterior entra con el aviso.
          verification: c.kind === "etf" ? undefined : planVerification(c.verification),
          // Salvedades de precio (consenso en el precio, subida de 12 meses): tampoco entran como nueva.
          flags: c.flags,
          // Cuándo comprarla: si está extendida, la línea del plan dice el nivel a esperar.
          entry: c.entry ?? null,
          // Para no comprar con el stop en el ruido ni algo que se mueve como lo que ya tenés (14/9).
          atr: atrOf.get(c.symbol) ?? null,
          overlap: overlap[c.symbol] ?? null,
          // Los ETFs no se revisan: no tienen hechos de una empresa que buscar.
          review: c.kind === "etf" ? undefined : reviewOf(c.symbol),
        })),
      coreEtfs: deps.etfs.filter((e) => e.role === "nucleo"),
      spyClose: candidates[0]?.spyClose ?? verdicts[0]?.spyClose ?? null,
      closes,
      regime,
      // Reunión de la Fed a 3 días hábiles o menos: el plan dice que el primer tramo va después (13/9).
      fomc: deps.fomc?.length ? { today: opts.today ?? new Date().toISOString().slice(0, 10), decisions: deps.fomc } : null,
    },
    policy.contribution,
    opts.amountUsd ? { amountUsd: opts.amountUsd } : {},
  );
  // Rendimiento TOTAL de los últimos 12 meses (con dividendos) para TODA línea, no solo el núcleo: es el número
  // con el que se compara una línea contra la alternativa de comprar el núcleo. Sin dividendos, un ETF de letras
  // aparecía en 0,0% y nadie lo notaba.
  const since = new Date(Date.now() - 420 * 86_400_000).toISOString().slice(0, 10);
  for (const l of plan.lines) {
    const candles = await store.candles(l.symbol, since).catch(() => [] as Candle[]);
    const r = candles.length >= 200 ? totalReturnPct(candles, Math.min(252, candles.length - 1)) : null;
    l.ret12mPct = r?.pct ?? null;
    l.ret12mPartial = r?.partial ?? null;
    // De qué rueda es el precio de la línea: la última vela con ese cierre (15/9: "candidatos del 15/9" con cierres del
    // 14/9 y nada lo decía). Si ninguna vela lo tiene, sin fecha antes que inventarla.
    l.closeDate = l.close === null ? null : ([...candles].reverse().find((c) => Math.abs(c.close - l.close!) < 0.005)?.date ?? null);
  }
  // Por qué cambió el plan (15/9): con qué datos entró cada símbolo, comparado con la versión anterior. Se toman
  // también los que estaban en el plan anterior, para poder decir por qué salieron.
  const anterior = await store.latestPlan();
  // El mismo orden que el motivo de la exclusión (15/9: LNC decía "anterior" acá y "con reservas" en la lista).
  const verificacionDe = (c: CandidateRow): string | null => (c.kind === "etf" ? null : verificationLabel(planVerification(c.verification)));
  const inputs: Record<string, PlanSymbolInput> = {};
  const fueSumar = (sym: string) => [...plan.lines, ...(anterior?.lines ?? [])].some((l) => l.symbol === sym && l.kind === "sumar");
  for (const sym of new Set([...plan.lines, ...(plan.leftOut ?? []), ...(anterior?.lines ?? [])].map((x) => x.symbol))) {
    const c = candidatePorSimbolo.get(sym);
    const v = verdicts.find((x) => x.symbol === sym);
    const rev = c?.kind === "etf" ? undefined : reviewOf(sym);
    const review = rev === undefined ? undefined : rev === null ? "pendiente" : rev.verdict;
    if (fueSumar(sym) && v) inputs[sym] = { kind: "posicion", verdict: v.verb, close: c ? c.close : v.close, stop: c ? c.stop : v.stop, verification: c ? verificacionDe(c) : null, ...(review ? { review } : {}) };
    else if (c) inputs[sym] = { kind: c.kind, verdict: c.verdict, close: c.close, stop: c.stop, verification: verificacionDe(c), ...(review ? { review } : {}) };
  }
  const conEntradas: ContributionPlan = { ...plan, inputs };
  const final: ContributionPlan = { ...conEntradas, changes: explainPlanChange(anterior, conEntradas), previousBuiltAt: anterior?.builtAt ?? null };
  await store.savePlan(final);
  return final;
}
