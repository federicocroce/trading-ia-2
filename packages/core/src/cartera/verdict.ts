import { computeTarget, computeTrailingStop } from "./stop.js";
import type { Candle, Layer, Verb } from "./types.js";

export interface VerdictInput {
  /** Velas diarias ascendentes; la última es el cierre de decisión. */
  candles: Candle[];
  /** Precio vivo (informa gain intradiario y el aviso de toque; no decide). */
  spot: number | null;
  avgCost: number;
  layer: Layer;
  weightPct: number;
  positionsCount: number;
  /** YYYY-MM-DD */
  today: string;
}
export interface PositionVerdict {
  verb: Verb;
  reason: string;
  warning: string | null;
  close: number;
  stop: number | null;
  target: number | null;
  gainPct: number;
  stale: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/** Fail-closed: con una vela de hace más de `maxCalendarDays` no se puede afirmar nada sobre el stop. */
export function isStale(lastCandleDate: string, today: string, maxCalendarDays = 4): boolean {
  return (Date.parse(today) - Date.parse(lastCandleDate)) / DAY > maxCalendarDays;
}

export function sumarCriteria(i: { weightPct: number; positionsCount: number; close: number; stop: number | null; return21dPct: number | null }): { ok: boolean; why: string } {
  const equal = 100 / Math.max(1, i.positionsCount);
  if (i.stop === null) return { ok: false, why: "sin stop" };
  if (i.return21dPct === null) return { ok: false, why: "sin retorno de 21 velas" };
  if (i.weightPct >= 0.8 * equal) return { ok: false, why: `pesa ${round2(i.weightPct)}% ≥ 80% del igualitario (${round2(equal)}%)` };
  if (i.close <= i.stop) return { ok: false, why: "bajo el stop" };
  if (i.return21dPct > 15) return { ok: false, why: `subió ${round2(i.return21dPct)}% en 21 velas (no perseguir)` };
  return { ok: true, why: `pesa ${round2(i.weightPct)}% (< 80% de ${round2(equal)}%), está arriba del stop y subió ${round2(i.return21dPct)}% en 21 velas` };
}

/** Jerarquía de decisión (spec §4). Puro. */
export function decideVerb(i: VerdictInput): PositionVerdict {
  const last = i.candles[i.candles.length - 1];
  if (!last) {
    return { verb: "REVISAR", reason: "No tengo velas para este símbolo: no puedo decidir.", warning: "Sin precio. La app NO está vigilando esta posición.", close: Number.NaN, stop: null, target: null, gainPct: Number.NaN, stale: true };
  }
  const close = last.close;
  const stop = computeTrailingStop(i.candles);
  const target = computeTarget(close, stop);
  const gainPct = round2(((close - i.avgCost) / i.avgCost) * 100);
  const base = { close, stop, target, gainPct, stale: false };

  if (isStale(last.date, i.today)) {
    const where = stop !== null ? (close <= stop ? ` Con ese cierre ($${close}) estarías BAJO el stop $${stop}.` : ` Con ese cierre ($${close}) estabas arriba del stop $${stop}.`) : "";
    return { ...base, stale: true, verb: "REVISAR", reason: `No pude cotizar hoy: la última vela es del ${last.date}. Revisá el precio real antes de decidir.`, warning: `Precio del ${last.date}, no de hoy.${where} La app NO está vigilando esta posición hasta que vuelva a cotizar.` };
  }
  if (stop !== null && close <= stop && i.layer !== "riesgo") {
    return { ...base, verb: "MANTENER", reason: `Capa ${i.layer}: no se vende por stop. Un índice diversificado se recupera; vender acá cristaliza la caída.`, warning: `Cerró ($${close}) bajo tu stop $${stop}, pero esta posición es ${i.layer} y el stop duro no aplica (medido a 7 años: +62.6% vendiendo por stop vs +166.0% sin tocar).` };
  }
  if (stop !== null && close <= stop) {
    return { ...base, verb: "VENDER", reason: `Cerró ($${close}) bajo tu stop dinámico $${stop}: el precio se dio vuelta. Salí para proteger ${gainPct >= 0 ? "la ganancia" : "capital"}.`, warning: null };
  }
  if (stop !== null && i.spot !== null && i.spot <= stop) {
    return { ...base, verb: "MANTENER", reason: `Dejá correr. Tu stop está en $${stop} y el objetivo en $${target}: salís solo si CIERRA abajo.`, warning: `Intradiario tocó tu stop $${stop} (spot $${i.spot}), pero todavía no cerró abajo. La venta se confirma con el cierre.` };
  }
  if (stop === null) {
    return { ...base, verb: "MANTENER", reason: "No pude calcular el stop: faltan velas (necesito 23). Mantené y revisá a mano.", warning: "Sin stop dinámico hasta tener 23 velas." };
  }
  const return21dPct = i.candles.length >= 22 ? round2((close / i.candles[i.candles.length - 22]!.close - 1) * 100) : null;
  const sumar = sumarCriteria({ weightPct: i.weightPct, positionsCount: i.positionsCount, close, stop, return21dPct });
  if (sumar.ok) {
    return { ...base, verb: "SUMAR", reason: `Candidata a aporte: ${sumar.why}. Stop $${stop}, objetivo $${target}.`, warning: null };
  }
  return { ...base, verb: "MANTENER", reason: `Dejá correr. Tu stop sube solo a $${stop} y el objetivo es $${target}: salís solo si cierra abajo.`, warning: null };
}

/** El modelo solo puede degradar MANTENER/SUMAR a REVISAR. Cualquier otra cosa se ignora. */
export function applyDegrade(v: PositionVerdict, note: { degrade: boolean; degradeReason?: string } | null): PositionVerdict {
  if (!note?.degrade) return v;
  if (v.verb !== "MANTENER" && v.verb !== "SUMAR") return v;
  const motivo = note.degradeReason?.trim() || "el modelo ve deterioro sin especificar";
  return { ...v, verb: "REVISAR", reason: `El modelo pide revisar: ${motivo}. Tu regla dura es el stop en $${v.stop ?? "—"}: decidí vos.` };
}
