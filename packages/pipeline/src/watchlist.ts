import type { Candle, CandidateRow, Fundamentals, VerificationSummary, WatchItem } from "@thesis/core";
import { PLAN_BLOCKERS, computeTrailingStop, decideCandidate, rankStocks, resolveWatchStatus, riskScore } from "@thesis/core";
import { hechosDe, pruneFamilias, tagSymbol, universoDelRanking, type RadarDeps } from "./radar.js";
import { scanEventsFor, type EventScan } from "./radar-events.js";
import { VERIFY_PER_RUN_DEFAULT, verificacionGuardada, verifyFor, type VerifyBudget } from "./radar-verify.js";

/**
 * Lista de seguimiento: tickers elegidos a mano. Reciben todos los días el mismo tratamiento que un candidato
 * (filtro técnico, stop, objetivo, tamaño, riesgo) y su rank contra pares si están en el universo,
 * aunque el ranking no los elija. Filas con kind "watch": no entran en convicción, y al plan solo como la línea
 * de seguimiento. Lo que el ranking de hoy ya eligió conserva su fila del Radar (ver `refreshWatchlist`).
 */
const HISTORY_DAYS = 400;
const round2 = (n: number) => Math.round(n * 100) / 100;
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 160);

function stubFundamentals(symbol: string, close: number): Fundamentals {
  return { symbol, asOf: "", metrics: {}, peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 0, priceUsd: close, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null };
}

function baseRow(date: string, symbol: string, close: number): CandidateRow {
  return {
    candidateDate: date, symbol, kind: "watch", verdict: "OBSERVAR", score: null, axes: {}, peerGroup: [], rankInGroup: null, groupSize: null,
    close, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: [], nthAppearance: 1,
    summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
    close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  };
}

/**
 * Ciclo de vida (portado de v1): la foto del alta (precio, stop, objetivo, plazo) contra el cierre de hoy.
 * Un alta vieja sin precio toma el cierre de hoy como entrada. Lo ya resuelto no se vuelve a evaluar.
 */
async function evaluateLifecycle(store: RadarDeps["store"], item: WatchItem, close: number, today: string): Promise<void> {
  if (item.status !== "live") return;
  let entry = item.entryPrice;
  if (!entry || entry <= 0) {
    entry = close;
    await store.updateWatchEval(item.symbol, { status: "live", lastPrice: close, lastReturn: 0, lastEvaluatedAt: new Date().toISOString(), resolvedAt: null, resolutionPrice: null, resolutionReturn: null });
    await store.setWatchEntry?.(item.symbol, close);
  }
  const daysSince = Math.max(0, Math.floor((Date.parse(today) - Date.parse(item.addedAt)) / 86_400_000));
  const r = resolveWatchStatus({ entryPrice: entry, targetPrice: item.targetPrice, stopLoss: item.stopLoss, currentPrice: close, daysSince, horizonDays: item.horizonDays });
  const now = new Date().toISOString();
  const resolved = r.status !== "live";
  await store.updateWatchEval(item.symbol, { status: r.status, lastPrice: close, lastReturn: r.returnPct, lastEvaluatedAt: now, resolvedAt: resolved ? now : null, resolutionPrice: resolved ? close : null, resolutionReturn: resolved ? r.returnPct : null });
}

/**
 * ¿Se puede refrescar solo una parte de la lista? Solo si sus filas vigentes ya son de hoy: lo vigente de cada familia
 * es lo de su última fecha, así que una sola fila con fecha de hoy dejaría a todas las demás fuera de lo vigente.
 * Quien quiere refrescar un símbolo suelto (el alta, una verificación que llegó) pregunta acá; si no, refresca todo.
 */
export async function seguimientoAlDia(store: RadarDeps["store"], today: string): Promise<boolean> {
  return !(await store.latestCandidates()).some((r) => r.kind === "watch" && r.candidateDate !== today);
}

