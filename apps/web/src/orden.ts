import type { Candidate, EntryTiming, PlanLine } from "./api";

/**
 * Una orden, una base (auditoría del 15/9). Hasta ese día cada pantalla elegía su precio de referencia: en la misma
 * fila del Radar el % al stop salía del cierre y el % al objetivo del techo de la franja (APH: stop −1,1% y objetivo
 * +19,7%, una relación de 18 a 1 que no existía), y el plan contaba la cantidad al cierre. Acá vive la base única: el
 * precio que vas a pagar. Sin posición, el techo de la franja (lo máximo que se paga, y el precio desde el que se
 * calcula el objetivo); con posición, el precio de hoy. El texto de cada número dice cuál es.
 */
const f2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n.toFixed(2));

export interface Base {
  price: number;
  /** "desde el techo de la franja (65.89), lo máximo que pagás", para el title del número. */
  label: string;
}

/** Base de una fila del Radar. `tenida`: ya está en cartera, así que lo que se mide es la posición al precio de hoy. */
export function baseCandidata(c: Pick<Candidate, "close" | "entryHigh">, tenida: boolean): Base {
  if (tenida) return { price: c.close, label: `desde el precio de hoy (${f2(c.close)}): ya la tenés` };
  if (c.entryHigh === null || c.entryHigh === undefined) return { price: c.close, label: `desde el cierre (${f2(c.close)})` };
  return { price: c.entryHigh, label: `desde el techo de la franja (${f2(c.entryHigh)}), lo máximo que pagás` };
}

/**
 * Base de una línea del plan: la que guardó el plan (`orderPrice`). Un plan anterior al 15/9 no la trae y se calcula
 * con la misma regla que usa el plan: núcleo y SUMAR al precio de hoy, una compra al techo de la franja.
 */
export function baseLinea(l: PlanLine): Base {
  const alCierre = l.kind === "nucleo" || l.kind === "sumar";
  const price = l.orderPrice ?? (alCierre ? l.close : (l.entryHigh ?? l.close)) ?? 0;
  const label = alCierre || l.entryHigh === null || l.entryHigh === undefined ? `al precio de hoy (${f2(price)})` : `al techo de la franja (${f2(price)}), lo máximo que pagás`;
  return { price, label };
}

/** % de `valor` contra la base. */
export const pctDesde = (valor: number | null | undefined, b: Base | null): number | null =>
  valor === null || valor === undefined || !b || !b.price ? null : (valor / b.price - 1) * 100;

export function qtyLinea(l: PlanLine): number | null {
  if (l.qty !== null && l.qty !== undefined) return l.qty;
  const b = baseLinea(l).price;
  return b ? Math.floor(l.amountUsd / b) : null;
}

/** Lo que se pierde si la línea toca su stop: cantidad × (base − stop). El núcleo no tiene stop. */
export function riesgoLinea(l: PlanLine): number {
  const b = baseLinea(l).price;
  const q = qtyLinea(l);
  return l.stop && b && q && l.stop < b ? q * (b - l.stop) : 0;
}

/** Primer tramo de la línea (monto y cantidad), o null si el plan va de una vez. */
export function tramoLinea(l: PlanLine, tranches: number | null | undefined): { usd: number; qty: number | null } | null {
  if (!tranches || tranches <= 1) return null;
  const usd = l.trancheUsd ?? Math.floor(l.amountUsd / tranches);
  const b = baseLinea(l).price;
  return { usd, qty: l.trancheQty ?? (b ? Math.floor(usd / b) : null) };
}

/**
 * Cuándo entrar, subordinado al plan (15/9). La celda decía "comprar ahora" en verde a SNDK mientras el plan no la
 * compraba: dos instrucciones en la misma fila. `enPlan`: el plan vigente la compra hoy (sin frenos). Sin eso, el
 * momento se describe ("en zona") y no se ordena.
 */
export function entryVerb(e: EntryTiming, enPlan: boolean): { text: string; tone: "ok" | "warn" | "muted" } {
  if (e.state === "retroceso" || e.state === "en_zona") return enPlan ? { text: "comprar ahora", tone: "ok" } : { text: "en zona", tone: "muted" };
  // Confirmación: el nivel está ARRIBA del precio. Una orden limitada ahí se ejecutaría enseguida; se compra si cierra arriba.
  if (e.state === "esperar_confirmacion") return { text: "si cierra arriba de", tone: "warn" };
  return { text: "esperar", tone: "warn" };
}

/** Una sola frase, la misma en la tabla y en la ficha, para que no haya dos versiones del mismo consejo. */
export function entrySentence(e: EntryTiming, enPlan: boolean): string {
  if (e.state === "retroceso" || e.state === "en_zona") {
    const franja = e.state === "retroceso" ? `hasta ${f2(e.high)}` : `entre ${f2(e.low)} y ${f2(e.high)}`;
    return enPlan ? `Comprar ahora, ${franja}: ${e.why}.` : `En zona de compra (${franja}), pero el plan de hoy no la compra: el motivo está en el veredicto.`;
  }
  if (e.state === "esperar_retroceso") return `No comprar hoy: ${e.why}, válida ${e.validSessions} ruedas. Si no baja, se vuelve a evaluar.`;
  return `No comprar hoy: ${e.why}. Se compra solo si cierra arriba de ${f2(e.level)}, válida ${e.validSessions} ruedas. No dejes una orden limitada: el nivel está arriba del precio y se ejecutaría enseguida.`;
}
