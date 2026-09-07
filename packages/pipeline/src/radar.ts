import {
  AXES,
  AXIS_METRICS,
  alphaPct,
  assetClassFor,
  decideCandidate,
  decideEtf,
  isEligibleAsset,
  mergeThemes,
  passesPreFilter,
  planContribution,
  qualityBar,
  rankStocks,
  sectorFor,
  themesFor,
  type AssetInfo,
  type Candle,
  type CandidateRow,
  type CardInput,
  type CardWriter,
  type ContributionPlan,
  type EtfConfig,
  type FinnhubMetrics,
  type Fundamentals,
  type PriceHistory,
  type RadarPolicy,
  type RankedStock,
  type ScanStage,
  type SnapshotLite,
  type SymbolProfile,
  type Tags,
  type TaxonomyConfig,
} from "@thesis/core";
import type { CarteraStore, RadarStore } from "./store.js";

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
  store: CarteraStore & RadarStore;
  assets: { list(): Promise<AssetInfo[]>; snapshots(symbols: string[]): Promise<SnapshotLite[]> };
  fundamentals: FundamentalsSource;
  history: PriceHistory;
  cardWriter: CardWriter | null;
  taxonomy: TaxonomyConfig;
  etfs: EtfConfig[];
  policy: RadarPolicy;
  /** Títulos de filings recientes del símbolo (contexto de la ficha). */
  filings: (symbol: string) => Promise<string[]>;
  log?: (msg: string, extra?: unknown) => void;
  onProgress?: (s: { done: number; total: number; stage: string }) => void;
  shouldStop?: () => boolean;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const ageDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY;
const FRESH_DAYS = 7;
const HISTORY_DAYS = 260;

// ---------- taxonomía ----------

