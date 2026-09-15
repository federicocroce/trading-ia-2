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
export type PlanStatus =
  /** `trancheUsd`: el primer tramo, cuando el plan va en tramos (15/9). */
  | { kind: "comprar" | "seguimiento" | "sumar" | "nucleo"; amountUsd: number; trancheUsd?: number }
  | { kind: "fuera"; reason: string }
  /** Está en el plan, pero los controles no dejan ejecutarlo (15/9). */
  | { kind: "frenado"; lineKind: "comprar" | "seguimiento" | "sumar" | "nucleo"; amountUsd: number; reason: string }
  | null;

export interface Instruccion {
  label: "COMPRAR" | "SUMAR" | "NÚCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR" | "ESPERAR";
  /** Clase de color (`verb <tone>` en styles.css). */
  tone: "COMPRAR" | "SUMAR" | "NUCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR" | "ESPERAR";
  /** Lo que el dueño necesita leer al lado: el monto o por qué no se compra. */
  detail: string | null;
}

const usd = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;
/**
 * Con tramos, el total y el primer tramo (15/9): la tabla de ETFs decía "USD 24.000 en el plan de hoy" y el jueves se
 * compran 8.000. El monto del tramo es el del plan; un plan guardado sin él lo calcula con la misma regla.
 */
const enPlan = (s: { amountUsd: number; trancheUsd?: number }) => (s.trancheUsd !== undefined ? `${usd(s.amountUsd)} en el plan · 1er tramo ${usd(s.trancheUsd)}` : `${usd(s.amountUsd)} en el plan de hoy`);
/** "5° por convicción: verificación web con reservas: …" → sin el lugar en la fila, que no le importa a quien lee. */
const sinLugar = (reason: string) => reason.replace(/^(?:\d+° por convicción|seguimiento|ETF): /, "");

/**
 * Por qué el plan no se puede ejecutar ahora, o null si se puede (15/9). La app no dice COMPRAR sobre un plan que sus
 * propios controles no revisaron, que no pudieron revisar o en el que encontraron un error grave. El 15/9 el plan
 * decía "comprar NVDA" con NVDA ya en OBSERVAR, y el control que lo detecta existía pero nadie lo corría.
 */
export function controlesBloquean(plan: ContributionPlan | null): string | null {
  if (!plan || !plan.lines.length) return null;
  // Revisión antes de comprar en curso: lo que falta revisar cambiaría los montos de las demás líneas al rearmarse.
  if (plan.reviewsPending?.length) return `revisión antes de comprar en curso (${plan.reviewsPending.join(", ")}): el plan se rearma solo cuando termina`;
  const k = plan.controles;
  if (!k || !plan.builtAt || k.planBuiltAt !== plan.builtAt) return "los controles automáticos todavía no revisaron este plan (tardan hasta un minuto)";
  if (k.error) return `los controles no pudieron correr: ${k.error}`;
  if (k.graves > 0) {
    const g = k.findings.find((f) => f.severity === "grave");
    return `la app encontró ${k.graves === 1 ? "un error grave" : `${k.graves} errores graves`} en sus propios datos${g ? ` (${g.symbol ? `${g.symbol}: ` : ""}${g.detail})` : ""}`;
  }
  return null;
}

/** El plan de hoy compra este símbolo y nada lo frena: la única condición para decir "comprar ahora" (15/9). */
export function planLoCompra(symbol: string, plan: ContributionPlan | null): boolean {
  const s = planStatusFor(symbol, plan);
  return !!s && (s.kind === "comprar" || s.kind === "seguimiento" || s.kind === "sumar");
}

/** Dónde está el símbolo en el plan: una línea con monto, afuera con motivo, o nada (el plan no lo consideró). */
export function planStatusFor(symbol: string, plan: ContributionPlan | null): PlanStatus {
  if (!plan) return null;
  const sym = symbol.toUpperCase();
  const line = plan.lines.find((l) => l.symbol.toUpperCase() === sym);
  if (line) {
    const freno = controlesBloquean(plan);
    if (freno) return { kind: "frenado", lineKind: line.kind, amountUsd: line.amountUsd, reason: freno };
    const tramos = plan.tranches ?? 1;
    return tramos > 1 ? { kind: line.kind, amountUsd: line.amountUsd, trancheUsd: line.trancheUsd ?? Math.floor(line.amountUsd / tramos) } : { kind: line.kind, amountUsd: line.amountUsd };
  }
  const fuera = plan.leftOut?.find((x) => x.symbol.toUpperCase() === sym);
  if (fuera) return { kind: "fuera", reason: fuera.reason };
  // Un SUMAR que el plan no sumó queda en las notas ("No se sumó TSM: <motivo>. Su parte …").
  const nota = plan.notes.map((n) => new RegExp(`^No se sumó ${sym}: (.+?)(?:\\. Su parte.*)?\\.?$`).exec(n)).find((m) => m !== null);
  return nota ? { kind: "fuera", reason: nota[1]! } : null;
}

/** Veredicto del Radar (COMPRAR/OBSERVAR/NUCLEO) → lo que se muestra. `context` "argentina": ningún plan compra en pesos. */
const esperar = (status: { amountUsd: number; reason: string }): Instruccion => ({ label: "ESPERAR", tone: "ESPERAR", detail: `no ejecutar: ${status.reason}` });

export function instruccionRadar(verdict: string, status: PlanStatus, context?: "argentina"): Instruccion {
  if (verdict === "OBSERVAR") return { label: "OBSERVAR", tone: "OBSERVAR", detail: null };
  if (status && status.kind === "frenado") return esperar(status);
  if (verdict === "NUCLEO") return { label: "NÚCLEO", tone: "NUCLEO", detail: status && status.kind === "nucleo" ? enPlan(status) : null };
  if (status && (status.kind === "comprar" || status.kind === "seguimiento")) return { label: "COMPRAR", tone: "COMPRAR", detail: enPlan(status) };
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status) };
  const detail = context === "argentina" ? "el plan en dólares no compra papeles argentinos" : status && status.kind === "fuera" ? `no se compra: ${sinLugar(status.reason)}` : "no está en el plan de hoy";
  return { label: "CANDIDATA", tone: "CANDIDATA", detail };
}

/** Veredicto de Cartera → lo que se muestra. SUMAR solo si el plan lo suma; si no, se mantiene y se dice por qué. */
export function instruccionCartera(verb: Verb, status: PlanStatus): Instruccion {
  if (verb !== "SUMAR") return { label: verb, tone: verb, detail: null };
  if (status && status.kind === "frenado") return esperar(status);
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status) };
  return { label: "MANTENER", tone: "MANTENER", detail: status && status.kind === "fuera" ? `no se suma hoy: ${sinLugar(status.reason)}` : "no se suma en el plan de hoy" };
}
