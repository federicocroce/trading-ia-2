import type { CandidateVerification, CandidateVerifier, VerificationSummary } from "@thesis/core";
import type { RadarStore } from "./store.js";

/**
 * Verificación web por candidata (spec 2026-09-10). Solo para lo que ya es COMPRAR después de todas las reglas:
 * el modelo investiga con búsqueda y dictamina; acá se cachea 7 días por símbolo y versión del prompt, y un fallo
 * deja lo que había (la fila lleva `verificacion_pendiente` si nunca hubo nada).
 */
export interface VerifyDeps {
  store: Pick<RadarStore, "verification" | "saveVerification">;
  verifier?: CandidateVerifier | null;
  log?: (msg: string, extra?: unknown) => void;
}
export const VERIFY_FRESH_DAYS = 7;
const DAY = 86_400_000;
const ageDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY;
const summary = (v: CandidateVerification): VerificationSummary => ({ date: v.date, verdict: v.verdict, reason: v.reason });

export async function verifyFor(deps: VerifyDeps, symbol: string, opts: { today: string; name: string | null; context?: string | null }): Promise<VerificationSummary | null> {
  const verifier = deps.verifier;
  if (!verifier) return null;
  const sym = symbol.toUpperCase();
  const prev = await deps.store.verification(sym);
  if (prev && prev.promptVersion === verifier.promptVersion && ageDays(prev.date, opts.today) < VERIFY_FRESH_DAYS) return summary(prev);
  try {
    const r = await verifier.verify({ symbol: sym, name: opts.name, today: opts.today, context: opts.context ?? null });
    const full: CandidateVerification = { ...r, symbol: sym, date: opts.today, detectedAt: new Date().toISOString(), promptVersion: verifier.promptVersion };
    await deps.store.saveVerification(full);
    deps.log?.(`[radar] verificación web de ${sym}: ${full.verdict} (${full.sources.length} fuentes)`, { reason: full.reason });
    return summary(full);
  } catch (e) {
    deps.log?.(`[radar] verificación web de ${sym} falló`, { error: String(e).slice(0, 160) });
    // Vencida es mejor que nada: la fecha en la ficha dice cuán vieja es.
    return prev ? summary(prev) : null;
  }
}
