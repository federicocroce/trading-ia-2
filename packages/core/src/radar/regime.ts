import type { Candle } from "../cartera/types.js";

/**
 * Régimen macro (pieza 4 de la estandarización): con qué tasas se reparte el aporte. Se lee del bono a 10 años
 * (Yahoo `^TNX`, cotiza el rendimiento × 10). Una regla chica y explicable, no un pronóstico:
 * - restrictivo: 10 años ≥ 4,5% o subió ≥ 40 pb en 3 meses → reserva en letras y penalidad a lo sensible a tasas.
 * - expansivo: bajó ≥ 40 pb en 3 meses y está por debajo de 4%.
 * - neutral: el resto.
 */
export type RegimeState = "restrictivo" | "neutral" | "expansivo";
export interface MacroRegime {
  state: RegimeState;
  asOf: string;
  tenYearPct: number;
  /** Cambio del 10 años en 3 meses (63 ruedas), en puntos básicos. null sin historia suficiente. */
  change3mBp: number | null;
  /** % del aporte que va a letras del Tesoro en este régimen. */
  reservePct: number;
  why: string;
}
export const REGIME_THRESHOLDS = { restrictiveYieldPct: 4.5, restrictiveRiseBp: 40, easingDropBp: -40, easingYieldPct: 4 };
export const DEFAULT_RESERVE_PCT_RESTRICTIVE = 15;
/** Sectores y temas que sufren con tasas subiendo (REITs, servicios públicos, mineras de oro). Financiero no: gana con tasas. */
export const RATE_SENSITIVE = { sectors: new Set(["Inmobiliario", "Servicios públicos"]), themes: new Set(["oro_mineria"]) };

/** ^TNX viene multiplicado por 10 (48,4 = 4,84%); si el valor ya parece un porcentaje, se deja. */
const asPct = (v: number) => (v > 20 ? v / 10 : v);
const r2 = (n: number) => Math.round(n * 100) / 100;

export function assessRegime(tnx: Candle[], opts: { reservePctWhenRestrictive?: number | undefined } = {}): MacroRegime | null {
  if (!tnx.length) return null;
  const last = tnx[tnx.length - 1]!;
  const tenYearPct = r2(asPct(last.close));
  const prev = tnx.length > 63 ? tnx[tnx.length - 1 - 63]! : null;
  const change3mBp = prev ? Math.round((tenYearPct - asPct(prev.close)) * 100) : null;
  const t = REGIME_THRESHOLDS;
  let state: RegimeState = "neutral";
  if (tenYearPct >= t.restrictiveYieldPct || (change3mBp !== null && change3mBp >= t.restrictiveRiseBp)) state = "restrictivo";
  else if (change3mBp !== null && change3mBp <= t.easingDropBp && tenYearPct < t.easingYieldPct) state = "expansivo";
  const reservePct = state === "restrictivo" ? (opts.reservePctWhenRestrictive ?? DEFAULT_RESERVE_PCT_RESTRICTIVE) : 0;
  const chg = change3mBp === null ? "sin 3 meses de historia" : `${change3mBp >= 0 ? "+" : ""}${change3mBp} pb en 3 meses`;
  const why = state === "restrictivo" ? `10 años ${tenYearPct}% (${chg}): tasas altas o subiendo` : state === "expansivo" ? `10 años ${tenYearPct}% (${chg}): tasas bajando` : `10 años ${tenYearPct}% (${chg})`;
  return { state, asOf: last.date, tenYearPct, change3mBp, reservePct, why };
}

/** ¿Este papel sufre con tasas subiendo? Por sector o tema de sus etiquetas. */
export function isRateSensitive(tags: { sector?: string | null; themes?: string[] } | null | undefined): boolean {
  if (!tags) return false;
  if (tags.sector && RATE_SENSITIVE.sectors.has(tags.sector)) return true;
  return (tags.themes ?? []).some((t) => RATE_SENSITIVE.themes.has(t));
}
