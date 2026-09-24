import type { Candle } from "../cartera/types.js";
import { correlation } from "../cartera/risk.js";

/** Un año de ruedas. */
const VENTANA = 252;
/** Menos que esto en común y la correlación no dice nada. */
const MIN_COMUNES = 60;

export interface ParecidoConPares {
  /** Mediana de la correlación de retornos diarios contra cada par. */
  mediana: number | null;
  /** Correlación contra el mercado (SPY), la vara para decir si la mediana es baja. */
  conMercado: number | null;
  /** Se parece menos a sus pares que al mercado entero: los pares no son pares. */
  noSeParecen: boolean;
  porPar: Array<{ symbol: string; corr: number }>;
}

/** Retornos diarios de las fechas que las dos series tienen, en orden. */
function retornosComunes(a: Candle[], b: Candle[]): [number[], number[]] {
  const cb = new Map(b.map((c) => [c.date, c.close]));
  const fechas = a.map((c) => c.date).filter((d) => cb.has(d));
  const ca = new Map(a.map((c) => [c.date, c.close]));
  const ra: number[] = [];
  const rb: number[] = [];
  for (let i = 1; i < fechas.length; i++) {
    const a0 = ca.get(fechas[i - 1]!)!, a1 = ca.get(fechas[i]!)!, b0 = cb.get(fechas[i - 1]!)!, b1 = cb.get(fechas[i]!)!;
    if (a0 > 0 && b0 > 0) {
      ra.push(a1 / a0 - 1);
      rb.push(b1 / b0 - 1);
    }
  }
  return [ra, rb];
}

function corrPorFecha(a: Candle[], b: Candle[]): number | null {
  const [ra, rb] = retornosComunes(a.slice(-VENTANA - 1), b.slice(-VENTANA - 1));
  return ra.length < MIN_COMUNES ? null : correlation(ra, rb);
}

/**
 * ¿Los pares con los que la app compara a una acción se mueven como ella? (24/9, P15). GLXY salía 1 de 11 contra
 * gestoras y BDC, y VRSN 1 de 11 contra software de crecimiento: los pares vienen de Finnhub y comparten su industria
 * gruesa, así que comparar industrias no lo muestra. Se mide la correlación de retornos diarios de un año, alineada por
 * fecha, contra cada par y contra el mercado. Si la mediana contra los pares queda por debajo de la del mercado, el
 * grupo no le sirve de vara. Es una medición: no cambia ninguna regla. null = menos de 60 días en común con el mercado.
 */
export function parecidoConPares(propias: Candle[], pares: Record<string, Candle[]>, mercado: Candle[]): ParecidoConPares | null {
  const conMercado = corrPorFecha(propias, mercado);
  if (conMercado === null) return null;
  const porPar = Object.entries(pares)
    .map(([symbol, c]) => ({ symbol, corr: corrPorFecha(propias, c) }))
    .filter((x): x is { symbol: string; corr: number } => x.corr !== null)
    .sort((a, b) => b.corr - a.corr);
  const cs = porPar.map((p) => p.corr).sort((a, b) => a - b);
  const mediana = cs.length ? (cs.length % 2 ? cs[(cs.length - 1) / 2]! : (cs[cs.length / 2 - 1]! + cs[cs.length / 2]!) / 2) : null;
  return { mediana, conMercado, noSeParecen: mediana !== null && mediana < conMercado, porPar };
}
