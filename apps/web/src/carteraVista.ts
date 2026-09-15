import type { ContributionPlan, PlanLine, Verdict } from "./api";
import type { Instruccion } from "./instruccion";

/**
 * Qué muestra una fila de Cartera: objetivo, motivo y narración, siempre de acuerdo con la instrucción (15/9).
 *
 * TSM el 15/9: el plan no lo sumaba y la etiqueta decía MANTENER, pero la fila seguía mostrando el objetivo de SUMAR
 * (533,92, medido desde el techo de la franja de compra 453,18), el motivo "Candidata a aporte" y un modelo que decía
 * "El veredicto SUMAR se justifica". La etiqueta decía una cosa y el resto de la fila, otra.
 *
 * Reglas:
 * - el objetivo principal es siempre el de la posición (`holdTarget`, calculado en core). El de una compra nueva va
 *   aparte y rotulado "si sumás desde X", solo si el plan suma;
 * - si el plan no suma lo que el análisis por precio proponía sumar, el motivo es el del plan;
 * - la narración del modelo, escrita sobre SUMAR, queda rotulada como tal.
 */
export interface VistaFila {
  /** Objetivo de lo que ya tenés: cierre + 2 × (cierre − stop). */
  objetivo: number | null;
  /** Objetivo de la compra nueva, solo si el plan suma: desde el techo de la franja. */
  siSumas: { desde: number | null; objetivo: number | null } | null;
  motivo: string;
  narrativa: string | null;
}

/** La línea SUMAR del plan para ese símbolo, si la hay: de ahí salen el techo y el objetivo de la compra. */
export function lineaSumar(plan: ContributionPlan | null, symbol: string): PlanLine | null {
  return plan?.lines.find((l) => l.kind === "sumar" && l.symbol.toUpperCase() === symbol.toUpperCase()) ?? null;
}

const sinPunto = (s: string) => s.trim().replace(/\.+$/, "");

export function vistaFila(v: Verdict, ins: Instruccion, linea: PlanLine | null): VistaFila {
  // Todo veredicto que no es SUMAR ya trae el objetivo de la posición en `target`; la API lo manda igual en `holdTarget`.
  const objetivo = v.holdTarget !== undefined ? v.holdTarget : v.verb === "SUMAR" ? null : v.target;
  if (v.verb !== "SUMAR") return { objetivo, siSumas: null, motivo: v.reason, narrativa: v.narrative };
  const compra = { desde: linea?.entryHigh ?? null, objetivo: linea?.target ?? v.target };
  if (ins.label === "SUMAR") return { objetivo, siSumas: compra, motivo: v.reason, narrativa: v.narrative };
  const detalle = sinPunto(ins.detail ?? "no se suma en el plan de hoy");
  if (ins.label === "ESPERAR") return { objetivo, siSumas: compra, motivo: `Esperá (${detalle}). Cuando se pueda ejecutar, el plan suma: ${v.reason}`, narrativa: v.narrative };
  const conObjetivo = objetivo !== null ? ` y el objetivo de la posición es $${objetivo}` : "";
  return {
    objetivo,
    siSumas: null,
    motivo: `Mantené (${detalle}). Tu stop sube solo a $${v.stop ?? "—"}${conObjetivo}: salís solo si cierra abajo.`,
    narrativa: v.narrative ? `El análisis por precio sugería sumar; el plan no lo suma (${detalle}). Lo que escribió el modelo sobre ese análisis: ${v.narrative}` : null,
  };
}
