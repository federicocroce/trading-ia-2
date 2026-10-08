import type { CandidateRow, Tags } from "./types.js";
import { topPicks } from "./conviction.js";

/**
 * ¿La convicción ordena bien? (8/10/2026)
 *
 * Por qué existe. El plan elige las primeras N COMPRAR **por convicción** y deja el resto afuera con el motivo
 * "tope de N posiciones nuevas". El 8/10 eso explicaba 46 de las 70 dejadas afuera: el tope, no la calidad. Si la
 * convicción discrimina, concentrar en las primeras es correcto y el tope es una decisión de tamaño. Si NO
 * discrimina, el orden es precisión falsa y reparar la misma plata en más nombres baja la varianza sin bajar la
 * media. Esto lo mide en vez de opinarlo.
 *
 * Qué mide. Por cada fecha de candidatas, ordena las COMPRAR por convicción (la misma función que usa el plan),
 * las parte en tramos y promedia el alfa contra el S&P a 7, 30 o 90 días. Un tramo de arriba que rinde más que los
 * de abajo justifica concentrar; tramos iguales dicen que el orden no aporta.
 *
 * Simplificaciones, dichas: la convicción se recalcula sin `overweight` ni `overlap` (dependen de la cartera de ESE
 * día, que no se guarda) y sin régimen por fecha. O sea mide la parte de la convicción que sale del puntaje, el
 * grupo de pares, el riesgo y las banderas, que es la dominante. No es la convicción exacta que vio el plan.
 */
export interface TramoConviccion {
  tramo: number;
  /** Puesto desde / hasta dentro de cada fecha (1 = la de mayor convicción de ese día). */
  desdePuesto: number;
  hastaPuesto: number;
  filas: number;
  simbolos: number;
  convProm: number | null;
  alfaProm: number | null;
  acierto: number | null;
  pocosSimbolos: boolean;
}

/** Con menos símbolos distintos que esto, el promedio es ruido y se dice. */
export const CONVICCION_MINIMO_SIMBOLOS = 15;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function medirConviccion(
  filas: CandidateRow[],
  tags: Record<string, Tags>,
  horizonte: 7 | 30 | 90,
  tramos = 5,
): { horizonte: number; fechas: number; desde: string | null; hasta: string | null; sinMedir: number; tramos: TramoConviccion[] } {
  const alfaDe = (f: CandidateRow) => (horizonte === 7 ? f.alpha7dPct : horizonte === 30 ? f.alpha30dPct : f.alpha90dPct);
  const porFecha = new Map<string, CandidateRow[]>();
  for (const f of filas) {
    if (f.kind !== "stock" || f.verdict !== "COMPRAR") continue;
    porFecha.set(f.candidateDate, [...(porFecha.get(f.candidateDate) ?? []), f]);
  }
  interface Obs { symbol: string; puesto: number; total: number; conv: number; alfa: number }
  const obs: Obs[] = [];
  let sinMedir = 0;
  for (const [, delDia] of porFecha) {
    // El mismo orden que usa el plan: `topPicks` ya filtra a COMPRAR con stop y objetivo usables.
    const picks = topPicks(delDia, tags, {}, Number.MAX_SAFE_INTEGER);
    const alfaPorSimbolo = new Map(delDia.map((f) => [f.symbol, alfaDe(f)]));
    picks.forEach((p, i) => {
      const a = alfaPorSimbolo.get(p.symbol);
      if (a === null || a === undefined) { sinMedir++; return; }
      obs.push({ symbol: p.symbol, puesto: i + 1, total: picks.length, conv: p.conviction, alfa: a });
    });
  }
  if (!obs.length) return { horizonte, fechas: porFecha.size, desde: null, hasta: null, sinMedir, tramos: [] };

  // Los tramos se arman por puesto RELATIVO dentro de cada día: un día con 70 COMPRAR y otro con 20 tienen que
  // comparar "el primer quinto" contra "el primer quinto", no el puesto 10 absoluto contra el puesto 10.
  const salida: TramoConviccion[] = [];
  for (let t = 0; t < tramos; t++) {
    const xs = obs.filter((o) => {
      const desde = Math.floor((t * o.total) / tramos) + 1;
      const hasta = Math.floor(((t + 1) * o.total) / tramos);
      return o.puesto >= desde && o.puesto <= hasta;
    });
    const simbolos = new Set(xs.map((o) => o.symbol)).size;
    const puestos = xs.map((o) => o.puesto);
    salida.push({
      tramo: t + 1,
      desdePuesto: puestos.length ? Math.min(...puestos) : 0,
      hastaPuesto: puestos.length ? Math.max(...puestos) : 0,
      filas: xs.length,
      simbolos,
      convProm: xs.length ? r2(xs.reduce((a, o) => a + o.conv, 0) / xs.length) : null,
      alfaProm: xs.length ? r2(xs.reduce((a, o) => a + o.alfa, 0) / xs.length) : null,
      acierto: xs.length ? Math.round((100 * xs.filter((o) => o.alfa > 0).length) / xs.length) : null,
      pocosSimbolos: simbolos < CONVICCION_MINIMO_SIMBOLOS,
    });
  }
  const fechas = [...porFecha.keys()].sort();
  return { horizonte, fechas: porFecha.size, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null, sinMedir, tramos: salida };
}
