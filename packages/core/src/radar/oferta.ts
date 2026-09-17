/**
 * Una empresa bajo oferta de compra no se puede valuar con las reglas del Radar.
 *
 * AES el 16/9/2026: 77ª por puntaje, COMPRAR, franja 14,81-15,11, stop 14,70 y objetivo 15,93 "al doble del riesgo".
 * Ese objetivo no puede pasar: el 1/3/2026 firmó una fusión a USD 15,00 por acción en efectivo, aprobada por los
 * accionistas el 26/6/2026 con el 97,9% de los votos. Lo que quedaba por ganar era 1,28% y si el acuerdo se caía la
 * referencia sin oferta era ~11 dólares, un 25% abajo.
 *
 * El problema es que una acción así le parece PERFECTA al Radar: se mueve poco (ATR bajo), el riesgo medido da
 * bajo, y los múltiplos quedan baratos contra sus pares porque el precio está clavado contra un número fijo. Todas
 * las señales apuntan al lado equivocado a la vez.
 *
 * La prueba es el formulario, no el titular. Estos cuatro sólo existen cuando hay una fusión o una oferta en curso:
 * el poder para votarla (DEFM14A y su versión preliminar PREM14A), la respuesta obligatoria del directorio a una
 * oferta pública de adquisición (SC 14D9) y las comunicaciones de fusión (425). Un 8-K item 1.01 NO alcanza: es
 * "acuerdo material definitivo" y lo usa cualquier crédito bancario.
 */
export const FORMULARIOS_DE_OFERTA = ["DEFM14A", "PREM14A", "SC 14D9", "425"] as const;

/**
 * El formulario que prueba que la empresa está bajo oferta de compra, o null si ninguno lo hace.
 *
 * `titulos` son los títulos de filings recientes tal como los guarda el ingestor de EDGAR:
 * `"<formulario>[ (items …)] — <nombre de la empresa>"`. Se mira sólo el formulario, que es lo que está antes del
 * primer espacio o guión, para que el nombre de una empresa no dispare la regla.
 */
export function bajoOfertaDeCompra(titulos: readonly string[]): string | null {
  for (const t of titulos) {
    const formulario = t.split(" — ")[0]?.replace(/\s*\(items[^)]*\)\s*$/, "").trim();
    if (!formulario) continue;
    const hit = FORMULARIOS_DE_OFERTA.find((f) => f === formulario);
    if (hit) return hit;
  }
  return null;
}
