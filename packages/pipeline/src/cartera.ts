import { type TesisInput, alphaPct, applyDegrade, buildRiskReport, decideVerb, type Candle, type NarratorInput, type Position, type PositionNarrator, type PositionVerdict, type PriceHistory, type Profiles, type RiskReport, type SymbolProfile, type VerdictRow } from "@thesis/core";
import type { CarteraStore } from "./store.js";

/**
 * Cartera real (spec etapa 1): veredicto diario por posición.
 * reglas → riesgo → narrativa (solo degrada) → persistencia. El modelo nunca decide el verbo.
 */
export interface CarteraDeps {
  store: CarteraStore;
  history: PriceHistory;
  profiles: Profiles;
  narrator: PositionNarrator | null;
  /** Precio vivo; null si no hay. Informa, no decide. */
  spot: (symbol: string) => Promise<number | null>;
  /**
   * Lo que la app ya sabe del negocio de ese símbolo: verificación web, eventos materiales, salvedades de
   * calidad de la ganancia y consenso. Opcional a propósito: sin esto el veredicto sale como siempre, solo
   * por precio, y los tests que no la pasan siguen valiendo.
   */
  tesis?: (symbol: string) => Promise<TesisInput | null>;
  /**
   * Lee las noticias de un símbolo y guarda sus eventos materiales. Opcional; sin esto el veredicto sale
   * igual que antes, solo que la app lo dice en vez de dar por limpio lo que no miró.
   *
   * Por qué acá. El barrido de noticias corría SOLO sobre las candidatas del ranking del día. El 12/9 eso
   * dejaba a GGAL, HUT, MARA, NEM e YPF —cinco de las ocho posiciones con plata puesta— sin una sola
   * noticia leída nunca, y el veredicto de mantener se calculaba con `events: []`. Donde hay plata es
   * justo donde no puede faltar.
   */
  scanEvents?: (symbol: string) => Promise<void>;
  log?: (msg: string, extra?: unknown) => void;
}
export interface CarteraSummary {
  date: string;
  verdicts: VerdictRow[];
  risk: RiskReport;
  errors: Array<{ symbol: string; error: string }>;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const HISTORY_DAYS = 260;
const PROFILE_TTL_DAYS = 7;

const EMPTY_RISK: RiskReport = { totalValue: 0, weights: [], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] };

async function profileFor(deps: CarteraDeps, p: Position, today: string): Promise<SymbolProfile | null> {
  const cached = await deps.store.profile(p.symbol);
  if (cached && (Date.parse(today) - Date.parse(cached.updatedAt)) / DAY < PROFILE_TTL_DAYS) return cached.profile;
  try {
    const fresh = await deps.profiles.profile(p.symbol);
    if (fresh) await deps.store.saveProfile(fresh);
    return fresh ?? cached?.profile ?? null;
  } catch {
    return cached?.profile ?? null;
  }
}

/** Arma lo que ve el narrador. Puro. */
export function buildNarratorInput(p: Position, v: PositionVerdict, weightPct: number, candles: Candle[], filings: string[], news: string[], risk: RiskReport, profile: SymbolProfile | null): NarratorInput {
  const riskFacts = [`peso en cartera ${weightPct}%`];
  const country = profile?.country ?? (p.market === "us" ? "US" : "AR");
  const cShare = risk.concentration.byCountry[country];
  if (cShare !== undefined && cShare > 40) riskFacts.push(`el país ${country} concentra ${cShare}% de la cartera`);
  for (const pair of risk.correlatedPairs) if (pair.a === p.symbol || pair.b === p.symbol) riskFacts.push(`correlación ${pair.corr} con ${pair.a === p.symbol ? pair.b : pair.a}`);
  return { position: p, verb: v.verb, reason: v.reason, close: v.close, stop: v.stop, target: v.target, gainPct: v.gainPct, weightPct, last30: candles.slice(-30).map((c) => c.close), filings, news, riskFacts };
}

