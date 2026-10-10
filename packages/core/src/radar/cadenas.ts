import { z } from "zod";

/**
 * Cadenas de valor (10/10): tema → eslabón → acciones. Viven en `config/cadenas.json` y cambian poco.
 *
 * Por qué. Un hecho de sector se cargaba de a una fila por símbolo, a mano: el 8/10 fueron 36 filas para 7 temas, y la
 * lista de símbolos de cada tema era criterio del momento. Con el mapa, el hecho se escribe UNA vez sobre un eslabón
 * ("ia.memoria") y el importador lo expande a sus acciones. El hecho sigue teniendo una sola fuente primaria y un
 * solo sesgo; lo que se vuelve explícito, revisable y versionado es a quién le toca.
 */
const id = z.string().regex(/^[a-z_]+(\.[a-z_]+)?$/, "id en minúsculas con punto: tema o tema.eslabon");
export const EslabonSchema = z.object({ id, nombre: z.string().min(1), simbolos: z.array(z.string().regex(/^[A-Z][A-Z0-9.-]{0,9}$/)).min(1) });
export const CadenasSchema = z.object({
  revisado: z.string(),
  nota: z.string().optional(),
  cadenas: z.array(z.object({ id, nombre: z.string().min(1), eslabones: z.array(EslabonSchema).min(1) })),
});
export type Cadenas = z.infer<typeof CadenasSchema>;

/** Las acciones de un eslabón, o null si el eslabón no existe (el importador lo rechaza con su motivo). */
export function simbolosDelEslabon(c: Cadenas, eslabon: string): string[] | null {
  for (const t of c.cadenas) for (const e of t.eslabones) if (e.id === eslabon) return [...e.simbolos];
  return null;
}

/** El nombre legible de un eslabón ("memoria"), para la ficha. */
export function nombreDelEslabon(c: Cadenas, eslabon: string): string | null {
  for (const t of c.cadenas) for (const e of t.eslabones) if (e.id === eslabon) return `${t.nombre} → ${e.nombre}`;
  return null;
}
