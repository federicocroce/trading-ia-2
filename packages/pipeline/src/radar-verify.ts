import type { CandidateVerification, CandidateVerifier, VerificationSummary } from "@thesis/core";
import type { RadarStore } from "./store.js";

/**
 * Verificación web por candidata (spec 2026-09-10). Solo para lo que ya es COMPRAR después de todas las reglas:
 * el modelo investiga con búsqueda y dictamina; acá se cachea 7 días por símbolo y versión del prompt, y un fallo
 * deja lo que había (la fila lleva `verificacion_pendiente` si nunca hubo nada). Si lo que cambió de versión es solo el
 * estructurador, el informe guardado se vuelve a estructurar en vez de buscar de nuevo (18/9).
 */
export interface VerifyDeps {
  store: Pick<RadarStore, "verification" | "saveVerification">;
  verifier?: CandidateVerifier | null;
  log?: (msg: string, extra?: unknown) => void;
}
export const VERIFY_FRESH_DAYS = 7;
/** Tope de llamadas al modelo con búsqueda por corrida: la cuota gratis de búsqueda es de pocas por día y por clave (10/9: se agotó con menos de 10). */
export const VERIFY_PER_RUN_DEFAULT = 8;
const DAY = 86_400_000;
const ageDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / DAY;
/** El resumen lleva la versión del cuestionario: el plan solo acepta lo verificado con el vigente (13/9). */
const summary = (v: CandidateVerification): VerificationSummary => ({ date: v.date, verdict: v.verdict, reason: v.reason, consensusTarget: v.consensusTarget ?? null, promptVersion: v.promptVersion });

/** Presupuesto compartido por una corrida: cada verificación nueva (no cacheada) descuenta una. */
export interface VerifyBudget {
  left: number;
}

/**
 * La última verificación guardada del símbolo: la misma que muestra la ficha (15/9). Sin verificador, `undefined`.
 * Las filas la toman de acá y no de la fila anterior: BLBD quedó "con reservas" en la tabla y la fila, que pasó a
 * OBSERVAR en el mismo refresco, seguía diciendo "verificación pendiente".
 */
export async function verificacionGuardada(deps: VerifyDeps, symbol: string): Promise<VerificationSummary | null | undefined> {
  if (!deps.verifier) return undefined;
  const v = await deps.store.verification(symbol.toUpperCase()).catch(() => null);
  return v ? summary(v) : null;
}

/**
 * `forzar` (18/9): busca de nuevo aunque la guardada sirva. Una fila en OBSERVAR por un "evitar" no se vuelve a verificar
 * sola hasta el ranking posterior a su vencimiento (AII: un evitar falso del 15/9); a mano tiene que poder pedirse.
 */
export async function verifyFor(deps: VerifyDeps, symbol: string, opts: { today: string; name: string | null; context?: string | null; budget?: VerifyBudget; forzar?: boolean }): Promise<VerificationSummary | null> {
  const verifier = deps.verifier;
  if (!verifier) return null;
  const sym = symbol.toUpperCase();
  const prev = await deps.store.verification(sym);
  const fresca = !opts.forzar && prev !== null && ageDays(prev.date, opts.today) < VERIFY_FRESH_DAYS;
  if (prev && fresca && prev.promptVersion === verifier.promptVersion) return summary(prev);
  // Cambió el estructurador pero no lo que se le pregunta a la web (18/9): el informe guardado se vuelve a estructurar.
  // No es una búsqueda: no descuenta presupuesto, y la fila conserva su fecha (los 7 días se cuentan desde la búsqueda).
  if (prev && fresca && prev.researchText && verifier.reestructurar && verifier.puedeReestructurar?.(prev.promptVersion, prev.researchText)) {
    try {
      const r = await verifier.reestructurar({ symbol: sym, today: prev.date, researchText: prev.researchText, sources: prev.sources, model: prev.model });
      const full: CandidateVerification = { ...r, symbol: sym, date: prev.date, detectedAt: new Date().toISOString(), promptVersion: verifier.promptVersion };
      await deps.store.saveVerification(full);
      deps.log?.(`[radar] verificación de ${sym} re-estructurada sin buscar: ${prev.verdict} → ${full.verdict}`, { reason: full.reason });
      return summary(full);
    } catch (e) {
      deps.log?.(`[radar] re-estructurar la verificación de ${sym} falló: queda la anterior`, { error: String(e).slice(0, 160) });
      return summary(prev);
    }
  }
  if (opts.budget && opts.budget.left <= 0) {
    // Sin presupuesto en esta corrida: queda lo viejo (con su fecha) o pendiente para la próxima.
    return prev ? summary(prev) : null;
  }
  if (opts.budget) opts.budget.left--;
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
