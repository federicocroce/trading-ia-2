import { z } from "zod";

export const CloseReason = z.enum(["event_resolved", "invalidation", "target", "risk_stop", "manual"]);
export type CloseReason = z.infer<typeof CloseReason>;

/** Resultado real de una tesis cerrada. Es la fuente de la calibración (§7). */
export const Outcome = z.object({
  thesisId: z.string().uuid(),
  /** ¿Pasó lo que la tesis predijo? Independiente del PnL. */
  predictedOutcomeHappened: z.boolean(),
  pnlUsd: z.number(),
  pnlPct: z.number(),
  closeReason: CloseReason,
  closedAt: z.string().datetime(),
  notes: z.string().default(""),
});
export type Outcome = z.infer<typeof Outcome>;

/**
 * Brier score de una lista de (probabilidad, ocurrió). Menor es mejor.
 * Se compara pEstimate vs pMarket sobre las mismas tesis (§7).
 */
export function brierScore(pairs: ReadonlyArray<{ p: number; happened: boolean }>): number {
  if (pairs.length === 0) return Number.NaN;
  const sum = pairs.reduce((acc, { p, happened }) => acc + (p - (happened ? 1 : 0)) ** 2, 0);
  return sum / pairs.length;
}
