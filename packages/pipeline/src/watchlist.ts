import type { Candle, CandidateRow, Fundamentals } from "@thesis/core";
import { computeTrailingStop, decideCandidate, rankStocks, riskScore } from "@thesis/core";
import { tagSymbol, type RadarDeps } from "./radar.js";

/**
 * Lista de seguimiento: tickers elegidos a mano. Reciben todos los días el mismo tratamiento que un candidato
 * (filtro técnico, stop, objetivo, tamaño, riesgo) y su rank contra pares si están en el universo,
 * aunque el ranking no los elija. Filas con kind "watch": no entran en convicción ni en el plan.
 */
const HISTORY_DAYS = 400;
const FRESH_DAYS = 14;
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

export async function refreshWatchlist(deps: RadarDeps, opts: { today: string; portfolioUsd: number | null }): Promise<{ symbols: number; rows: number; errors: Array<{ symbol: string; error: string }> }> {
  const { store, policy } = deps;
  const items = await store.watchlist();
  if (!items.length) return { symbols: 0, rows: 0, errors: [] };
  const errors: Array<{ symbol: string; error: string }> = [];

  // Rank contra pares con el universo fresco (puro, barato). Quien no está en el universo queda sin score.
  const fresh = await store.freshFundamentals(FRESH_DAYS, opts.today);
  const all = new Map(fresh.map((f) => [f.symbol, f]));
  const byRank = new Map(rankStocks(all, policy.weights).ranked.map((r) => [r.symbol, r]));

  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  if (spy.length) await store.upsertCandles("SPY", spy).catch(() => {});
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const previous = (await store.latestCandidates()).filter((r) => r.kind === "watch");

  const rows: CandidateRow[] = [];
  for (const item of items) {
    const sym = item.symbol;
    try {
      const candles = await deps.history.candles(sym, HISTORY_DAYS);
      if (!candles.length) throw new Error("sin velas");
      await store.upsertCandles(sym, candles);
      const close = candles[candles.length - 1]!.close;
      const f = all.get(sym) ?? stubFundamentals(sym, close);
      const prev = previous.find((p) => p.symbol === sym);
      const nth = prev ? (prev.candidateDate === opts.today ? prev.nthAppearance : prev.nthAppearance + 1) : 1;
      const d = decideCandidate({ f, candles, nthAppearance: nth, portfolioUsd: opts.portfolioUsd, today: opts.today }, policy);
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
        rows.push({ ...row, verdict: d.verdict, flags: d.flags, entryLow: d.entryLow, entryHigh: round2(d.entryHigh), stop: d.stop, target: d.target, sizeUsd: d.size?.sizeUsd ?? null, sizeQty: d.size?.qty ?? null, riskScore: d.riskScore });
      }
      // Reglas de taxonomía cada día (barato): un tema nuevo en config llega solo. Lo manual no se pisa.
      await tagSymbol(deps, sym, { industry: f.industry, country: null }).catch(() => null);
    } catch (e) {
      errors.push({ symbol: sym, error: errText(e) });
    }
  }
  if (rows.length) await store.upsertCandidates(rows);
  return { symbols: items.length, rows: rows.length, errors };
}
