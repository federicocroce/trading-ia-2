/**
 * Probabilidad implícita de mercado (pMarket) a partir del move implícito.
 * Modelo: retorno log-normal con σ = impliedMovePct (desvío para el horizonte del evento).
 * Es una aproximación explícita y auditable; no pretende ser precio justo.
 */

/** CDF normal estándar (Abramowitz-Stegun 26.2.17, error < 7.5e-8). */
export function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

export interface ImpliedProbabilityInput {
  spot: number;
  target: number;
  /** Fracción, ej. 0.08 para ±8%. */
  impliedMovePct: number;
  direction: "long" | "short";
}

/**
 * P(precio termine más allá de `target` en la dirección de la tesis) bajo el move implícito.
 * long: P(S_T >= target); short: P(S_T <= target).
 */
export function impliedProbability({ spot, target, impliedMovePct, direction }: ImpliedProbabilityInput): number {
  if (!(spot > 0) || !(target > 0) || !(impliedMovePct > 0)) return Number.NaN;
  const z = Math.log(target / spot) / impliedMovePct;
  return direction === "long" ? 1 - normalCdf(z) : normalCdf(z);
}

/** Probabilidad binaria implícita de un evento con resultado sí/no dado el precio de mercado y los precios en cada escenario. */
export function binaryImpliedProbability(spot: number, priceIfYes: number, priceIfNo: number): number {
  if (priceIfYes === priceIfNo) return Number.NaN;
  const p = (spot - priceIfNo) / (priceIfYes - priceIfNo);
  return Math.min(1, Math.max(0, p));
}

export * from "./sessions.js";
