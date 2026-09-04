import type { Outcome, Thesis } from "@thesis/core";
import { brierScore } from "@thesis/core";

export interface CalibrationCriteria {
  minClosed: number;
  maxDrawdownPct: number;
}
export const DEFAULT_CRITERIA: CalibrationCriteria = { minClosed: 30, maxDrawdownPct: 15 };

export interface CalibrationReport {
  closed: number;
  brierSystem: number;
  brierMarket: number;
  hitRate: number;
  avgPnlPct: number;
  totalPnlUsd: number;
  maxDrawdownPct: number;
  byEventType: Record<string, { n: number; hitRate: number; avgPnlPct: number; brierSystem: number; brierMarket: number }>;
  /** Tesis rechazadas por humano: cuántas hubieran acertado (requiere outcome manual; v1 solo cuenta). */
  humanRejected: number;
  criteria: {
    enoughSamples: boolean;
    calibratesBetterThanMarket: boolean;
    positiveExpectancy: boolean;
    drawdownOk: boolean;
    readyForRealMoney: boolean;
  };
}

/** Métricas de §7 sobre tesis cerradas. Puro. */
export function calibrationReport(
  rows: Array<{ thesis: Thesis; outcome: Outcome }>,
  capitalUsd: number,
  humanRejected = 0,
  criteria: CalibrationCriteria = DEFAULT_CRITERIA,
): CalibrationReport {
  const sorted = [...rows].sort((a, b) => a.outcome.closedAt.localeCompare(b.outcome.closedAt));
  const n = sorted.length;
  const pairsSys = sorted.map((r) => ({ p: r.thesis.pEstimate, happened: r.outcome.predictedOutcomeHappened }));
  const pairsMkt = sorted.map((r) => ({ p: r.thesis.pMarket, happened: r.outcome.predictedOutcomeHappened }));
  const hits = sorted.filter((r) => r.outcome.predictedOutcomeHappened).length;
  const totalPnl = sorted.reduce((a, r) => a + r.outcome.pnlUsd, 0);
  const avgPnlPct = n ? sorted.reduce((a, r) => a + r.outcome.pnlPct, 0) / n : 0;

  // Drawdown sobre la curva de equity acumulada (capital + PnL acumulado).
  let peak = capitalUsd;
  let equity = capitalUsd;
  let maxDd = 0;
  for (const r of sorted) {
    equity += r.outcome.pnlUsd;
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, (100 * (peak - equity)) / peak);
  }

  const byEventType: CalibrationReport["byEventType"] = {};
  for (const r of sorted) {
    const k = r.thesis.eventType;
    const g = (byEventType[k] ??= { n: 0, hitRate: 0, avgPnlPct: 0, brierSystem: 0, brierMarket: 0 });
    g.n++;
  }
  for (const k of Object.keys(byEventType)) {
    const g = sorted.filter((r) => r.thesis.eventType === k);
    byEventType[k] = {
      n: g.length,
      hitRate: g.filter((r) => r.outcome.predictedOutcomeHappened).length / g.length,
      avgPnlPct: g.reduce((a, r) => a + r.outcome.pnlPct, 0) / g.length,
      brierSystem: brierScore(g.map((r) => ({ p: r.thesis.pEstimate, happened: r.outcome.predictedOutcomeHappened }))),
      brierMarket: brierScore(g.map((r) => ({ p: r.thesis.pMarket, happened: r.outcome.predictedOutcomeHappened }))),
    };
  }

  const brierSystem = brierScore(pairsSys);
  const brierMarket = brierScore(pairsMkt);
  const enoughSamples = n >= criteria.minClosed;
  const calibratesBetterThanMarket = n > 0 && brierSystem < brierMarket;
  const positiveExpectancy = n > 0 && avgPnlPct > 0;
  const drawdownOk = maxDd < criteria.maxDrawdownPct;
  return {
    closed: n,
    brierSystem,
    brierMarket,
    hitRate: n ? hits / n : 0,
    avgPnlPct,
    totalPnlUsd: totalPnl,
    maxDrawdownPct: maxDd,
    byEventType,
    humanRejected,
    criteria: { enoughSamples, calibratesBetterThanMarket, positiveExpectancy, drawdownOk, readyForRealMoney: enoughSamples && calibratesBetterThanMarket && positiveExpectancy && drawdownOk },
  };
}
