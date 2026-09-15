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
  /** Fecha del veredicto: sin ella no se puede saber si una medición falta o todavía no le tocó. */
  verdictDate?: string;
  alpha7dPct: number | null;
  alpha30dPct: number | null;
}
interface Bucket {
  n: number;
  hitRate: number | null;
  avgAlpha: number | null;
}
/** Estado de las mediciones de un horizonte. Las mismas palabras que la medición del Radar. */
export interface EstadoMedicion {
  medidas: number;
  /** Todavía no hay cierre para medirla: es lo normal, no una deuda. */
  esperando: number;
  /** Ya hubo cierre para medirla y sigue sin medirse. Es lo único que debería llegar a cero. */
  vencidas: number;
  /** Fecha del cierre con que se completa la primera medición que espera. */
  primera: string | null;
}
export interface MeasurementSummary {
  byVerb: Record<Verb, { h7: Bucket; h30: Bucket }>;
  /** Filas con algún horizonte todavía sin medir. No sirve para la pantalla: a 30 días no baja de "todas" en un mes. */
  pending: number;
  /** Por horizonte (15/9): medidas, esperando y vencidas. */
  estado: { h7: EstadoMedicion; h30: EstadoMedicion };
}

const VERBS: Verb[] = ["VENDER", "REVISAR", "MANTENER", "SUMAR"];
const DAY = 86_400_000;
const masDias = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
/** Primer día hábil (lunes a viernes) desde esa fecha: el plazo que cae en fin de semana se mide con el cierre del lunes. */
const habilDesde = (iso: string) => {
  let d = iso;
  while ([0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay())) d = masDias(d, 1);
  return d;
};

/**
 * Medida, esperando o vencida, por horizonte (15/9).
 *
 * La pantalla decía "72 veredictos, 72 pendientes de medir" con los 8 del 7/9 ya medidos a 7 días: contaba como
 * pendiente cualquier fila a la que le faltara algún horizonte.
 *
 * Una medición a `h` días se hace con el primer cierre desde el día del veredicto + h, y la corrida de la mañana
 * siguiente la completa. Así que está vencida recién cuando ese día hábil ya pasó y sigue sin medirse. Los del 8/9 se
 * miden con el cierre del 15/9: a la mañana del 15 esperan, no deben nada. La medición del Radar cuenta como vencida
 * lo que vence el mismo día; acá no, porque ese cierre todavía no existe. Los feriados no se conocen: uno puede hacer
 * ver una medición como vencida por un día.
 */
function estadoMedicion(rows: MeasuredVerdict[], key: "alpha7dPct" | "alpha30dPct", dias: number, today: string | undefined): EstadoMedicion {
  let medidas = 0, esperando = 0, vencidas = 0;
  let primera: string | null = null;
  for (const r of rows) {
    if (r[key] !== null) { medidas++; continue; }
    const cierre = r.verdictDate ? habilDesde(masDias(r.verdictDate, dias)) : null;
    // Sin fecha de fila o sin hoy no se puede distinguir: se cuenta como esperando, que es lo prudente.
    if (cierre === null || today === undefined || cierre >= today) {
      esperando++;
      if (cierre !== null && (primera === null || cierre < primera)) primera = cierre;
    } else vencidas++;
  }
  return { medidas, esperando, vencidas, primera };
}

function bucket(verb: Verb, alphas: number[]): Bucket {
  if (!alphas.length) return { n: 0, hitRate: null, avgAlpha: null };
  const hits = alphas.map((a) => verdictHit(verb, a)).filter((h): h is boolean => h !== null);
  return { n: alphas.length, hitRate: hits.length ? round4(hits.filter(Boolean).length / hits.length) : null, avgAlpha: round4(alphas.reduce((s, a) => s + a, 0) / alphas.length) };
}

export function summarizeMeasurement(rows: MeasuredVerdict[], today?: string): MeasurementSummary {
  const byVerb = {} as MeasurementSummary["byVerb"];
  for (const v of VERBS) {
    const mine = rows.filter((r) => r.verb === v);
    byVerb[v] = {
      h7: bucket(v, mine.map((r) => r.alpha7dPct).filter((a): a is number => a !== null)),
      h30: bucket(v, mine.map((r) => r.alpha30dPct).filter((a): a is number => a !== null)),
    };
  }
  return {
    byVerb,
    pending: rows.filter((r) => r.alpha7dPct === null || r.alpha30dPct === null).length,
    estado: { h7: estadoMedicion(rows, "alpha7dPct", 7, today), h30: estadoMedicion(rows, "alpha30dPct", 30, today) },
  };
}
