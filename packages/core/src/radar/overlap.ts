import type { Candle } from "../cartera/types.js";
import { correlation, dailyReturns } from "../cartera/risk.js";

/**
 * Solapamiento de un candidato con lo que ya tenés: correlación de retornos diarios (misma ventana y umbral
 * que el panel de riesgo de Cartera) contra cada posición. Devuelve, por candidato, el papel tuyo más parecido
 * si supera el umbral. Puro.
 */
export interface Overlap {
  with: string;
  corr: number;
}
const WINDOW = 127; // 126 retornos, como el panel de riesgo
export const OVERLAP_THRESHOLD = 0.7;

export function holdingsOverlap(candidates: Record<string, Candle[]>, holdings: Record<string, Candle[]>, threshold = OVERLAP_THRESHOLD): Record<string, Overlap> {
  const held = Object.entries(holdings).map(([symbol, c]) => ({ symbol, rets: dailyReturns(c.slice(-WINDOW)) }));
  const out: Record<string, Overlap> = {};
  for (const [symbol, c] of Object.entries(candidates)) {
    const rets = dailyReturns(c.slice(-WINDOW));
    let best: Overlap | null = null;
    for (const h of held) {
      if (h.symbol === symbol) continue;
      const corr = correlation(rets, h.rets);
      if (corr !== null && corr > threshold && (best === null || corr > best.corr)) best = { with: h.symbol, corr };
    }
    if (best) out[symbol] = best;
  }
  return out;
}
