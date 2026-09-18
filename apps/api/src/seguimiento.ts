import { refreshWatchlist, replan, seguimientoAlDia } from "@thesis/pipeline";
import type { Container } from "./container.js";

/**
 * Refresco de la lista de seguimiento: uno a la vez y, en el alta, solo lo nuevo (18/9).
 *
 * Agregar un ticker tardaba unos 10 minutos. El alta rehacía los 19 símbolos de la lista en serie (velas, noticias,
 * clasificador de eventos con Gemini en 503, ofertas de la SEC), después el plan y los controles, y recién ahí
 * respondía: el botón quedaba en "…". El dueño agregó RNR a las 13:39 y WTRG a las 13:42 y hubo tres refrescos
 * completos corriendo a la vez, cada uno con su ranking del universo entero.
 *
 * Las reglas:
 * - El alta responde apenas guarda el símbolo; el refresco corre después y la lista avisa qué se está analizando.
 * - Se refresca solo lo pedido, salvo que la lista todavía no se haya refrescado hoy (ver `seguimientoAlDia`).
 * - Nunca corren dos refrescos de seguimiento a la vez en este proceso: las altas que llegan mientras corre una vuelta
 *   se juntan en la siguiente, y los otros que refrescan (la corrida programada, una verificación) esperan su turno.
 */
type Resultado = Awaited<ReturnType<typeof refreshWatchlist>>;

export interface EstadoSeguimiento {
  /** Símbolos que esperan la próxima vuelta. */
  pendientes: Set<string>;
  /** Alguien pidió la lista entera (el refresco a mano). */
  completo: boolean;
  /** Lo que se está refrescando ahora. */
  enCurso: string[];
  /** El día de la última vuelta pedida (los tests lo fijan con ?today=). */
  hoy: string;
  /** La vuelta pedida que todavía no empezó: lo que llegue se suma a ella. */
  agendada: Promise<Resultado> | null;
  /** El turno: cada refresco de seguimiento se encadena acá. */
  turno: Promise<unknown>;
}

const estado = (c: Container): EstadoSeguimiento => (c.seguimiento ??= { pendientes: new Set(), completo: false, enCurso: [], hoy: "", agendada: null, turno: Promise.resolve() });

/** Corre `fn` cuando terminó el refresco de seguimiento anterior, haya fallado o no. */
export function enTurno<T>(c: Container, fn: () => Promise<T>): Promise<T> {
  const st = estado(c);
  const r = st.turno.then(fn);
  st.turno = r.catch(() => undefined);
  return r;
}

/** Lo que espera o se está analizando: es lo que la pantalla muestra como "analizando…". */
export function refrescando(c: Container): string[] {
  const st = estado(c);
  return [...new Set([...st.enCurso, ...st.pendientes])].sort();
}

/** Termina cuando no queda ningún refresco de seguimiento corriendo ni esperando. */
export async function seguimientoQuieto(c: Container): Promise<void> {
  const st = estado(c);
  let visto: Promise<unknown>;
  do { visto = st.turno; await visto; } while (visto !== st.turno);
}

/**
 * Pide refrescar `simbolos` (sin `simbolos`, la lista entera). Devuelve la vuelta que lo cubre: el alta no la espera,
 * el refresco a mano sí. Quien no la espera tiene que atajar su error.
 */
export function pedirRefresco(c: Container, opts: { today: string; simbolos?: string[] }): Promise<Resultado> {
  const st = estado(c);
  st.hoy = opts.today;
  if (opts.simbolos) for (const s of opts.simbolos) st.pendientes.add(s.toUpperCase());
  else st.completo = true;
  return (st.agendada ??= enTurno(c, () => darVuelta(c)));
}

async function darVuelta(c: Container): Promise<Resultado> {
  const st = estado(c);
  const deps = c.radarDeps;
  // Lo pedido hasta acá es de esta vuelta; lo que llegue desde ahora es de la siguiente.
  const today = st.hoy;
  const pedidos = [...st.pendientes];
  const pidieronTodo = st.completo;
  st.pendientes.clear();
  st.completo = false;
  st.agendada = null;
  st.enCurso = pedidos;
  try {
    const completo = pidieronTodo || !(await seguimientoAlDia(deps.store, today));
    if (completo) st.enCurso = (await deps.store.watchlist()).map((i) => i.symbol.toUpperCase());
    const portfolioUsd = async () => (await deps.store.latestRisk())?.report.totalValue ?? null;
    const r = await refreshWatchlist(deps, { today, portfolioUsd: await portfolioUsd(), ...(completo ? {} : { only: pedidos }) });
    // Lo que se sacó de la lista mientras se analizaba no deja fila: el plan la compraría como seguimiento.
    await deps.store.pruneCandidates(today, "watch", (await deps.store.watchlist()).map((w) => w.symbol)).catch(() => 0);
    // Toda corrida que cambia las candidatas rearma el plan: el plan es la única fuente de COMPRAR (14/9).
    await replan(deps, { today, portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return r;
  } catch (e) {
    console.error("[seguimiento] el refresco falló", e);
    throw e;
  } finally {
    st.enCurso = [];
  }
}
