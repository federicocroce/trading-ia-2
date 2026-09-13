import type { Candle } from "../cartera/types.js";

/**
 * Splits sin ajustar en una serie de precios (2026-09-13). Puro.
 *
 * Por qué existe. MIRG.BA el 12/9: la serie guardada pasa de 16.350 a 1.640 entre el 1 y el 3 de agosto.
 * No fue un derrumbe del 90%, fue un split 10 a 1 que la fuente no ajustó hacia atrás. Y ese salto no se
 * queda quieto: la fuerza relativa a 12 meses salía −93%, la media de 200 mezclaba precios de dos escalas,
 * el stop se calculaba contra máximos diez veces más altos y la fila se mostraba igual que cualquier otra.
 *
 * Lo mismo pasó con los objetivos de analistas de APH tras su split 2 a 1, y ahí la decisión fue la misma
 * que acá: no se borra el dato ni se lo "corrige" adivinando, porque una caída real del 90% existe. Se
 * detecta, se deja de calcular encima y se dice.
 *
 * Regla de diseño: solo se marca un salto si el cociente se parece MUCHO a una razón de split grande. Una
 * caída del 50% en un día es una catástrofe, no un split, y tiene que seguir contando como catástrofe.
 *
 * Los umbrales de acá abajo no se eligieron a ojo: se corrió el detector contra los 134 símbolos guardados.
 * Con una versión más permisiva (razones desde 1,5 y tolerancia 8%) marcaba once símbolos y diez eran
 * falsos positivos, todos movimientos reales de un día: JANX −53% por un ensayo clínico fallido, MP +51%
 * por el acuerdo con Defensa, SMCI −33%, SEZL −34% tras resultados, CROX −29%. Justo los hechos que la app
 * existe para ver. El único split verdadero era MIRG.BA, 10 a 1.
 *
 * De ahí las dos decisiones: el piso sube a 2,5× (ningún papel del universo se movió tanto en una rueda por
 * razones reales) y la tolerancia baja a 3% (un split parte el precio casi exacto; un derrumbe cae donde
 * cae). Se pierde poder para detectar splits 2 a 1, que son indistinguibles de un −50%: ese caso queda
 * cubierto por el chequeo de objetivos de analistas fuera de escala, que fue el que delató a APH.
 */

/** Razones de split lo bastante grandes como para no confundirse con una rueda mala. */
export const SPLIT_RATIOS = [3, 4, 5, 6, 8, 10, 20] as const;

/** Cuánto puede alejarse el cociente observado de la razón redonda para seguir siendo ese split, en %. */
export const SPLIT_TOLERANCE_PCT = 3;

/** Un salto menor a esto ni se mira: el mercado llega solo hasta acá en una rueda. */
export const SPLIT_MIN_JUMP = 2.5;

export interface SplitJump {
  /** Rueda en la que aparece el precio ya en la escala nueva. */
  date: string;
  /** Cierre anterior y cierre del día del salto. */
  from: number;
  to: number;
  /** Cuántas veces cambió la escala: 10 es un 10 a 1, 0.5 un reverse 1 a 2. */
  ratio: number;
  /** La razón redonda a la que se parece, ya en el sentido del salto. */
  matched: number;
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * Saltos de escala compatibles con un split, del más viejo al más nuevo. Vacío = la serie es continua.
 *
 * Se compara cierre contra cierre porque es lo que la app usa para todo lo demás; un hueco de apertura
 * genuino no llega a estas magnitudes sin ser noticia.
 */
export function splitJumps(candles: Candle[]): SplitJump[] {
  const out: SplitJump[] = [];
  for (let i = 1; i < candles.length; i++) {
    const from = candles[i - 1]!.close;
    const to = candles[i]!.close;
    if (from <= 0 || to <= 0) continue;
    const ratio = from / to;
    const escala = Math.max(ratio, 1 / ratio);
    if (escala < SPLIT_MIN_JUMP) continue;
    const candidata = SPLIT_RATIOS.find((r) => Math.abs(escala / r - 1) * 100 <= SPLIT_TOLERANCE_PCT);
    if (candidata === undefined) continue;
    out.push({ date: candles[i]!.date, from, to, ratio: r4(ratio), matched: ratio > 1 ? candidata : r4(1 / candidata) });
  }
  return out;
}

/**
 * ¿La ventana que se va a medir cruza un split sin ajustar? `sessions` es el largo de la ventana, contado
 * desde el final, igual que lo cuentan `returnPct` y `relativeStrength`.
 */
export function crossesSplit(candles: Candle[], sessions: number): SplitJump | null {
  if (candles.length === 0) return null;
  const desde = candles[Math.max(0, candles.length - 1 - sessions)]!.date;
  return splitJumps(candles).find((j) => j.date > desde) ?? null;
}
