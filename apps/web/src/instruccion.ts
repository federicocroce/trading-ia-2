import type { ContributionPlan, Verb } from "./api";

/**
 * La palabra que ve el dueño para cada símbolo, en TODAS las pantallas (14/9).
 *
 * "Si la app dice comprar yo compro, y no importa en qué pantalla esté." Hasta el 14/9 COMPRAR significaba tres
 * cosas: que pasó los filtros del Radar (Hoy, la tabla de acciones), que rankeaba alto por convicción (la tarjeta de
 * arriba) y que el plan le asignaba plata. Doce acciones decían COMPRAR y el plan compraba dos.
 *
 * Regla única: COMPRAR y SUMAR solo si el símbolo está en el plan vigente, con su monto. Lo que pasa los filtros y no
 * entra es CANDIDATA, con el motivo que da el plan. Ninguna pantalla muestra un veredicto sin pasar por acá.
 */
export type PlanStatus = { kind: "comprar" | "seguimiento" | "sumar" | "nucleo"; amountUsd: number } | { kind: "fuera"; reason: string } | null;

export interface Instruccion {
  label: "COMPRAR" | "SUMAR" | "NÚCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR";
  /** Clase de color (`verb <tone>` en styles.css). */
  tone: "COMPRAR" | "SUMAR" | "NUCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR";
  /** Lo que el dueño necesita leer al lado: el monto o por qué no se compra. */
  detail: string | null;
}

const usd = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;
const enPlan = (n: number) => `${usd(n)} en el plan de hoy`;
/** "5° por convicción: verificación web con reservas: …" → sin el lugar en la fila, que no le importa a quien lee. */
const sinLugar = (reason: string) => reason.replace(/^(?:\d+° por convicción|seguimiento|ETF): /, "");

/** Dónde está el símbolo en el plan: una línea con monto, afuera con motivo, o nada (el plan no lo consideró). */
export function planStatusFor(symbol: string, plan: ContributionPlan | null): PlanStatus {
  if (!plan) return null;
  const sym = symbol.toUpperCase();
  const line = plan.lines.find((l) => l.symbol.toUpperCase() === sym);
  if (line) return { kind: line.kind, amountUsd: line.amountUsd };
  const fuera = plan.leftOut?.find((x) => x.symbol.toUpperCase() === sym);
  if (fuera) return { kind: "fuera", reason: fuera.reason };
  // Un SUMAR que el plan no sumó queda en las notas ("No se sumó TSM: <motivo>. Su parte …").
  const nota = plan.notes.map((n) => new RegExp(`^No se sumó ${sym}: (.+?)(?:\\. Su parte.*)?\\.?$`).exec(n)).find((m) => m !== null);
  return nota ? { kind: "fuera", reason: nota[1]! } : null;
}

/** Veredicto del Radar (COMPRAR/OBSERVAR/NUCLEO) → lo que se muestra. `context` "argentina": ningún plan compra en pesos. */
export function instruccionRadar(verdict: string, status: PlanStatus, context?: "argentina"): Instruccion {
  if (verdict === "OBSERVAR") return { label: "OBSERVAR", tone: "OBSERVAR", detail: null };
  if (verdict === "NUCLEO") return { label: "NÚCLEO", tone: "NUCLEO", detail: status && status.kind === "nucleo" ? enPlan(status.amountUsd) : null };
  if (status && (status.kind === "comprar" || status.kind === "seguimiento")) return { label: "COMPRAR", tone: "COMPRAR", detail: enPlan(status.amountUsd) };
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status.amountUsd) };
  const detail = context === "argentina" ? "el plan en dólares no compra papeles argentinos" : status && status.kind === "fuera" ? `no se compra: ${sinLugar(status.reason)}` : "no está en el plan de hoy";
  return { label: "CANDIDATA", tone: "CANDIDATA", detail };
}

/** Veredicto de Cartera → lo que se muestra. SUMAR solo si el plan lo suma; si no, se mantiene y se dice por qué. */
export function instruccionCartera(verb: Verb, status: PlanStatus): Instruccion {
  if (verb !== "SUMAR") return { label: verb, tone: verb, detail: null };
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status.amountUsd) };
  return { label: "MANTENER", tone: "MANTENER", detail: status && status.kind === "fuera" ? `no se suma hoy: ${sinLugar(status.reason)}` : "no se suma en el plan de hoy" };
}
