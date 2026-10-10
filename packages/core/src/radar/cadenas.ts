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

/**
 * El precio de un eslabón (10/10), con las velas de sus acciones. Es lo que pone el SIGNO de un hecho de cadena: el
 * 8/10 conté el oro como "el agujero más grande" y llevaba ocho meses cayendo; si se cargaba a favor, la app abría
 * la puerta a doce mineras todas bajo su media de 200. Medianas, no promedios: una sola acción no mueve el eslabón.
 */
export interface PrecioDeEslabon {
  conVelas: number;
  r21: number | null;
  r63: number | null;
  r126: number | null;
  /** Porcentaje de acciones del eslabón con el cierre arriba de su media de 200. */
  sobre200Pct: number | null;
  /** Mediana de la distancia al máximo de 252 ruedas, en %. */
  desdeMaxPct: number | null;
  /** "confirma" si la mayoría está sobre su media de 200; "en_contra" si la mayoría está debajo; null sin datos. */
  lectura: "confirma" | "en_contra" | null;
}
const mediana = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Math.round((s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) * 10) / 10;
};
export function precioDeEslabon(series: ReadonlyArray<ReadonlyArray<{ close: number }>>): PrecioDeEslabon {
  const utiles = series.filter((c) => c.length >= 200);
  const ret = (c: ReadonlyArray<{ close: number }>, n: number) => (c.length > n ? 100 * (c[c.length - 1]!.close / c[c.length - 1 - n]!.close - 1) : null);
  const vals = (n: number) => utiles.map((c) => ret(c, n)).filter((x): x is number => x !== null);
  const sobre = utiles.filter((c) => c[c.length - 1]!.close > c.slice(-200).reduce((a, v) => a + v.close, 0) / 200).length;
  const desde = utiles.map((c) => 100 * (c[c.length - 1]!.close / Math.max(...c.slice(-252).map((v) => v.close)) - 1));
  const sobre200Pct = utiles.length ? Math.round((100 * sobre) / utiles.length) : null;
  return { conVelas: utiles.length, r21: mediana(vals(21)), r63: mediana(vals(63)), r126: mediana(vals(126)), sobre200Pct, desdeMaxPct: mediana(desde), lectura: sobre200Pct === null ? null : sobre200Pct > 50 ? "confirma" : sobre200Pct < 50 ? "en_contra" : null };
}
