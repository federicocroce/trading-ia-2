/**
 * Textos de los niveles de la ficha y del gráfico. Puros, para poder probarlos sin dibujar nada.
 */

const coma = (n: number, d: number) => n.toFixed(d).replace(".", ",");

/**
 * Relación ganancia/pérdida de la orden. Sin posición (niveles del Radar) se mide desde el techo de compra,
 * igual que la tarjeta del Radar: es el peor precio al que se entra. El 14/9 la ficha de APH decía
 * "relación 18,0 : 1" porque medía desde el precio en vivo, que había caído a 1,6% del stop: una orden
 * más cerca del stop parecía mejor, cuando lo que pasaba es que el stop había quedado dentro del ruido del día.
 * Con posición (Cartera) sí se mide desde el precio actual: es lo que queda por ganar y por perder desde hoy.
 */
export function relacionDeLaOrden(i: { stop: number | null; target: number | null; price: number | null; entryHigh: number | null | undefined; desde: "Radar" | "Cartera" | null }): { ratio: number; base: number; texto: string } | null {
  const techo = i.desde === "Radar" && i.entryHigh ? i.entryHigh : null;
  const base = techo ?? i.price;
  if (!base || i.stop === null || i.target === null || i.stop >= base || i.target <= base) return null;
  const ratio = (i.target - base) / (base - i.stop);
  const desde = techo !== null ? `desde el techo de compra ${coma(techo, 2)}, como en el Radar` : "desde el precio actual";
  return { ratio, base, texto: `relación ${coma(ratio, 1)} : 1 ${desde}` };
}

/**
 * La última vela del diario puede ser la sesión en curso, armada con el intradiario (`partial`). Se dibuja
 * apagada y el gráfico lo dice: no cerró, y las medias y el stop no se calculan sobre ella.
 */
export function notaVelaParcial(bars: Array<{ time: number; partial?: boolean }>): string | null {
  const ultima = bars.at(-1);
  if (!ultima?.partial) return null;
  const d = new Date(ultima.time * 1000);
  return `La última vela (${d.getUTCDate()}/${d.getUTCMonth() + 1}) es la sesión en curso, armada con el intradiario: todavía no cerró o no se guardó. Las medias y el stop se calculan con velas cerradas, así que ahí no se dibujan.`;
}
