/**
 * Medición del Radar (spec etapa 2 §10): OBSERVAR es el grupo de control de los filtros. Puro.
 *
 * Dos cosas que la pantalla decía mal hasta el 2026-09-13:
 *
 * 1. "756 apariciones, 756 pendientes de medir" se leía como una deuda de la app, y era imposible que fuera
 *    otra cosa: el Radar empezó el 7 de septiembre y una medición a 7 días no puede existir antes del 14.
 *    Un contador que nunca puede llegar a cero no informa. Ahora se separa lo que ESTÁ ESPERANDO a que pase
 *    el tiempo (normal, con la fecha en que se completa) de lo que está VENCIDO (ya pasó el plazo y sigue
 *    sin medirse: eso sí es un problema y sí puede llegar a cero).
 *
 * 2. El alpha de las filas argentinas se mide contra el MERVAL, no contra el SPY, porque es contra el
 *    Merval que se rankean. Iban a caer en la misma tabla rotulada "Medición contra SPY" a partir del 14 de
 *    septiembre, promediando dos cosas distintas en un solo número. Ahora van en su propio grupo.
 */
export type RadarVerdict = "COMPRAR" | "OBSERVAR" | "NUCLEO";
export const RADAR_VERDICTS: RadarVerdict[] = ["COMPRAR", "OBSERVAR", "NUCLEO"];

/** Familias que se miden contra el Merval, no contra el SPY: es el índice contra el que se rankean. */
const CONTRA_MERVAL = new Set(["ar", "cedear"]);

export interface RadarMeasured {
  verdict: RadarVerdict;
  kind: string;
  /** Fecha de la fila: sin ella no se puede saber si una medición falta o todavía no le tocó. */
  candidateDate?: string;
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
/** Estado de las mediciones de un horizonte. `vencidas` es el único que debería llegar a cero. */
export interface Estado {
  medidas: number;
  /** Todavía no pasó el plazo: es lo normal, no una deuda. */
  esperando: number;
  /** Ya pasó el plazo y sigue sin medirse. */
  vencidas: number;
  /** Fecha en que se completa la primera medición pendiente de este horizonte. */
  primera: string | null;
}
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const HS: Array<[H, keyof RadarMeasured, number]> = [["h7", "alpha7dPct", 7], ["h30", "alpha30dPct", 30], ["h90", "alpha90dPct", 90]];
const DAY = 86_400_000;
const masDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

function bucket(verdict: string, alphas: number[]): Bucket {
  if (!alphas.length) return { n: 0, avgAlpha: null, hitRate: null };
  const avg = round4(alphas.reduce((s, a) => s + a, 0) / alphas.length);
  const hitRate = verdict === "OBSERVAR" ? null : round4(alphas.filter((a) => a > 0).length / alphas.length);
  return { n: alphas.length, avgAlpha: avg, hitRate };
}

/** Un grupo medido contra un índice: la tabla por veredicto más el contraste COMPRAR contra OBSERVAR. */
export interface Grupo {
  byVerdict: Record<RadarVerdict, Record<H, Bucket>>;
  comprarVsObservar: Record<H, { diff: number | null; nComprar: number; nObservar: number }>;
  filas: number;
}

function grupo(rows: RadarMeasured[]): Grupo {
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
  return { byVerdict, comprarVsObservar, filas: rows.length };
}

function estado(rows: RadarMeasured[], today: string | undefined): Record<H, Estado> {
  const out = {} as Record<H, Estado>;
  for (const [h, key, dias] of HS) {
    let medidas = 0, esperando = 0, vencidas = 0;
    let primera: string | null = null;
    for (const r of rows) {
      if ((r[key] as number | null) !== null) { medidas++; continue; }
      const vence = r.candidateDate ? masDias(r.candidateDate, dias) : null;
      // Sin fecha de fila o sin hoy no se puede distinguir: se cuenta como esperando, que es lo prudente.
      if (vence === null || today === undefined || vence > today) {
        esperando++;
        if (vence !== null && (primera === null || vence < primera)) primera = vence;
      } else vencidas++;
    }
    out[h] = { medidas, esperando, vencidas, primera };
  }
  return out;
}

export function summarizeRadar(rows: RadarMeasured[], today?: string): {
  byVerdict: Record<RadarVerdict, Record<H, Bucket>>;
  comprarVsObservar: Record<H, { diff: number | null; nComprar: number; nObservar: number }>;
  pending: number;
  /** Lo mismo para las filas argentinas, que se miden contra el Merval y no pueden promediarse con las de arriba. */
  merval: Grupo;
  /** Medidas, esperando y vencidas por horizonte, sobre TODAS las filas. */
  estado: Record<H, Estado>;
} {
  const spy = rows.filter((r) => !CONTRA_MERVAL.has(r.kind));
  const merval = rows.filter((r) => CONTRA_MERVAL.has(r.kind));
  const g = grupo(spy);
  return {
    byVerdict: g.byVerdict,
    comprarVsObservar: g.comprarVsObservar,
    pending: rows.filter((r) => r.alpha7dPct === null || r.alpha30dPct === null || r.alpha90dPct === null).length,
    merval: grupo(merval),
    estado: estado(rows, today),
  };
}
