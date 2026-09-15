import type { Thesis } from "./api";

/**
 * Cómo se lee una tesis en Propuestas, Abiertas e Historial (15/9, B6).
 *
 * Las cinco tesis del 6-K de Vista no decían cuándo se crearon: no había forma de ver que eran cinco lecturas del mismo
 * filing en tres días. El edge decía "15%" acá y "15 puntos" en Hoy. Y el Historial mostraba 200 de 249 sin decirlo.
 */

const HORA_AR = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * Fecha y hora de creación en hora de Argentina ("11/9 07:40", como el resto de la app). La base guarda UTC, y una fecha
 * UTC nunca se muestra como local. Se arma con los números, no con el texto del navegador, para que diga lo mismo en todos.
 */
export function creadaEl(iso: string): string {
  const p = Object.fromEntries(HORA_AR.formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${Number(p.day)}/${Number(p.month)} ${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`;
}

/** El edge es probabilidad estimada menos la del mercado: una diferencia de probabilidades, en puntos (como en Hoy). */
export function edgeEnPuntos(edge: number): string {
  return `${Math.round(edge * 100)} puntos`;
}

const ESTADO: Record<string, string> = { proposed: "propuesta", rejected: "rechazada", approved: "aprobada", open: "abierta", closed: "cerrada" };

/**
 * Estado que muestra la tarjeta. Una tesis reemplazada (el mismo evento tiene una lectura más nueva) dice por cuál, con
 * su fecha; la base no puede guardar ese motivo y la dejaría como "rejected" a secas.
 */
export function estadoTesis(t: Pick<Thesis, "status" | "rejectionReason"> & { reemplazadaPor?: Thesis["reemplazadaPor"] }): string {
  const r = t.reemplazadaPor;
  if (r) return `reemplazada por la lectura del ${creadaEl(r.createdAt)} del mismo evento (${ESTADO[r.status] ?? r.status}, edge ${edgeEnPuntos(r.edge)})`;
  return `${t.status}${t.rejectionReason ? ` (${t.rejectionReason})` : ""}`;
}

/** El aviso de que la lista no está completa; null si muestra todo o si no se sabe el total. */
export function avisoTope(mostradas: number, total: { total: number; limit: number } | null): string | null {
  if (!total || total.total <= mostradas) return null;
  return `Mostrando las ${mostradas} más recientes de ${total.total}.`;
}
