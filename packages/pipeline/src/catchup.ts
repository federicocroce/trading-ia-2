/**
 * Ponerse al día: qué pasos programados quedaron sin correr (la máquina estaba apagada o dormida)
 * según la última fecha registrada de cada uno. Puro: el calendario se evalúa en hora local, igual que node-cron.
 * El ranking no es un paso del calendario: va pegado al barrido (lo dispara el runner cuando hay barrido nuevo).
 */
export type StepId = "scan" | "cartera" | "radar" | "argentina" | "plan" | "tesis";
export interface StepSpec {
  id: StepId;
  label: string;
  cadence: "daily" | "weekly" | "monthly";
  hour: number;
  minute: number;
  /** Solo semanal: 0 = domingo. */
  weekday?: number;
}

/** En orden de ejecución: primero lo semanal (alimenta al resto), después lo diario, el plan, y por último las tesis (usan la cuota del modelo). */
export const STEPS: StepSpec[] = [
  { id: "scan", label: "Barrido y ranking del universo", cadence: "weekly", weekday: 0, hour: 20, minute: 0 },
  { id: "cartera", label: "Veredictos de Cartera", cadence: "daily", hour: 7, minute: 45 },
  // Argentina va ANTES que el Radar, y el orden importa (17/9, día de ejecución): `radar` termina rearmando el
  // plan, y armar el plan dispara los controles. Corriendo después, los controles juzgaban el Radar con las filas
  // de los ADR argentinos todavía del día anterior y encontraban 14 graves sobre datos que veinte segundos más
  // tarde ya estaban bien. `argentina` no depende de `radar`: sólo busca la fila previa de cada símbolo argentino.
  { id: "argentina", label: "Argentina (macro, BYMA, CEDEARs)", cadence: "daily", hour: 7, minute: 50 },
  { id: "radar", label: "Refresco y medición del Radar", cadence: "daily", hour: 7, minute: 50 },
  { id: "plan", label: "Plan del aporte", cadence: "monthly", hour: 8, minute: 0 },
  { id: "tesis", label: "Tesis por eventos", cadence: "daily", hour: 7, minute: 30 },
];

export function stepById(id: StepId): StepSpec {
  const s = STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`paso desconocido: ${id}`);
  return s;
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localMonth = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const minus = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() - days);
const pastTime = (s: StepSpec, now: Date) => now.getHours() > s.hour || (now.getHours() === s.hour && now.getMinutes() >= s.minute);

/** Última fecha (YYYY-MM-DD; YYYY-MM para lo mensual) en la que el paso debería haber corrido. */
export function expectedDate(s: StepSpec, now: Date): string {
  if (s.cadence === "monthly") {
    const thisMonth = now.getDate() > 1 || (now.getDate() === 1 && pastTime(s, now));
    return thisMonth ? localMonth(now) : localMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  }
  if (s.cadence === "weekly") {
    const wd = s.weekday ?? 0;
    if (now.getDay() === wd && pastTime(s, now)) return localDate(now);
    const back = ((now.getDay() - wd + 7) % 7) || 7;
    return localDate(minus(now, back));
  }
  // Diario lun–vie.
  const isWeekday = (d: Date) => d.getDay() >= 1 && d.getDay() <= 5;
  if (isWeekday(now) && pastTime(s, now)) return localDate(now);
  let d = minus(now, 1);
  while (!isWeekday(d)) d = minus(d, 1);
  return localDate(d);
}

export interface DueStep {
  id: StepId;
  label: string;
  last: string | null;
  expected: string;
}

/** Pasos con la última corrida anterior a la esperada (o nunca corridos), en orden de ejecución. */
export function dueSteps(last: Partial<Record<StepId, string | null>>, now: Date): DueStep[] {
  const out: DueStep[] = [];
  for (const s of STEPS) {
    const expected = expectedDate(s, now);
    const l = last[s.id] ?? null;
    if (l === null || l < expected) out.push({ id: s.id, label: s.label, last: l, expected });
  }
  return out;
}
