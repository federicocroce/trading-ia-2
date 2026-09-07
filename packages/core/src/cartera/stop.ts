import type { Candle } from "./types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ATR(period): media del true range de las últimas `period` velas. null si faltan velas (necesita period+1). */
export function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
  }
  return sum / period;
}

/**
 * Stop "chandelier": máximo de las últimas `period` velas menos `atrMult` × ATR(period).
 * Sube cuando la acción hace máximos nuevos; nunca baja. Portado de trading v1.
 */
export function computeTrailingStop(candles: Candle[], opts: { period?: number; atrMult?: number } = {}): number | null {
  const period = opts.period ?? 22;
  const mult = opts.atrMult ?? 3;
  const a = atr(candles, period);
  if (a === null) return null;
  const highest = Math.max(...candles.slice(-period).map((c) => c.high));
  return round2(highest - mult * a);
}

/** Objetivo con riesgo/beneficio 2:1 respecto del stop. */
export function computeTarget(close: number, stop: number | null): number | null {
  if (stop === null) return null;
  return round2(close + 2 * (close - stop));
}
