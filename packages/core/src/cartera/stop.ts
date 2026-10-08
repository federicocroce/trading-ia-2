import type { Candle } from "./types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ATR(period): media del true range de las últimas `period` velas. null si faltan velas (necesita period+1). */
export function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
  }
  return sum / period;
}

/**
 * Stop "chandelier": máximo de las últimas `period` velas menos `atrMult` × ATR(period).
 *
 * Es una ventana MÓVIL y sin memoria: sube cuando la acción hace máximos nuevos y **baja cuando un máximo
 * sale de la ventana**, sin que el precio haya hecho nada. Hasta el 6/10/2026 este comentario decía "nunca
 * baja" y nada en la función lo garantizaba: medido sobre las 8 posiciones del dueño y 64 ruedas, bajaba en
 * 236 de 512 transiciones (46,1%). Para el stop de una POSICIÓN eso no sirve —el veredicto se daba vuelta
 * solo— y el trinquete está en `ratchetStop`. Para una CANDIDATA sí es lo que se quiere: es "dónde estaría el
 * stop hoy", no una promesa.
 *
 * Portado de trading v1.
 */
export function computeTrailingStop(candles: Candle[], opts: { period?: number; atrMult?: number } = {}): number | null {
  const period = opts.period ?? 22;
  const mult = opts.atrMult ?? 3;
  const a = atr(candles, period);
  if (a === null) return null;
  const highest = Math.max(...candles.slice(-period).map((c) => c.high));
  return round2(highest - mult * a);
}

/**
 * Trinquete del stop de una posición: el de hoy nunca es más bajo que el de ayer (2026-10-06).
 *
 * Por qué existe. `computeTrailingStop` es una ventana móvil de 22 velas, así que el stop baja cuando un
 * máximo viejo sale de la ventana. Con GGAL el 6/10/2026 pasó de 41,75 a 41,53 sin un máximo nuevo. El
 * efecto sobre el veredicto es el que importa: con el precio congelado en 38,25 el stop llegaba a 37,87 en
 * diez ruedas y el VENDER se daba vuelta **solo**, sin que la posición mejorara. Un VENDER que se resuelve
 * esperando no es un VENDER, y la pantalla le dice al dueño "tu stop sube solo a $X".
 *
 * `previo` sale del último veredicto guardado de ese símbolo, así que el trinquete queda anclado a cuando la
 * posición entró a la app y no a un máximo anterior a la compra.
 *
 * Si hoy no se pudo calcular (faltan velas), devuelve null en vez de reusar el anterior: un problema de datos
 * se dice, no se tapa con un número de ayer disfrazado de hoy.
 */
export function ratchetStop(calculado: number | null, previo: number | null): number | null {
  if (calculado === null) return null;
  return previo === null ? calculado : Math.max(calculado, previo);
}

/** Distancia mínima, en ATR de 14 ruedas, entre el piso de la franja de compra y el stop de una compra nueva. */
export const ENTRY_STOP_ATR = 2.5;

/**
 * Stop de una COMPRA NUEVA (2026-09-13). El de seguimiento sirve para una posición que ya tenés: sube con
 * los máximos y te saca cuando el precio se da vuelta. Usado como stop inicial, después de un retroceso queda
 * pegado al precio: NVDA el 13/9 compraba a 218,29 con el stop en 214,89, a 0,44 ATR, y con dos años de velas
 * un stop a esa distancia se tocó en las 5 ruedas siguientes el 71% de las veces. Era un boleto que el ruido
 * ejecutaba solo, y el "2 a 1" que se mostraba al lado no tenía nada que ver con lo que iba a pasar.
 *
 * Por eso: el más bajo entre el de seguimiento y el piso de la franja menos 2,5 ATR. Nunca sube el stop por
 * encima del de seguimiento (no agrega riesgo de salida); solo le da el aire mínimo que necesita para existir.
 */
export function entryStop(candles: Candle[], entryLow: number): number | null {
  const trailing = computeTrailingStop(candles);
  const a = atr(candles, 14);
  if (trailing === null || a === null) return null;
  return round2(Math.min(trailing, entryLow - ENTRY_STOP_ATR * a));
}

/** Objetivo con riesgo/beneficio 2:1 respecto del stop. */
export function computeTarget(close: number, stop: number | null): number | null {
  if (stop === null) return null;
  return round2(close + 2 * (close - stop));
}

/**
 * Objetivo de lo que YA TENÉS: cierre + 2 × (cierre − stop). Único lugar donde se calcula (15/9).
 *
 * El 15/9 el plan no sumaba TSM y Cartera mostraba igual el objetivo de SUMAR, 533,92, medido desde el techo de la
 * franja de compra (453,18): el precio de una compra que no se iba a hacer. Lo que ya tenés se mide desde el cierre:
 * 418,01 + 2 × (418,01 − 412,81) = 428,41. El objetivo de una compra nueva es otro número y se rotula
 * "si sumás desde X". Todo veredicto que no es SUMAR ya trae éste; la API lo sirve junto a cada veredicto.
 */
export function holdTargetOf(v: { close: number; stop: number | null }): number | null {
  // Con el precio en o bajo el stop no hay objetivo que mostrar (6/10/2026): `cierre + 2 × (cierre − stop)`
  // devuelve un número DEBAJO del precio y la columna publicaba un objetivo de baja. Pasaba en 6 de las 8
  // posiciones: VIST mostraba 56,70 con el papel en 66,54 y +49% de ganancia. No es un número mal calculado,
  // es que la operación no se puede plantear: si el precio ya se dio vuelta, no hay riesgo hasta el stop que
  // duplicar. Misma guarda que `decideArStock` tiene desde el 12/9.
  if (v.stop !== null && v.close <= v.stop) return null;
  return computeTarget(v.close, v.stop);
}
