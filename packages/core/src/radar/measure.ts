/** Medición del Radar (spec etapa 2 §10): OBSERVAR es el grupo de control de los filtros. Puro. */
export type RadarVerdict = "COMPRAR" | "OBSERVAR" | "NUCLEO";
export const RADAR_VERDICTS: RadarVerdict[] = ["COMPRAR", "OBSERVAR", "NUCLEO"];
export interface RadarMeasured {
  verdict: RadarVerdict;
  kind: string;
  alpha7dPct: number | null;
  alpha30dPct: number | null;
  alpha90dPct: number | null;
}
type H = "h7" | "h30" | "h90";
interface Bucket {
  n: number;
  avgAlpha: number | null;
  hitRate: number | null;
}
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const HS: Array<[H, keyof RadarMeasured]> = [["h7", "alpha7dPct"], ["h30", "alpha30dPct"], ["h90", "alpha90dPct"]];

function bucket(verdict: string, alphas: number[]): Bucket {
  if (!alphas.length) return { n: 0, avgAlpha: null, hitRate: null };
  const avg = round4(alphas.reduce((s, a) => s + a, 0) / alphas.length);
  const hitRate = verdict === "OBSERVAR" ? null : round4(alphas.filter((a) => a > 0).length / alphas.length);
  return { n: alphas.length, avgAlpha: avg, hitRate };
}

export function summarizeRadar(rows: RadarMeasured[]): { byVerdict: Record<RadarVerdict, Record<H, Bucket>>; comprarVsObservar: Record<H, { diff: number | null; nComprar: number; nObservar: number }>; pending: number } {
  const byVerdict = {} as Record<RadarVerdict, Record<H, Bucket>>;
  for (const v of RADAR_VERDICTS) {
    const mine = rows.filter((r) => r.verdict === v);
    byVerdict[v] = {} as Record<H, Bucket>;
    for (const [h, key] of HS) byVerdict[v][h] = bucket(v, mine.map((r) => r[key] as number | null).filter((a): a is number => a !== null));
  }
  const comprarVsObservar = {} as Record<H, { diff: number | null; nComprar: number; nObservar: number }>;
  for (const [h] of HS) {
    const c = byVerdict.COMPRAR[h];
    const o = byVerdict.OBSERVAR[h];
    comprarVsObservar[h] = { diff: c.n && o.n ? round4(c.avgAlpha! - o.avgAlpha!) : null, nComprar: c.n, nObservar: o.n };
  }
  return { byVerdict, comprarVsObservar, pending: rows.filter((r) => r.alpha7dPct === null || r.alpha30dPct === null || r.alpha90dPct === null).length };
}
