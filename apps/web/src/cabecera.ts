import type { Candidate, Verb } from "./api";

/**
 * Qué etiqueta lleva la cabecera de la ficha (15/9, regla "la instrucción manda"). Antes mostraba stop, objetivo y
 * relación sin decir qué hacer, y VTI tenía "NUCLEO" escrito a mano, que no podía decir ESPERAR cuando los controles
 * frenan el plan. Ahora sale de las mismas piezas que el resto de la app:
 * - con veredicto de Cartera (hay posición), `CarteraVerdict` con ese verbo: SUMAR solo si el plan lo suma;
 * - si no, el veredicto del Radar con `RadarVerdict`: COMPRAR solo si el plan lo compra, NÚCLEO o ESPERAR;
 * - Argentina y ADR, como sus tarjetas: sin plan (el plan en dólares no compra en pesos) y en contexto argentino;
 * - un CEDEAR no lleva veredicto (es un chequeo del dólar implícito, no una compra).
 */
export type ChipDeCabecera =
  | { fuente: "Cartera"; verb: Verb }
  | { fuente: "Radar"; verdict: Candidate["verdict"]; conPlan: boolean; context?: "argentina" };

export function chipDeCabecera(t: { verdict: { verb: Verb } | null; candidate: Pick<Candidate, "kind" | "verdict"> | null }): ChipDeCabecera | null {
  if (t.verdict) return { fuente: "Cartera", verb: t.verdict.verb };
  const c = t.candidate;
  if (!c || c.kind === "cedear") return null;
  if (c.kind === "ar" || c.kind === "adr") return { fuente: "Radar", verdict: c.verdict, conPlan: false, context: "argentina" };
  return { fuente: "Radar", verdict: c.verdict, conPlan: true };
}
