import { z } from "zod";

/**
 * El veredicto del analista sobre cada línea del plan (10/10). Decisión del dueño: "la app siempre tiene que tener tu
 * último veredicto". Sin esto había dos voces: la app compraba siete y el analista, en el chat, recomendaba tres.
 *
 * Por qué no es una opinión suelta. El 10/10 el analista dijo a la mañana que JBL era "la más clara" y a la tarde que no.
 * Su criterio sin medir no es estable. Así que:
 *
 * 1. Lo que se puede medir con la historia se mide y, si se sostiene, es una REGLA de la app (ver `ordenMedido`). Ese
 *    mismo día se midieron tres objeciones del analista: "stop a más de 15%" resultó al revés y "media de 200 en
 *    baja" fue ruido. Se descartaron.
 * 2. Lo que no se puede medir entra por acá, y solo con uno de estos criterios. Un "no" sin criterio de la lista no
 *    valida: no es una opinión libre, es una lista corta y fija, para que el analista no busque razones hasta encontrar.
 * 3. Cada veredicto queda guardado: el registro mide después si los "no" del analista acertaron.
 */
export const CRITERIOS_ANALISTA = {
  valuacion_extrema_con_insiders: "cotiza a más de 60 veces su ganancia y los insiders vendieron 10 veces o más sin comprar en 90 días",
  deterioro_no_capturado: "un hecho concreto y reciente en contra (guía, pérdida de un cliente, litigio material) que la app no tiene como bandera",
  dato_erroneo: "un dato de la app está mal y cambia la lectura (con la fuente que lo corrige)",
  concentracion: "repite una exposición que el plan o la cartera ya tienen (mismo eslabón de cadena)",
} as const;
export type CriterioAnalista = keyof typeof CRITERIOS_ANALISTA;

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const VeredictoAnalistaSchema = z
  .object({
    symbol: z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,9}$/),
    fecha: fechaIso,
    veredicto: z.enum(["si", "no"]),
    criterio: z.enum(Object.keys(CRITERIOS_ANALISTA) as [CriterioAnalista, ...CriterioAnalista[]]).nullable(),
    motivo: z.string().min(1).max(300),
    fuente: z.object({ url: z.string().url(), titulo: z.string().min(1) }).nullable(),
  })
  .refine((v) => v.veredicto === "si" || v.criterio !== null, { message: "un \"no\" tiene que citar un criterio de la lista" })
  // La fuente se exige donde el hecho viene de afuera. Valuación e insiders y concentración salen de los datos de la app.
  .refine((v) => v.veredicto === "si" || v.criterio === "concentracion" || v.criterio === "valuacion_extrema_con_insiders" || v.fuente !== null, { message: "un \"no\" por un hecho o un dato erróneo tiene que traer la fuente" });
export type VeredictoAnalistaEntrada = z.infer<typeof VeredictoAnalistaSchema>;
export interface VeredictoAnalista extends VeredictoAnalistaEntrada { version: string }

/** Un veredicto vale unos días: el agente lo rehace cada mañana para lo que está en el plan. */
export const VEREDICTO_VIGENCIA_DIAS = 5;

/** El último veredicto vigente de cada símbolo (por fecha), o nada. */
export function veredictosVigentes(vs: readonly VeredictoAnalista[], today: string): Map<string, VeredictoAnalista> {
  const out = new Map<string, VeredictoAnalista>();
  const hoy = Date.parse(today);
  for (const v of [...vs].sort((a, b) => a.fecha.localeCompare(b.fecha))) {
    const edad = (hoy - Date.parse(v.fecha)) / 86_400_000;
    if (edad >= 0 && edad <= VEREDICTO_VIGENCIA_DIAS) out.set(v.symbol.toUpperCase(), v);
  }
  return out;
}

/** El texto con el que queda afuera una línea por un "no" del analista. */
export const textoNoDelAnalista = (v: Pick<VeredictoAnalista, "criterio" | "motivo">) => `el analista dice no (${v.criterio ? CRITERIOS_ANALISTA[v.criterio] : "sin criterio"}): ${v.motivo}`;