export async function runCartera(deps: CarteraDeps, opts: { today: string }): Promise<CarteraSummary> {
  const log = deps.log ?? (() => {});
  const errors: CarteraSummary["errors"] = [];
  const positions = await deps.store.positions();
  if (!positions.length) return { date: opts.today, verdicts: [], risk: EMPTY_RISK, errors };

  // 1. Velas de cada posición y de SPY, en paralelo. Sin velas no hay veredicto (REVISAR), pero sí error registrado.
  const candles: Record<string, Candle[]> = {};
  const symbols = [...positions.map((p) => p.symbol), "SPY"];
  const fetched = await Promise.allSettled(symbols.map((s) => deps.history.candles(s, HISTORY_DAYS)));
  fetched.forEach((r, i) => {
    const sym = symbols[i]!;
    if (r.status === "fulfilled") candles[sym] = r.value;
    else {
      errors.push({ symbol: sym, error: `sin velas para ${sym}: ${String(r.reason)}` });
      candles[sym] = [];
    }
  });
  const spy = candles["SPY"] ?? [];
  const spyClose = spy[spy.length - 1]?.close ?? null;
  for (const [sym, c] of Object.entries(candles)) if (c.length) await deps.store.upsertCandles(sym, c).catch(() => {});

  // 2. Noticias de cada posición, antes de decidir: el veredicto de mantener las usa. Una que falle no
  //    frena a las demás ni a la corrida; queda sin fecha de barrido y el veredicto lo dice.
  if (deps.scanEvents) {
    for (const p of positions) {
      try {
        await deps.scanEvents(p.symbol);
      } catch (e) {
        errors.push({ symbol: p.symbol, error: `noticias de ${p.symbol}: ${String(e)}` });
        log(`[cartera] noticias de ${p.symbol} fallaron`, { error: String(e).slice(0, 120) });
      }
    }
  }

  // 3. Perfiles (cache 7 días) y riesgo de cartera.
  const profiles: Record<string, SymbolProfile | null> = {};
  for (const p of positions) profiles[p.symbol] = await profileFor(deps, p, opts.today);
  const allTags = await deps.store.allTags().catch(() => ({}));
  const tags = Object.fromEntries(Object.entries(allTags).map(([k, t]) => [k, { sector: t.sector, themes: t.themes }]));
  const risk = buildRiskReport({ positions, candles, spy, profiles, tags });

  // 4. Veredicto por posición.
  const verdicts: VerdictRow[] = [];
  for (const p of positions) {
    const weightPct = risk.weights.find((w) => w.symbol === p.symbol)?.weightPct ?? 0;
    const spot = await deps.spot(p.symbol).catch(() => null);
    const tesis = deps.tesis ? await deps.tesis(p.symbol).catch(() => null) : null;
    let v = decideVerb({ candles: candles[p.symbol]!, spot, avgCost: p.avgCost, layer: p.layer, weightPct, positionsCount: positions.length, today: opts.today, ...(tesis ? { tesis } : {}) });
    let narrative: string | null = null;
    let degradedBy: string | null = null;
    if (deps.narrator && candles[p.symbol]!.length) {
      try {
        const [filings, news] = await Promise.all([deps.store.recentFilingTitles(p.symbol, 8), deps.store.recentNewsTitles(profiles[p.symbol]?.name ?? p.symbol, 5)]);
        const note = await deps.narrator.narrate(buildNarratorInput(p, v, weightPct, candles[p.symbol]!, filings, news, risk, profiles[p.symbol] ?? null));
        narrative = note.narrative;
        const after = applyDegrade(v, note);
        if (after.verb !== v.verb) degradedBy = "narrator";
        v = after;
      } catch (e) {
        errors.push({ symbol: p.symbol, error: String(e) });
        log(`[cartera] narrador falló para ${p.symbol}`, { error: String(e) });
      }
    }
    const safe = (n: number) => (Number.isFinite(n) ? n : 0);
    verdicts.push({ verdictDate: opts.today, symbol: p.symbol, verb: v.verb, reason: v.reason, narrative, warning: v.warning, close: safe(v.close), spot, stop: v.stop, target: v.target, gainPct: safe(v.gainPct), weightPct, spyClose, degradedBy, promptVersion: deps.narrator?.promptVersion ?? null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null });
    log(`[cartera] ${p.symbol} ${v.verb}`, { close: v.close, stop: v.stop });
  }
  await deps.store.upsertVerdicts(verdicts);
  await deps.store.saveRisk(opts.today, risk);
  return { date: opts.today, verdicts, risk, errors };
}

/** Completa la medición a 7 y 30 días de los veredictos que ya tienen vela posterior. */
export async function measureVerdicts(deps: Pick<CarteraDeps, "store" | "history" | "log">, opts: { today: string }): Promise<{ measured7: number; measured30: number }> {
  const out = { measured7: 0, measured30: 0 };
  const cache = new Map<string, Candle[]>();
  const candlesOf = async (s: string) => {
    if (!cache.has(s)) cache.set(s, await deps.history.candles(s, 60).catch(() => []));
    return cache.get(s)!;
  };
  const firstOnOrAfter = (c: Candle[], date: string) => c.find((x) => x.date >= date) ?? null;
  for (const h of [7, 30] as const) {
    const rows = await deps.store.verdictsToMeasure(addDays(opts.today, -h), h);
    for (const r of rows) {
      const target = addDays(r.verdictDate, h);
      const [own, spy] = await Promise.all([candlesOf(r.symbol), candlesOf("SPY")]);
      const a = firstOnOrAfter(own, target);
      const b = firstOnOrAfter(spy, target);
      if (!a || !b || r.spyClose === null || r.close <= 0) continue;
      const alpha = alphaPct(r.close, a.close, r.spyClose, b.close);
      await deps.store.setMeasurement(r.verdictDate, r.symbol, h === 7 ? { close7d: a.close, spy7d: b.close, alpha7dPct: alpha } : { close30d: a.close, spy30d: b.close, alpha30dPct: alpha });
      if (h === 7) out.measured7++;
      else out.measured30++;
    }
  }
  return out;
}
