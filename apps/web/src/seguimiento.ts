/**
 * El alta a la lista de seguimiento responde enseguida y el análisis corre después (18/9): antes el botón quedaba en
 * "…" unos 10 minutos. La lista trae `refreshing` con lo que se está analizando o espera su turno; acá se decide qué
 * decir de lo que todavía no tiene fila y se vuelve a pedir la lista hasta que termina, para que la fila llegue sola.
 */
type ConRefresco = { refreshing?: string[] };

type Fallo = { symbol: string; error: string };

/**
 * Lo que seguís y todavía no tiene fila: lo que se está analizando ahora, lo que falló (con su motivo) y lo que
 * simplemente espera el próximo refresco. Mientras algo se reintenta manda el análisis en curso, no el error viejo.
 */
export function sinFila(w: { items: Array<{ symbol: string }>; rows: Array<{ symbol: string }>; failed?: Fallo[] } & ConRefresco): { analizando: string[]; fallaron: Fallo[]; esperan: string[] } {
  const conFila = new Set(w.rows.map((r) => r.symbol));
  const enCurso = new Set(w.refreshing ?? []);
  const faltan = w.items.map((i) => i.symbol).filter((s) => !conFila.has(s));
  const fallaron = (w.failed ?? []).filter((f) => faltan.includes(f.symbol) && !enCurso.has(f.symbol));
  const conFallo = new Set(fallaron.map((f) => f.symbol));
  return { analizando: faltan.filter((s) => enCurso.has(s)), fallaron, esperan: faltan.filter((s) => !enCurso.has(s) && !conFallo.has(s)) };
}

/** Cada cuánto se vuelve a pedir la lista mientras hay algo analizándose. */
export const SEGUIR_CADA_MS = 4000;

/**
 * Mientras la lista diga que hay algo analizándose, la vuelve a pedir; cuando termina, avisa una vez. Un solo sondeo
 * aunque lo llamen varias pantallas. `pedir` devuelve null si falló: la API puede estar ocupada, se sigue intentando.
 */
export function crearSeguidor(deps: { pedir: () => Promise<ConRefresco | null>; despues: (fn: () => void, ms: number) => void; avisar: () => void }): (w: ConRefresco) => void {
  let siguiendo = false;
  const mirar = async () => {
    const w = await deps.pedir();
    if (w && !(w.refreshing ?? []).length) {
      siguiendo = false;
      deps.avisar();
      return;
    }
    deps.despues(() => void mirar(), SEGUIR_CADA_MS);
  };
  return (w) => {
    if (siguiendo || !(w.refreshing ?? []).length) return;
    siguiendo = true;
    deps.despues(() => void mirar(), SEGUIR_CADA_MS);
  };
}
