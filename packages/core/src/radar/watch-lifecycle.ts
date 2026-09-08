/**
 * Ciclo de vida de un ítem del seguimiento (portado de trading v1, `watchlist-resolver`). Puro.
 * Al agregar un ticker se guarda una foto (precio, stop, objetivo, plazo); cada día se evalúa contra el precio actual:
 * viva → gatillada (tocó el objetivo) / invalidada (tocó el stop) / expirada (venció el plazo sin resolverse).
 * El stop gana si tocó los dos. Siempre en marco largo: no operamos en corto.
 */
export type WatchStatus = "live" | "triggered" | "invalidated" | "expired";

export interface WatchResolveInput {
  entryPrice: number;
  targetPrice: number | null;
  stopLoss: number | null;
  currentPrice: number;
  daysSince: number;
  horizonDays: number;
}
export interface WatchResolveResult {
  status: WatchStatus;
  /** Retorno % desde el alta. */
  returnPct: number;
  hitTarget: boolean;
  hitStop: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function resolveWatchStatus(i: WatchResolveInput): WatchResolveResult {
  const returnPct = i.entryPrice > 0 ? round2(((i.currentPrice - i.entryPrice) / i.entryPrice) * 100) : 0;
  const hitTarget = i.targetPrice !== null && i.currentPrice >= i.targetPrice;
  const hitStop = i.stopLoss !== null && i.currentPrice <= i.stopLoss;
  const status: WatchStatus = hitStop ? "invalidated" : hitTarget ? "triggered" : i.daysSince >= i.horizonDays ? "expired" : "live";
  return { status, returnPct, hitTarget, hitStop };
}
