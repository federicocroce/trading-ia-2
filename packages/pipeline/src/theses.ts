import type { Thesis } from "@thesis/core";
import type { Store } from "./store.js";

/** Todos los estados, para leer cada evento con todas sus tesis. */
export const TODOS_LOS_ESTADOS: Thesis["status"][] = ["proposed", "rejected", "approved", "open", "closed"];
/** Tope de lectura para el barrido: hoy hay 265 tesis; si algún día hay más, se ven primero las más nuevas. */
const LECTURA_MAX = 10_000;

/**
 * Una tesis viva por evento (15/9).
 *
 * El 15/9 el 6-K de Vista (evento cb3536a7) tenía cinco tesis propuestas vivas al mismo tiempo, con entradas de 75,5 a
 * 80 y objetivos de 82 a 88. El de Pampa (c3272f24) tenía tres. Eran lecturas del mismo filing: hasta el 13/9 cada
 * corrida volvía a guardar el filing y a mandárselo a Gemini, y la migración 0020 apuntó todas esas tesis al evento
 * original. Propuestas mostraba las cinco, con números distintos, y cualquiera se podía aprobar.
 *
 * Regla: la última lectura de un evento es la que vale. Toda tesis propuesta más vieja del mismo evento queda
 * reemplazada por esa última, aunque la última haya sido rechazada. En Pampa las cuatro lecturas más nuevas dieron edge
 * 10 puntos, bajo el umbral, así que las tres propuestas anteriores tampoco siguen vivas. Si el evento ya tiene una tesis
 * aprobada o abierta, ésa es la viva: ya se actuó sobre ese evento y una propuesta nueva sería una segunda posición.
 *
 * Devuelve, por cada tesis reemplazada, la que la reemplaza. Incluye las que el barrido ya retiró (rechazadas sin motivo
 * de la base), para que el historial siga diciendo por qué salieron.
 */
export function tesisReemplazadas(theses: Thesis[]): Map<string, Thesis> {
  const porEvento = new Map<string, Thesis[]>();
  for (const t of theses) porEvento.set(t.rawEventId, [...(porEvento.get(t.rawEventId) ?? []), t]);
  const out = new Map<string, Thesis>();
  for (const grupo of porEvento.values()) {
    if (grupo.length < 2) continue;
    const orden = [...grupo].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const vigente = orden.find((t) => t.status === "approved" || t.status === "open") ?? orden[0]!;
    for (const t of orden) {
      if (t.id === vigente.id) continue;
      // Las rechazadas por umbral, riesgo o por vos ya tienen su motivo. Una rechazada sin motivo es una que se retiró por esta regla.
      const retirada = t.status === "rejected" && t.rejectionReason === null;
      if (t.status === "proposed" || retirada) out.set(t.id, vigente);
    }
  }
  return out;
}

/** Todas las tesis, las más nuevas primero. */
export async function todasLasTesis(store: Pick<Store, "thesesByStatus">): Promise<Thesis[]> {
  return (await store.thesesByStatus(TODOS_LOS_ESTADOS, LECTURA_MAX)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Retira las propuestas reemplazadas: pasan a rechazadas. Idempotente; lo corre la corrida de tesis al terminar.
 *
 * El motivo no se guarda. La base solo acepta tres motivos de rechazo (umbral, riesgo y humano) y agregar
 * "reemplazada" es una migración. Queda la tesis rechazada sin motivo, y quien la muestra lo reconstruye con
 * `tesisReemplazadas`: la última lectura del mismo evento es otra.
 */
export async function retirarReemplazadas(store: Pick<Store, "thesesByStatus" | "setThesisStatus">): Promise<Array<{ id: string; ticker: string; por: string }>> {
  const todas = await todasLasTesis(store);
  const porId = new Map(todas.map((t) => [t.id, t]));
  const out: Array<{ id: string; ticker: string; por: string }> = [];
  for (const [id, por] of tesisReemplazadas(todas)) {
    const t = porId.get(id)!;
    if (t.status !== "proposed") continue;
    await store.setThesisStatus(id, "rejected");
    out.push({ id, ticker: t.ticker, por: por.id });
  }
  return out;
}
