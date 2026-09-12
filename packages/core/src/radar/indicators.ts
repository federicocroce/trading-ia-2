/**
 * Series de indicadores para dibujar (2026-09-12). Puro.
 *
 * No son indicadores decorativos: son exactamente los que la app usa para decidir, así que el gráfico
 * pasa a explicar el veredicto en vez de acompañarlo. La media de 200 es el filtro de tendencia de fondo
 * que excluye candidatas; la de 50 separa "esperar confirmación" de "comprable"; la de 20 es el nivel al
 * que se pone la orden limitada cuando está estirada; el stop dinámico es la línea que, si la rompe, anula
 * la tesis. Verlos sobre el precio es poder discutirle a la app con el mismo dibujo que ella mira.
 */
export interface Bar {
  high: number;
  low: number;
  close: number;
}

/** Media móvil simple. Devuelve un valor por barra; null donde todavía no hay `n` barras. */
export function smaSeries(bars: Pick<Bar, "close">[], n: number): Array<number | null> {
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (n <= 0 || bars.length < n) return out;
  let suma = 0;
  for (let i = 0; i < bars.length; i++) {
    suma += bars[i]!.close;
    if (i >= n) suma -= bars[i - n]!.close;
    if (i >= n - 1) out[i] = suma / n;
  }
  return out;
}

/** Rango verdadero de cada barra: el mayor entre el rango del día y los saltos contra el cierre anterior. */
function trueRanges(bars: Bar[]): number[] {
  return bars.map((b, i) => {
    const prev = i > 0 ? bars[i - 1]!.close : b.close;
    return Math.max(b.high - b.low, Math.abs(b.high - prev), Math.abs(b.low - prev));
  });
}

/** ATR simple sobre `n` barras, como serie. */
export function atrSeries(bars: Bar[], n = 22): Array<number | null> {
  const tr = trueRanges(bars);
  const out: Array<number | null> = new Array(bars.length).fill(null);
  if (bars.length < n) return out;
  let suma = 0;
  for (let i = 0; i < tr.length; i++) {
    suma += tr[i]!;
    if (i >= n) suma -= tr[i - n]!;
    if (i >= n - 1) out[i] = suma / n;
  }
  return out;
}

/**
 * Stop dinámico tipo chandelier: máximo de `n` barras menos `mult` ATR. Es el mismo que usa el Radar
 * para decidir `bajo_stop`, con los mismos parámetros por defecto.
 */
export function chandelierSeries(bars: Bar[], n = 22, mult = 3): Array<number | null> {
  const atr = atrSeries(bars, n);
  return bars.map((_, i) => {
    const a = atr[i];
    if (a === null || a === undefined || i < n - 1) return null;
    let max = -Infinity;
    for (let k = i - n + 1; k <= i; k++) max = Math.max(max, bars[k]!.high);
    return max - mult * a;
  });
}
