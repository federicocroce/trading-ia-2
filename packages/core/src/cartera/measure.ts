import type { Verb } from "./types.js";

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Alpha contra "comprar SPY y no hacer nada", en puntos porcentuales. */
export function alphaPct(close: number, closeLater: number, spy: number, spyLater: number): number {
  return round4((closeLater / close - 1 - (spyLater / spy - 1)) * 100);
}

/** VENDER acierta si el papel rindió menos que SPY después; MANTENER/SUMAR si rindió más. REVISAR no se puntúa. */
export function verdictHit(verb: Verb, alpha: number): boolean | null {
  if (verb === "REVISAR") return null;
  if (verb === "VENDER") return alpha < 0;
  return alpha > 0;
}

export interface MeasuredVerdict {
  verb: Verb;
  alpha7dPct: number | null;
  alpha30dPct: number | null;
}
interface Bucket {
  n: number;
  hitRate: number | null;
  avgAlpha: number | null;
}
export interface MeasurementSummary {
  byVerb: Record<Verb, { h7: Bucket; h30: Bucket }>;
  /** Filas con algún horizonte todavía sin medir. */
  pending: number;
}

const VERBS: Verb[] = ["VENDER", "REVISAR", "MANTENER", "SUMAR"];

function bucket(verb: Verb, alphas: number[]): Bucket {
  if (!alphas.length) return { n: 0, hitRate: null, avgAlpha: null };
  const hits = alphas.map((a) => verdictHit(verb, a)).filter((h): h is boolean => h !== null);
  return { n: alphas.length, hitRate: hits.length ? round4(hits.filter(Boolean).length / hits.length) : null, avgAlpha: round4(alphas.reduce((s, a) => s + a, 0) / alphas.length) };
}

export function summarizeMeasurement(rows: MeasuredVerdict[]): MeasurementSummary {
  const byVerb = {} as MeasurementSummary["byVerb"];
  for (const v of VERBS) {
    const mine = rows.filter((r) => r.verb === v);
    byVerb[v] = {
      h7: bucket(v, mine.map((r) => r.alpha7dPct).filter((a): a is number => a !== null)),
      h30: bucket(v, mine.map((r) => r.alpha30dPct).filter((a): a is number => a !== null)),
    };
  }
  return { byVerb, pending: rows.filter((r) => r.alpha7dPct === null || r.alpha30dPct === null).length };
}
