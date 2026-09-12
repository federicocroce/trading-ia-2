import { atr, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { sma } from "./candidate.js";

/**
 * Momento de entrada (2026-09-11). El filtro técnico del Radar solo dice si la acción está en tendencia;
 * no decía nada sobre CUÁNDO comprarla, y el "entryHigh" era el cierre × 1,02, un número inventado.
 * Acá se responde con tres cosas concretas: un estado, un precio y una condición con vencimiento.
 *
 * No predice. Mide dos cosas observables y las cruza:
 * - Extensión: a cuántos ATR está el precio de su media de 20 ruedas. Comprar 3 ATR arriba es pagar el envión.
 * - Lugar en el rango de 60 ruedas: contexto que se informa, NO dispara por sí solo. Una acción que sube despacio
 *   y sin sobresaltos está siempre en el techo de su rango y es sana: bloquearla por eso sería no comprarla nunca.
 *
 * Estados, en orden de evaluación:
 * - `esperar_confirmacion`: cerró bajo la media de 50. Puede ser un retroceso sano o el principio de otra cosa;
 *   se compra recién cuando supera el máximo de las últimas 10 ruedas.
 * - `esperar_retroceso`: extendida. Se compra con orden limitada en la media de 20.
 * - `retroceso`: está por debajo de su media de 20 dentro de una tendencia alcista. Es la mejor zona.
 * - `en_zona`: ni extendida ni floja. Se compra ahora.
 */
export type EntryState = "retroceso" | "en_zona" | "esperar_retroceso" | "esperar_confirmacion";

export interface EntryTiming {
  state: EntryState;
  /** El número que manda: el límite de una orden, o el disparador que hay que ver antes de comprar. */
  level: number;
  /** Qué es ese nivel, en palabras ("media de 20 ruedas"). */
  levelLabel: string;
  /** Piso de la franja de compra. Siempre ≤ `high`, también cuando hay que esperar un retroceso. */
  low: number;
  /** Techo de la franja: el precio máximo que tiene sentido pagar. Es el que dimensiona la posición. */
  high: number;
  /** Ruedas de validez de la condición; pasadas, se vuelve a evaluar. */
  validSessions: number;
  sma20: number;
  sma50: number | null;
  atr14: number;
  /** (precio − media de 20) / ATR. Positivo = arriba de su media. */
  extensionAtr: number;
  /** Dónde está el precio dentro del rango de 60 ruedas, en %. 100 = en el máximo. */
  rangePct60: number | null;
  why: string;
}

export const ENTRY_THRESHOLDS = {
  /** A partir de acá está extendida y conviene esperar el retroceso. */
  extendedAtr: 1.5,
  /** Solo para el texto: a partir de acá se dice que además está en el techo de su rango. */
  highRangePct: 85,
  /** Debajo de esto ya está comprando en retroceso. */
  pullbackAtr: -0.5,
  /** Ruedas de validez de una orden condicional. */
  validSessions: 15,
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function entryTiming(candles: Candle[]): EntryTiming | null {
  const s20 = sma(candles, 20);
  const a = atr(candles, 14);
  const close = candles[candles.length - 1]?.close;
  if (s20 === null || a === null || a <= 0 || close === undefined) return null;
  const s50 = sma(candles, 50);
  // El stop dinámico manda sobre el momento de entrada. COPX el 12/9 decía en verde "comprar ahora, es la
  // mejor zona" y diez líneas más abajo, en rojo, "precio por debajo del stop": estar barato contra la
  // media de 20 no es una oportunidad si el papel ya perforó la línea que anula la tesis.
  const stopActual = computeTrailingStop(candles);
  const last60 = candles.slice(-60);
  const min60 = Math.min(...last60.map((c) => c.low));
  const max60 = Math.max(...last60.map((c) => c.high));
  const rangePct60 = max60 > min60 ? Math.round(((close - min60) / (max60 - min60)) * 100) : null;
  const extensionAtr = r2((close - s20) / a);
  const t = ENTRY_THRESHOLDS;
  const base = { sma20: s20, sma50: s50, atr14: r2(a), extensionAtr, rangePct60, validSessions: t.validSessions };

  if (stopActual !== null && close <= stopActual) {
    const level = r2(stopActual);
    return { ...base, state: "esperar_confirmacion", level, levelLabel: "su stop dinámico", low: level, high: r2(level * 1.02), why: `cerró en ${close} y su stop dinámico está en ${level}: la tesis técnica ya se anuló, no se compra hasta que lo recupere` };
  }
  if (s50 !== null && close < s50) {
    // Se compra la confirmación, no la caída: el disparador es el máximo reciente y recién ahí se paga hasta 2% más.
    const level = r2(Math.max(...candles.slice(-10).map((c) => c.high)));
    return { ...base, state: "esperar_confirmacion", level, levelLabel: "máximo de las últimas 10 ruedas", low: level, high: r2(level * 1.02), why: `cerró bajo su media de 50 (${s50}): esperá un cierre arriba de ${level} antes de comprar` };
  }
  if (extensionAtr >= t.extendedAtr) {
    const techo = rangePct60 !== null && rangePct60 >= t.highRangePct ? ` y en el ${rangePct60}% de su rango de 60 ruedas` : "";
    return { ...base, state: "esperar_retroceso", level: s20, levelLabel: "media de 20 ruedas", low: r2(s20 * 0.99), high: s20, why: `está ${extensionAtr} ATR arriba de su media de 20${techo}: comprar acá es pagar el envión. Orden limitada en ${s20}` };
  }
  if (extensionAtr <= t.pullbackAtr) {
    return { ...base, state: "retroceso", level: r2(close * 1.01), levelLabel: "hasta 1% sobre el precio", low: close, high: r2(close * 1.01), why: `está ${Math.abs(extensionAtr)} ATR debajo de su media de 20 y sigue en tendencia: es la mejor zona` };
  }
  return { ...base, state: "en_zona", level: r2(close * 1.02), levelLabel: "hasta 2% sobre el precio", low: close, high: r2(close * 1.02), why: `ni extendida ni floja (${extensionAtr} ATR de su media de 20, ${rangePct60 ?? "—"}% del rango de 60)` };
}

/** ¿Se puede comprar hoy, o hay que esperar un nivel? */
export const entryIsNow = (e: EntryTiming | null | undefined): boolean => !e || e.state === "retroceso" || e.state === "en_zona";