async function tagSymbol(deps: RadarDeps, symbol: string, profile: { industry: string | null; country: string | null } | null, proposedThemes: string[] = [], source: "regla" | "modelo" = "regla"): Promise<Tags> {
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
      const qb = qualityBar({ profile: { shareOutstanding: profile.shareOutstanding ?? null, currency: profile.currency ?? null, country: profile.country, industry: profile.industry, name: profile.name }, metrics, priceUsd }, policy.quality, { volumeOverrideUsd, allowUnknownMcap: foreign });
      await store.saveProfile(profile);
      if (!qb.ok) {
        await store.scanUpsert([{ scanDate: opts.scanDate, symbol: sym, stage: "excluded", reason: qb.reason ?? "quality bar" }]);
        excluded++;
        continue;
      }
      const peers = await deps.fundamentals.peers(sym);
      await store.saveFundamentals({ symbol: sym, asOf: opts.today, metrics, peers, industry: profile.industry, mcapUsd: qb.mcapUsd, dollarVolumeUsd: qb.dollarVolumeUsd!, priceUsd, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
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

async function candlesFor(deps: RadarDeps, symbols: string[]): Promise<{ candles: Record<string, Candle[]>; errors: Array<{ symbol: string; error: string }> }> {
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
  const prev = hist.find((c) => c.candidateDate < today);
  if (!prev || ageDays(prev.candidateDate, today) > 10) return 1;
  return prev.nthAppearance + 1;
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
async function rankableFundamentals(deps: RadarDeps, today: string): Promise<Map<string, Fundamentals>> {
  const fresh = await deps.store.freshFundamentals(FRESH_DAYS, today);
  const scanDate = await deps.store.latestScanDate();
  const ok = scanDate ? new Set(await deps.store.scanSymbols(scanDate, "finnhub_ok")) : null;
  return new Map(fresh.filter((f) => !ok || ok.has(f.symbol)).map((f) => [f.symbol, f]));
}

/** Escribe la ficha de un candidato y aplica sus efectos (degradar, temas). Devuelve null si el modelo falló. */
async function writeCardFor(deps: RadarDeps, f: Fundamentals, r: RankedStock, verdict: "COMPRAR" | "OBSERVAR", d: { flags: string[]; entryLow: number; stop: number | null; target: number | null; riskScore: number }, ins: { buys: number; sells: number } | null): Promise<{ card: { summary: string; whyRanks: string; mainRisk: string; moat: string }; degrade: boolean; degradeReason: string | null } | null> {
  if (!deps.cardWriter) return null;
  const sym = f.symbol;
  const tags = (await deps.store.tags(sym)) ?? (await tagSymbol(deps, sym, { industry: f.industry, country: null }));
  const profile = await deps.store.profile(sym);
  const input: CardInput = { symbol: sym, name: profile?.profile.name ?? null, industry: f.industry, sector: tags.sector, themes: tags.themes, themeOptions: deps.taxonomy.themes, verdict, score: r.score, axes: r.axes, rankInGroup: r.rankInGroup, groupSize: r.groupSize, basis: r.basis, own: ownMetrics(f), medians: r.medians, peers: r.group, flags: d.flags, insiders: ins, analyst: f.analyst, surprises: f.earningsSurprises, filings: await deps.filings(sym).catch(() => []), close: d.entryLow, stop: d.stop, target: d.target, riskScore: d.riskScore };
  const c = await deps.cardWriter.write(input);
  if (c.themes.length) await tagSymbol(deps, sym, { industry: f.industry, country: null }, c.themes, "modelo");
  return { card: { summary: c.summary, whyRanks: c.whyRanks, mainRisk: c.mainRisk, moat: c.moat }, degrade: c.degrade, degradeReason: c.degradeReason ?? null };
}

export async function rankRadar(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null }): Promise<RankSummary> {
  const log = deps.log ?? (() => {});
  const { store, policy } = deps;
  const all = await rankableFundamentals(deps, opts.today);
  const { ranked, skipped } = rankStocks(all, policy.weights);
  const pre = ranked.slice(0, policy.candidates.preselect);
  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  if (spy.length) await store.upsertCandles("SPY", spy).catch(() => {});
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const { candles, errors } = await candlesFor(deps, pre.map((r) => r.symbol));

  // Filtro técnico sobre la pre-selección; quedan los `top` mejores por score.
  const kept: RankedStock[] = [];
  for (const r of pre) {
    const c = candles[r.symbol];
    if (!c) continue;
    const f = all.get(r.symbol)!;
    const d = decideCandidate({ f, candles: c, nthAppearance: 1, portfolioUsd: opts.portfolioUsd, today: opts.today }, policy);
    if ("excluded" in d) {
      skipped.push({ symbol: r.symbol, reason: d.reasons.join(",") });
      continue;
    }
    kept.push(r);
    if (kept.length >= policy.candidates.top) break;
  }

  const rows: CandidateRow[] = [];
  for (const r of kept) {
    const sym = r.symbol;
    let f = all.get(sym)!;
    try {
      // Datos que solo valen la pena para los candidatos.
      const [nextEarnings, ins, analyst, surprises] = await Promise.all([
        deps.fundamentals.nextEarnings(sym, opts.today).catch(() => null),
        deps.fundamentals.insiders(sym, 90, opts.today).catch(() => null),
        deps.fundamentals.recommendation(sym).catch(() => null),
        deps.fundamentals.earningsSurprises(sym).catch(() => null),
      ]);
      f = { ...f, nextEarnings, insiderBuys90d: ins?.buys ?? null, insiderSells90d: ins?.sells ?? null, analyst, earningsSurprises: surprises };
      await store.saveFundamentals(f);
      const nth = await nthAppearanceFor(deps, sym, opts.today);
      const d = decideCandidate({ f, candles: candles[sym]!, nthAppearance: nth, portfolioUsd: opts.portfolioUsd, today: opts.today }, policy);
      if ("excluded" in d) {
        skipped.push({ symbol: sym, reason: d.reasons.join(",") });
        continue;
      }
      let verdict = d.verdict;
      let degradedBy: string | null = null;
      let card: { summary: string; whyRanks: string; mainRisk: string; moat: string } | null = null;
      if (deps.cardWriter) {
        try {
          const w = await writeCardFor(deps, f, r, verdict, d, ins);
          if (w) {
            card = w.card;
            if (w.degrade && verdict === "COMPRAR") {
              verdict = "OBSERVAR";
              degradedBy = "narrator";
              d.flags.push(`degradado: ${w.degradeReason ?? "sin motivo"}`);
            }
          }
        } catch (e) {
          errors.push({ symbol: sym, error: String(e) });
          log(`[radar] ficha falló para ${sym}`, { error: String(e).slice(0, 120) });
        }
      }
      rows.push({ ...emptyRow(opts.today, sym, "stock", verdict, d.entryLow), score: r.score, axes: r.axes, peerGroup: r.group, rankInGroup: r.rankInGroup, groupSize: r.groupSize, entryLow: d.entryLow, entryHigh: d.entryHigh, stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore, flags: d.flags, nthAppearance: nth, summary: card?.summary ?? null, whyRanks: card?.whyRanks ?? null, mainRisk: card?.mainRisk ?? null, moat: card?.moat ?? null, degradedBy, promptVersion: deps.cardWriter?.promptVersion ?? null, spyClose });
      log(`[radar] ${sym} ${verdict}`, { score: r.score, rank: `${r.rankInGroup}/${r.groupSize}` });
    } catch (e) {
      errors.push({ symbol: sym, error: String(e) });
    }
  }

  // ETFs curados.
  const { candles: etfCandles, errors: etfErrors } = await candlesFor(deps, deps.etfs.map((e) => e.symbol));
  errors.push(...etfErrors);
  for (const cfg of deps.etfs) {
    const c = etfCandles[cfg.symbol];
    if (!c) continue;
    const d = decideEtf(cfg, c, spy, policy.technical);
    if ("excluded" in d) {
      skipped.push({ symbol: cfg.symbol, reason: d.reasons.join(",") });
      continue;
    }
    await tagSymbol(deps, cfg.symbol, { industry: null, country: "US" });
    rows.push({ ...emptyRow(opts.today, cfg.symbol, "etf", d.verdict, d.close), axes: { rs3m: d.rs3m, rs6m: d.rs6m, rs12m: d.rs12m, distSma200Pct: d.distSma200Pct, atrPct: d.atrPct }, entryLow: d.close, entryHigh: Math.round(d.close * 102) / 100, stop: d.stop, target: d.target, flags: d.reasons, spyClose });
  }
  await store.upsertCandidates(rows);
  return { candidates: rows, skipped, errors };
}

/** Refresco diario: velas nuevas → cierre, stop, objetivo, filtros y verdict. Conserva score, ficha y aparición. */
export async function refreshRadar(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null }): Promise<{ refreshed: number; errors: Array<{ symbol: string; error: string }> }> {
  const { store, policy } = deps;
  const latest = await store.latestCandidates();
  if (!latest.length) return { refreshed: 0, errors: [] };
  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const { candles, errors } = await candlesFor(deps, latest.map((c) => c.symbol));
  const needCards = deps.cardWriter && latest.some((c) => c.kind === "stock" && c.summary === null);
  const ranked = needCards ? new Map(rankStocks(await rankableFundamentals(deps, opts.today), policy.weights).ranked.map((r) => [r.symbol, r])) : null;
  const rows: CandidateRow[] = [];
  for (const prev of latest) {
    const c = candles[prev.symbol];
    if (!c) continue;
    if (prev.kind === "etf") {
      const cfg = deps.etfs.find((e) => e.symbol === prev.symbol);
      if (!cfg) continue;
      const d = decideEtf(cfg, c, spy, policy.technical);
      if ("excluded" in d) continue;
      rows.push({ ...prev, candidateDate: opts.today, verdict: d.verdict, close: d.close, entryLow: d.close, entryHigh: Math.round(d.close * 102) / 100, stop: d.stop, target: d.target, flags: d.reasons, axes: { rs3m: d.rs3m, rs6m: d.rs6m, rs12m: d.rs12m, distSma200Pct: d.distSma200Pct, atrPct: d.atrPct }, spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });
      continue;
    }
    const f = await store.fundamentals(prev.symbol);
    if (!f) {
      errors.push({ symbol: prev.symbol, error: "sin fundamentals" });
      continue;
    }
    const d = decideCandidate({ f, candles: c, nthAppearance: prev.nthAppearance, portfolioUsd: opts.portfolioUsd, today: opts.today }, policy);
    if ("excluded" in d) {
      rows.push({ ...prev, candidateDate: opts.today, verdict: "OBSERVAR", close: c[c.length - 1]!.close, flags: [...prev.flags.filter((x) => !x.startsWith("degradado")), ...d.reasons], spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });
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
          const w = await writeCardFor(deps, f, r, d.verdict, d, f.insiderBuys90d === null ? null : { buys: f.insiderBuys90d, sells: f.insiderSells90d ?? 0 });
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
    rows.push({ ...prev, candidateDate: opts.today, verdict: degraded && d.verdict === "COMPRAR" ? "OBSERVAR" : d.verdict, degradedBy: degraded ? "narrator" : null, ...card, promptVersion: prev.promptVersion ?? deps.cardWriter?.promptVersion ?? null, close: d.entryLow, entryLow: d.entryLow, entryHigh: d.entryHigh, stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore, flags: [...d.flags, ...prev.flags.filter((x) => x.startsWith("degradado")), ...(degradeFlag ? [degradeFlag] : [])], spyClose, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });
  }
  await store.upsertCandidates(rows);
  return { refreshed: rows.length, errors };
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
      const target = addDays(r.candidateDate, h);
      const [own, spy] = await Promise.all([candlesOf(r.symbol), candlesOf("SPY")]);
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

// ---------- plan del aporte ----------

export async function buildContributionPlan(deps: RadarDeps, opts: { month: string; portfolioUsd: number | null }): Promise<ContributionPlan> {
  const { store, policy } = deps;
  const positions = await store.positions();
  const risk = await store.latestRisk();
  const weights = new Map((risk?.report.weights ?? []).map((w) => [w.symbol, w]));
  const tags = await store.allTags();
  const verdicts = await store.latestVerdicts();
  const candidates = await store.latestCandidates();
  const closes: Record<string, number> = {};
  for (const c of candidates) closes[c.symbol] = c.close;
  for (const v of verdicts) closes[v.symbol] = v.close;
  const portfolioValueUsd = opts.portfolioUsd ?? risk?.report.totalValue ?? policy.sizing.fallbackPortfolioUsd;
  const etfOf = (s: string) => deps.etfs.find((e) => e.symbol === s);
  const plan = planContribution(
    {
      month: opts.month,
      portfolioValueUsd,
      positions: positions.map((p) => ({ symbol: p.symbol, valueUsd: weights.get(p.symbol)?.value ?? (closes[p.symbol] ?? p.avgCost) * p.quantity, assetClass: tags[p.symbol]?.assetClass ?? (etfOf(p.symbol) ? "etf" : p.market === "adr" ? "adr" : p.market === "ar" ? "accion_ar" : "accion_us"), ...(etfOf(p.symbol) || p.layer === "nucleo" ? { role: (etfOf(p.symbol)?.role ?? "nucleo") as EtfConfig["role"] } : {}) })),
      sumarCandidates: verdicts.filter((v) => v.verb === "SUMAR").map((v) => ({ symbol: v.symbol, valueUsd: weights.get(v.symbol)?.value ?? 0, weightPct: v.weightPct })),
      buyCandidates: candidates.filter((c) => c.verdict === "COMPRAR").map((c) => ({ symbol: c.symbol, kind: c.kind, score: c.score, sizeUsd: c.sizeUsd, close: c.close })),
      coreEtfs: deps.etfs.filter((e) => e.role === "nucleo"),
      spyClose: candidates[0]?.spyClose ?? verdicts[0]?.spyClose ?? null,
      closes,
    },
    policy.contribution,
  );
  await store.savePlan(plan);
  return plan;
}
