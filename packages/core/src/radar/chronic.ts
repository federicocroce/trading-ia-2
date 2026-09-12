/**
 * Residente crónico: hace cuántas semanas seguidas el símbolo viene apareciendo como candidato. Puro.
 *
 * Antes se contaba distinto: cada corrida de ranking sumaba uno al contador anterior. La política se llama
 * `chronicWeeks` y vale 4, así que la intención siempre fue semanas, pero el número contaba corridas. El
 * 11/9 corrí el ranking tres veces en una noche y APH, NVDA y NBN llegaron a 4 y pasaron a OBSERVAR por
 * "residente crónico" sin que hubiera pasado un solo día. El contador dependía de cuántas veces yo apretara
 * el botón, no de cuánto llevaba la acción en la lista.
 *
 * Se mide el tramo sin huecos que termina hoy y se expresa en semanas. Contar semanas calendario resultó
 * frágil: el ranking no siempre cae el mismo día, y un domingo seguido de un martes salta un lunes y
 * cortaba la racha sin motivo. Lo que importa es que no haya un hueco largo, no en qué casilla del
 * calendario cae cada corrida.
 */
const DAY = 86_400_000;

/** Hueco máximo entre dos apariciones para considerar que la racha sigue. Cubre una semana más un feriado. */
export const RESIDENT_MAX_GAP_DAYS = 10;

const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Semanas que lleva el símbolo apareciendo sin cortarse, contando hoy.
 * 1 = apareció solo esta semana, sin importar cuántas corridas hubo. 0 = no aparece hoy.
 */
export function residentWeeks(dates: string[], today: string): number {
  const unicas = [...new Set([...dates.filter((d) => d <= today), today])].sort();
  let inicio = today;
  for (let i = unicas.length - 1; i > 0; i--) {
    const anterior = unicas[i - 1]!;
    if (days(anterior, unicas[i]!) > RESIDENT_MAX_GAP_DAYS) break;
    inicio = anterior;
  }
  return Math.floor(days(inicio, today) / 7) + 1;
}
