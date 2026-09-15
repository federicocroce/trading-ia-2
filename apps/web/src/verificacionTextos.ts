/**
 * Lógica de la sección "Verificación y estados" de la ficha y del Radar. Pura, para poder probarla sin dibujar nada.
 */

/**
 * Banda de credibilidad de la ganancia por acción del núcleo contra la de la fuente: la MISMA que `CORE_EPS_BAND` del
 * núcleo (packages/core/src/radar/statements.ts), que la usa para no reemplazar el P/E de Finnhub. El test las compara.
 */
export const BANDA_EPS_NUCLEO = { min: 1 / 3, max: 3 };

/**
 * P/E sobre la ganancia núcleo. El 15/9 SNDK mostraba "P/E núcleo 0,1 (Finnhub 22,3)": 1.518,66 / 10.881 de EPS,
 * porque el último trimestre venía con 1.000.000 de acciones diluidas contra ~157 millones de los anteriores. El
 * núcleo ya descarta ese número (no reemplaza el P/E de la fuente), pero la pantalla dividía igual. Fuera de la banda
 * no se muestra: no es un ajuste por extraordinarios, es un error de extracción de acciones.
 */
export function peNucleo(i: { close: number | null; coreEps: number | null | undefined; epsFuente: number | null | undefined }): { valor: number | null; texto: string; motivo: string | null } {
  const eps = i.coreEps;
  if (eps === null || eps === undefined || eps <= 0 || !i.close) return { valor: null, texto: "—", motivo: null };
  const fuente = i.epsFuente;
  if (fuente !== null && fuente !== undefined && fuente > 0) {
    const r = eps / fuente;
    if (r < BANDA_EPS_NUCLEO.min || r > BANDA_EPS_NUCLEO.max) {
      return { valor: null, texto: "—", motivo: `la ganancia por acción del núcleo (${eps.toFixed(2)}) no es creíble contra la de Finnhub (${fuente.toFixed(2)}): ${r.toFixed(1)} veces, casi siempre un error en las acciones de un trimestre de la SEC. El núcleo tampoco la usa: vale el P/E de Finnhub` };
    }
  }
  const valor = i.close / eps;
  return { valor, texto: valor.toFixed(1), motivo: null };
}
