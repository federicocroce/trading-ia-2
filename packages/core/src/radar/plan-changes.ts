import type { ContributionPlan } from "./plan.js";

/**
 * Por qué cambió el plan (15/9). El plan se rearma solo después de cada corrida, y el 14/9 cambió porque el
 * dueño siguió APH desde la ficha: pasó de 3.820 a 2.456 y nada lo decía. Un plan que cambia sin decir por qué
 * no se puede ejecutar con confianza. Cada plan guarda con qué datos entró cada símbolo; al rearmarse, cada
 * línea que entra, sale o cambia de monto dice qué dato cambió.
 */
export interface PlanSymbolInput {
  /** stock | etf | watch (tu lista de seguimiento) | posicion (un SUMAR de Cartera). */
  kind: string;
  /** Veredicto del Radar o verbo de Cartera. */
  verdict: string;
  close: number | null;
  stop: number | null;
  /** apto | con_reservas | evitar | pendiente | anterior (cuestionario viejo); null si no se verifica. */
  verification: string | null;
  /** Revisión antes de comprar: sin_objeciones | objecion | no_pude_verificar | pendiente. Ausente si no se revisa. */
  review?: string;
}
/** De dónde viene el cambio. `usuario` se marca aparte: no lo movió el mercado. */
export type PlanChangeSource = "mercado" | "verificacion" | "regla" | "usuario" | "reparto" | "monto";
export interface PlanChange {
  symbol: string;
  /** `aviso`: la línea sigue con el mismo monto, pero cambió lo que la IA dice de ella (18/9). */
  change: "entra" | "sale" | "monto" | "aviso";
  fromUsd: number;
  toUsd: number;
  source: PlanChangeSource;
  cause: string;
}

const coma = (n: number) => n.toFixed(2).replace(".", ",");
const avisosOf = (p: ContributionPlan, s: string) => p.lines.filter((l) => l.symbol === s).flatMap((l) => l.avisos ?? []);
const amountOf = (p: ContributionPlan, s: string) => p.lines.filter((l) => l.symbol === s).reduce((t, l) => t + l.amountUsd, 0);
/** El motivo con el que el plan dejó afuera al símbolo, sin su lugar en la fila. */
function reasonOf(p: ContributionPlan, s: string): string | null {
  const fuera = p.leftOut?.find((x) => x.symbol === s)?.reason;
  if (fuera) return fuera.replace(/^(?:\d+° por convicción|seguimiento|ETF): /, "");
  const nota = p.notes.map((n) => new RegExp(`^No se sumó ${s}: (.+?)(?:\\. Su parte.*)?\\.?$`).exec(n)).find((m) => m !== null);
  return nota ? nota[1]! : null;
}

export function explainPlanChange(prev: ContributionPlan | null, next: ContributionPlan): PlanChange[] {
  if (!prev) return [];
  const otroMonto = Math.round(prev.totalUsd) !== Math.round(next.totalUsd);
  const out: PlanChange[] = [];
  for (const s of [...new Set([...prev.lines, ...next.lines].map((l) => l.symbol))]) {
    const fromUsd = amountOf(prev, s);
    const toUsd = amountOf(next, s);
    if (Math.abs(toUsd - fromUsd) < 1) {
      // Mismo monto, otros avisos: una objeción que aparece sobre una línea que ya estaba no mueve plata, pero el dueño
      // tiene que enterarse acá (18/9: miró el plan a las 12:17 y la objeción de APH llegó a las 12:19).
      const antes = avisosOf(prev, s);
      const ahora = avisosOf(next, s);
      if (toUsd > 0 && antes.join("|") !== ahora.join("|")) {
        const nuevos = ahora.filter((a) => !antes.includes(a));
        out.push({ symbol: s, change: "aviso", fromUsd: Math.round(fromUsd), toUsd: Math.round(toUsd), source: "verificacion", cause: nuevos.length ? nuevos.join(" · ") : `ya no lleva avisos: ${antes.filter((a) => !ahora.includes(a)).join(" · ")}` });
      }
      continue;
    }
    const change: PlanChange["change"] = fromUsd === 0 ? "entra" : toUsd === 0 ? "sale" : "monto";
    const a = prev.inputs?.[s];
    const b = next.inputs?.[s];
    const reason = reasonOf(next, s);
    const esNucleo = [...prev.lines, ...next.lines].some((l) => l.symbol === s && l.kind === "nucleo");
    // Primero lo propio del símbolo (una acción tuya, el mercado, la verificación, una regla); después el monto
    // del plan; y si no cambió nada suyo, es el reparto de lo que movieron las demás.
    let source: PlanChangeSource;
    let cause: string;
    if (a && b && a.kind !== b.kind && (a.kind === "watch" || b.kind === "watch")) {
      source = "usuario";
      cause = b.kind === "watch" ? "la agregaste a tu lista de seguimiento: dejó de competir por convicción y pasó a la línea de seguimiento" : "dejó tu lista de seguimiento y volvió a competir por convicción";
    } else if (a && b && a.verdict !== b.verdict) {
      source = "mercado";
      cause = `el Radar la pasó de ${a.verdict} a ${b.verdict}${b.close !== null && b.stop !== null ? ` (cierre ${coma(b.close)}, stop ${coma(b.stop)})` : ""}`;
    } else if (a && b && a.verification !== b.verification) {
      source = "verificacion";
      cause = `verificación web: ${a.verification ?? "sin verificar"} → ${b.verification ?? "sin verificar"}${reason ? ` (${reason})` : ""}`;
    } else if (a && b && (a.review ?? null) !== (b.review ?? null)) {
      source = "verificacion";
      cause = `revisión antes de comprar: ${a.review ?? "sin revisar"} → ${b.review ?? "sin revisar"}${reason ? ` (${reason})` : ""}`;
    } else if (a && b && (a.close !== b.close || a.stop !== b.stop) && reason) {
      source = "mercado";
      cause = reason;
    } else if (change === "sale" && reason) {
      source = "regla";
      cause = reason;
    } else if (!a && b && change === "entra") {
      source = "mercado";
      cause = "es candidata nueva del Radar";
    } else if (otroMonto) {
      source = "monto";
      cause = `el monto del plan pasó de USD ${Math.round(prev.totalUsd)} a USD ${Math.round(next.totalUsd)}`;
    } else {
      source = "reparto";
      cause = esNucleo ? (toUsd > fromUsd ? "recibe lo que dejaron las líneas que salieron del plan" : "cede a las líneas que entraron al plan") : "cambió el reparto por otras líneas del plan";
    }
    out.push({ symbol: s, change, fromUsd: Math.round(fromUsd), toUsd: Math.round(toUsd), source, cause });
  }
  return out;
}
