/**
 * Líderes frenados solo por haber subido (21/9). META subió 12,7% en un día y la app no la compraba ni antes ni después:
 * "no perseguir"; "subió más de 100%" saca del plan a SNDK, SIMO, TER y MU. Los frenos cuidan de comprar techos, pero la
 * app decía "no" y nunca volvía con un "ahora sí". Esto marca a esas acciones y distingue a la que HOY está en una zona
 * donde entrar no es perseguir. NO cambia el veredicto, NO suma convicción y NO entra al plan: es una lista que se mide
 * (`pnpm frenos`). Si le gana al plan, se le abre lugar con otra regla; si pierde, no se puso un peso. Puro.
 */
export type EstadoDeLider = "en_retroceso" | "esperando";
/** Lo que hace "líder": el precio ya corrió. "Consenso cerca" solo no alcanza (AII, SLDE: aseguradoras cerca de su objetivo). */
const SUBIO = ["no_perseguir", "subio_mucho_12m"];
/** Motivos de OBSERVAR que un líder puede tener: todos salen de haber subido, o de llevar semanas en la lista. */
const MOTIVOS_PERMITIDOS = new Set(["no_perseguir", "salvedades_de_calidad", "stop_dentro_de_la_entrada", "residente_cronico"]);
/** Las salvedades de precio: si "dos salvedades" son solo estas, también salen de haber subido. */
const DE_PRECIO = new Set(["subio_mucho_12m", "consenso_en_precio"]);
const DE_CALIDAD = ["resultado_extraordinario", "interes_minoritario", "cobranza_lenta", "ganancia_sin_ventas"];
/** Algo en contra del negocio o un freno que no es de precio: no es un líder, es otra cosa. */
const EN_CONTRA = ["sorpresa_negativa", "guia_recortada", "investigacion_abierta", "ganancia_por_reservas", "consenso_venta", "verificacion_evitar", "banco_sin_estados", "bajo_oferta_de_compra", "evento_grave", "bajo_sma200", "bajo_stop", "sin_historial", "resultados_cerca", ...DE_CALIDAD];
const A_FAVOR = ["guia_subida", "sorpresa_positiva"];

export function estadoDeLider(d: { flags: readonly string[]; reasons: readonly string[]; entryState: string | null; target: number | null; held?: boolean }): EstadoDeLider | null {
  // Lo que ya tenés lo decide Cartera: esta lista es de entradas nuevas (si no, "en retroceso" acá y VENDER allá).
  if (d.held) return null;
  // "Esperar confirmación" es haber cerrado bajo su stop o su media de 50 (LRCX, 21/9): se está debilitando, no retrocediendo.
  if (d.entryState === "esperar_confirmacion") return null;
  if (!d.flags.some((f) => SUBIO.includes(f))) return null;
  if (d.flags.some((f) => EN_CONTRA.includes(f))) return null;
  if (d.reasons.some((r) => !MOTIVOS_PERMITIDOS.has(r))) return null;
  // Comprable hoy: ya no es perseguir (ni +15% en 21 ruedas ni extendida sobre su media), hay boleto y algo a favor.
  const enZona = (d.entryState === "en_zona" || d.entryState === "retroceso") && !d.flags.includes("no_perseguir");
  return enZona && d.target !== null && d.flags.some((f) => A_FAVOR.includes(f)) ? "en_retroceso" : "esperando";
}
/** La bandera de la fila: así la medición existente (alfa a 7, 30 y 90 días por fila) la cubre sin tabla nueva. */
export const banderaDeLider = (e: EstadoDeLider | null): string | null => (e === "en_retroceso" ? "lider_en_retroceso" : e === "esperando" ? "lider_esperando" : null);
