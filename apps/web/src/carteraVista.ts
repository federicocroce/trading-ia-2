import type { ContributionPlan, Measurement, PlanLine, Position, Quote, Verdict } from "./api";
import type { Instruccion } from "./instruccion";

/**
 * Las dos volatilidades de la pantalla dicen su ventana (15/9). Hasta ese día la tarjeta de riesgo decía 31% y la curva
 * 51,4% sin decir sobre qué: la primera es la de las últimas 63 ruedas con los pesos de hoy, la segunda la de las 292
 * ruedas desde el 17/7/2025 con lo que tenías cada día. Miden cosas distintas y por eso no coinciden.
 */
export const rotuloVolatilidad = {
  riesgo: (sesiones: number) => `volatilidad propia, últimas ${sesiones} ruedas con los pesos de hoy`,
  curva: (sesiones: number, desde: string) => `volatilidad de las ${sesiones} ruedas desde ${desde}`,
};

/**
 * Cuánto está medido, por horizonte (15/9). "72 veredictos, 72 pendientes de medir" con 8 ya medidos a 7 días: el
 * contador sumaba como pendiente cualquier fila a la que le faltara algún horizonte. Lo que espera su cierre es lo normal;
 * lo vencido sin medir, lo único que es un problema, se dice aparte.
 */
export function textoMedicion(m: Pick<Measurement, "total"> & { pending?: number; estado?: Measurement["estado"] }): string {
  const partes = [`${m.total} veredictos.`];
  if (!m.estado) return partes[0]!;
  for (const [h, dias] of [["h7", 7], ["h30", 30]] as const) {
    const e = m.estado[h];
    const trozos = [`${e.medidas} medidos`];
    if (e.esperando) trozos.push(`${e.esperando} esperando su cierre${e.primera ? ` (el próximo, el del ${e.primera})` : ""}`);
    if (e.vencidas) trozos.push(`${e.vencidas} vencidos sin medir`);
    const lista = trozos.length > 1 ? `${trozos.slice(0, -1).join(", ")} y ${trozos.at(-1)}` : trozos[0];
    partes.push(`A ${dias} días: ${lista}.`);
  }
  return partes.join(" ");
}

/**
 * Valuación de una posición: precio vivo si llegó; si no, el cierre del veredicto (apagado). P&L en la moneda de la
 * posición, misma cuenta que la ficha por ticker.
 *
 * "Vivo" lo decide el servidor (15/9): marca viejo lo de más de 30 horas, igual para la cinta, la watchlist y la ficha.
 * Cartera tenía su propia cuenta de más de 3 días, y el mismo precio del viernes se veía vivo acá el lunes y gris en la
 * cinta. Sin la marca del servidor no se afirma que sea de hoy.
 */
export function valuation(p: Position, v: Verdict | undefined, q: Quote | null) {
  const price = q?.price ?? v?.close ?? null;
  const live = q !== null && q.stale === false;
  const cost = p.quantity * p.avgCost;
  const value = price === null ? null : price * p.quantity;
  const pnl = price === null ? null : (price - p.avgCost) * p.quantity;
  const pnlPct = price === null ? null : ((price - p.avgCost) / p.avgCost) * 100;
  return { price, live, cost, value, pnl, pnlPct };
}

/** Totales de la cartera en USD: suma solo las posiciones en USD con precio; avisa cuántas quedaron afuera. */
export function totals(positions: Position[], vBy: Map<string, Verdict>, quotes: Record<string, Quote | null>) {
  let value = 0, cost = 0, counted = 0, otherCurrency = 0, noPrice = 0;
  for (const p of positions) {
    if (p.currency !== "USD") { otherCurrency++; continue; }
    const x = valuation(p, vBy.get(p.symbol), quotes[p.symbol] ?? null);
    if (x.value === null) { noPrice++; continue; }
    value += x.value; cost += x.cost; counted++;
  }
  const pnl = value - cost;
  return { value, cost, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null, counted, otherCurrency, noPrice };
}

/**
 * Peso de cada posición sobre el MISMO valor que muestran la columna "valor" y el total de arriba (15/9). Hasta ese día
 * el peso era el del cierre guardado y el valor el del precio vivo: GGAL 25,04% contra 24,80% en la misma fila. El peso
 * al cierre sigue siendo el que usa el veredicto y va en el título de la celda. null si no entra en el total (otra
 * moneda o sin precio).
 */
export function pesosAhora(positions: Position[], vBy: Map<string, Verdict>, quotes: Record<string, Quote | null>): Record<string, number | null> {
  const tot = totals(positions, vBy, quotes);
  const out: Record<string, number | null> = {};
  for (const p of positions) {
    const x = valuation(p, vBy.get(p.symbol), quotes[p.symbol] ?? null);
    out[p.symbol] = p.currency === "USD" && x.value !== null && tot.value > 0 ? (x.value / tot.value) * 100 : null;
  }
  return out;
}

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
