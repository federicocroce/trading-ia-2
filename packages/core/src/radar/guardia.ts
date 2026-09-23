import { todayLocal } from "../fecha.js";
import type { ContributionPlan } from "./plan.js";

/**
 * La guardia de la mañana (23/9/2026). Contesta una sola pregunta: ¿la corrida de hoy salió bien?
 *
 * Por qué existe. Ese día la app armó el plan con cierres de dos días atrás, los controles dieron 0 graves y
 * nadie se enteró hasta que el dueño preguntó. El control que lo detecta ya existe (`velas_desfasadas`); lo que
 * faltaba era que alguien lo MIRE todos los días sin que él tenga que abrir la app. Esto es puro: decide qué
 * avisar; quién lo grita es el script de launchd.
 *
 * No inventa reglas. Hace ejecutable lo que ya decía el tipo `ContributionPlan`, hasta hoy solo en un comentario:
 * "con un grave, o sin controles sobre este plan, no se ejecuta". Y deja afuera a propósito las revisiones
 * pendientes: el 18/9 el dueño decidió que la IA avise en vez de bloquear, así que una revisión pendiente es el
 * funcionamiento normal, no una alarma. Una guardia que avisa de lo normal se vuelve ruido y se ignora.
 */
export interface JobRunState {
  lastDate: string;
  ranAt: string;
  /** Opcional, como en el store: un paso que nunca falló no tiene el campo. */
  lastError?: string | null;
}

export interface GuardiaInput {
  /** Hoy, en hora local. */
  today: string;
  plan: ContributionPlan | null;
  jobRuns: Record<string, JobRunState>;
  /** Los pasos que TENÍAN que haber corrido hoy. Lo decide quien llama: los fines de semana no corre ninguno. */
  esperados: string[];
}

export interface Aviso {
  /** Nombre corto y estable del motivo, para poder seguir uno en particular. */
  motivo: "paso_sin_correr" | "paso_con_error" | "sin_plan" | "plan_viejo" | "sin_controles" | "graves";
  detalle: string;
}

export function revisarCorrida(i: GuardiaInput): Aviso[] {
  const out: Aviso[] = [];

  // 1. La corrida tiene que haber corrido. Es el caso de la máquina dormida (tapa cerrada) o del cron caído:
  //    sin esto, el plan de anteayer se sigue mostrando como si fuera el de hoy.
  const sinCorrer = i.esperados.filter((p) => (i.jobRuns[p]?.lastDate ?? "") !== i.today);
  if (sinCorrer.length) {
    out.push({ motivo: "paso_sin_correr", detalle: `no corrió hoy: ${sinCorrer.map((p) => `${p} (última vez ${i.jobRuns[p]?.lastDate || "nunca"})`).join(", ")}` });
  }
  const conError = i.esperados.filter((p) => i.jobRuns[p]?.lastError);
  if (conError.length) {
    out.push({ motivo: "paso_con_error", detalle: conError.map((p) => `${p}: ${i.jobRuns[p]!.lastError}`).join(" · ") });
  }

  // 2. Tiene que haber un plan de hoy. `builtAt` es UTC: un plan de las 22:30 figuraba "del día siguiente" (15/9).
  if (!i.plan) {
    out.push({ motivo: "sin_plan", detalle: "no hay plan guardado" });
    return out;
  }
  const armado = i.plan.builtAt ? todayLocal(new Date(i.plan.builtAt)) : null;
  if (armado !== i.today) {
    out.push({ motivo: "plan_viejo", detalle: `el plan es del ${armado ?? "sin fecha"} y hoy es ${i.today}` });
  }

  // 3. Los controles tienen que haber corrido SOBRE ESTE plan. Unos controles de un plan anterior no dicen nada
  //    del que estás mirando, y es el caso más engañoso: la pantalla muestra "0 graves" igual.
  const c = i.plan.controles;
  if (!c || c.error || (i.plan.builtAt && c.planBuiltAt !== i.plan.builtAt)) {
    out.push({ motivo: "sin_controles", detalle: c?.error ? `los controles no pudieron correr: ${c.error}` : "el plan no está controlado (no hay controles, o son de un plan anterior)" });
    return out;
  }

  // 4. Con un grave, el plan no se ejecuta.
  if (c.graves > 0) {
    const graves = c.findings.filter((f) => f.severity === "grave");
    out.push({ motivo: "graves", detalle: graves.map((f) => `${f.check} ${f.symbol ?? ""}: ${f.detail}`).join(" · ") });
  }
  return out;
}