export async function refreshWatchlist(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null; only?: string[] }): Promise<{ symbols: number; rows: number; errors: Array<{ symbol: string; error: string }> }> {
  const { store, policy } = deps;
  // Refresco parcial (15/9): como en `refreshRadar`, nunca cambia la fecha de la familia ni borra a las demás.
  const soloEstos = opts.only ? new Set(opts.only.map((s) => s.toUpperCase())) : null;
  if (soloEstos && !(await seguimientoAlDia(store, opts.today))) return { symbols: 0, rows: 0, errors: [] };
  const items = (await store.watchlist()).filter((i) => !soloEstos || soloEstos.has(i.symbol.toUpperCase()));
  if (!items.length) return { symbols: 0, rows: 0, errors: [] };
  const errors: Array<{ symbol: string; error: string }> = [];

  // Rank contra pares con el universo fresco (puro, barato). Quien no está en el universo queda sin score.
  // El mismo universo que el ranking, con la frescura contada desde el barrido (15/9): contada desde hoy, a mitad de
  // semana los pares se quedaban sin fundamentales y el rank de cada ticker seguido salía contra un grupo vacío.
  const { all } = await universoDelRanking(deps, opts.today);
  const byRank = new Map(rankStocks(all, policy.weights).ranked.map((r) => [r.symbol, r]));

  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  if (spy.length) await store.upsertCandles("SPY", spy).catch(() => {});
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const latest = await store.latestCandidates();
  const previous = latest.filter((r) => r.kind === "watch");
  // Lo que el ranking de hoy ya eligió no se pisa: hay una fila por símbolo y por día, y la de seguimiento reemplazaba
  // a la del Radar. El 14/9 el dueño siguió APH y TSM desde la ficha: APH, 1° por convicción, salió del ranking y
  // pasó a la línea de seguimiento del plan (3.820 → 2.456), y su lugar fue al núcleo. Seguirlo no cambia qué es.
  const delRanking = new Set(latest.filter((r) => r.candidateDate === opts.today && (r.kind === "stock" || r.kind === "etf")).map((r) => r.symbol));
  // Lo tuyo que ya está en cartera usa el stop de la posición; lo demás es una compra nueva (ver `heldSymbols`).
  const held = new Set((await store.positions()).map((p) => p.symbol.toUpperCase()));
  // La lista de seguimiento comparte la cuota de búsqueda: la mitad del tope de una corrida.
  const verifyBudget: VerifyBudget = { left: Math.max(1, Math.floor((policy.candidates.verifyPerRun ?? VERIFY_PER_RUN_DEFAULT) / 2)) };

  const rows: CandidateRow[] = [];
  for (const item of items) {
    const sym = item.symbol;
    try {
      const candles = await deps.history.candles(sym, HISTORY_DAYS);
      if (!candles.length) throw new Error("sin velas");
      await store.upsertCandles(sym, candles);
      const close = candles[candles.length - 1]!.close;
      if (delRanking.has(sym)) {
        await evaluateLifecycle(store, item, close, opts.today);
        continue;
      }
      // Lo que está fuera del universo del barrido igual usa sus propias fundamentales guardadas (industria, métricas).
      const f = all.get(sym) ?? (await store.fundamentals(sym).catch(() => null)) ?? stubFundamentals(sym, close);
      const prev = previous.find((p) => p.symbol === sym);
      const nth = prev ? (prev.candidateDate === opts.today ? prev.nthAppearance : prev.nthAppearance + 1) : 1;
      // Noticias y analistas, igual que una candidata del ranking. Faltaban: los 15 símbolos de seguimiento
      // son los que el dueño eligió a mano y el 12/9 ninguno tenía una noticia leída nunca, así que sus
      // banderas de evento nunca podían encenderse y la ficha decía "ninguno detectado" sin haber mirado.
      const ev = deps.news ? await scanEventsFor({ store, news: deps.news, classifier: deps.eventClassifier ?? null, ...(deps.log ? { log: deps.log } : {}) }, sym, { today: opts.today, name: (await store.profile(sym).catch(() => null))?.profile.name ?? null }).catch((e): EventScan | null => { deps.log?.(`[seguimiento] noticias de ${sym} fallaron`, { error: errText(e) }); return null; }) : null;
      // El dictamen guardado entra desde la primera decisión: si solo se pasara cuando queda COMPRAR, un
      // OBSERVAR conservaría la verificación en su columna y la perdería en las banderas.
      // La de la tabla, no la copia de la fila anterior (15/9): la misma que muestra la ficha.
      let verification: VerificationSummary | null | undefined = deps.verifier ? await verificacionGuardada(deps, sym) : prev?.verification;
      // Formularios de oferta y hechos externos, igual que el ranking (17/9): sin esto una fila a mano podía
      // decir COMPRAR bajo una oferta de compra, porque `decideCandidate` sólo mira `filings`/`hechos` si se los pasan.
      const filings = await deps.filingsDeOferta(sym).catch(() => [] as string[]);
      const hechos = await hechosDe(deps, sym, opts.today);
      const base = { f, candles, nthAppearance: nth, portfolioUsd: opts.portfolioUsd, today: opts.today, held: held.has(sym.toUpperCase()), filings, hechos, ...(deps.verifier ? { verificationVersion: deps.verifier.promptVersion } : {}), ...(ev ? { events: ev.events, eventsUnclassified: ev.unclassified, analystTargets: ev.analystTargets } : {}) };
      let d = decideCandidate({ ...base, ...(verification ? { verification } : {}) }, policy);
      // Verificación web también para lo tuyo que quedó COMPRAR (GLW 10/9: consenso en el precio tras +130%); el dictamen vuelve a las reglas.
      // Lo que una regla fija deja afuera del plan no gasta una búsqueda (15/9), como en el ranking.
      if (!("excluded" in d) && d.verdict === "COMPRAR" && deps.verifier && !d.flags.some((f) => PLAN_BLOCKERS[f])) {
        const profile = await store.profile(sym).catch(() => null);
        verification = await verifyFor(deps, sym, { today: opts.today, name: profile?.profile.name ?? null, context: `lista de seguimiento · banderas: ${d.flags.join(", ") || "ninguna"}`, budget: verifyBudget });
        const again = decideCandidate({ ...base, verification }, policy);
        if (!("excluded" in again)) d = again;
      }
      const r = byRank.get(sym);
      const row: CandidateRow = {
        ...baseRow(opts.today, sym, close),
        score: r?.score ?? null, axes: r?.axes ?? {}, peerGroup: r?.group ?? [], rankInGroup: r?.rankInGroup ?? null, groupSize: r?.groupSize ?? null,
        nthAppearance: nth, spyClose,
        riskScore: riskScore({ beta: f.metrics["beta"] ?? null, atrPct: null, debtToEquity: f.metrics["totalDebt/totalEquityAnnual"] ?? null, dollarVolumeUsd: f.dollarVolumeUsd, mcapUsd: f.mcapUsd }),
      };
      if ("excluded" in d) {
        // Tendencia de fondo bajista: se sigue igual, con el stop dinámico como referencia y sin objetivo.
        rows.push({ ...row, verdict: "OBSERVAR", flags: d.reasons, stop: computeTrailingStop(candles) });
      } else {
        rows.push({ ...row, verification: verification ?? null, analystTargets: ev?.analystTargets ?? null, entry: d.entry, verdict: d.verdict, flags: d.flags, entryLow: d.entryLow, entryHigh: round2(d.entryHigh), stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore });
      }
      // Reglas de taxonomía cada día (barato): un tema nuevo en config llega solo. Lo manual no se pisa.
      await tagSymbol(deps, sym, { industry: f.industry, country: null }).catch(() => null);
      await evaluateLifecycle(store, item, close, opts.today);
    } catch (e) {
      errors.push({ symbol: sym, error: errText(e) });
    }
  }
  if (rows.length) {
    await store.upsertCandidates(rows);
    // Un símbolo que sacaste de la lista no puede seguir apareciendo con la fila de la corrida de la mañana. En un
    // refresco parcial no se poda: las filas que no se tocaron siguen siendo de la lista.
    if (!soloEstos) await pruneFamilias(store, opts.today, rows);
  }
  return { symbols: items.length, rows: rows.length, errors };
}
