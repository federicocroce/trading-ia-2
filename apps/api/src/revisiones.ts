import { todayLocal } from "@thesis/core";
import { replan, reviewPending } from "@thesis/pipeline";
import type { Container } from "./container.js";

/**
 * Revisiones pendientes (15/9): lo que el plan compra y todavía no pasó la revisión antes de comprar se revisa solo, y
 * el plan se rearma cuando termina. Desde el 18/9 la revisión no frena: la línea entra con el aviso escrito, y si la
 * revisión encuentra una objeción queda escrita en la línea en el rearmado ("por qué cambió" lo lista como aviso).
 *
 * Una búsqueda que falla no se reintenta antes de 10 minutos (la cuota de Gemini ya se agotó el 14/9), y a la tercera
 * falla del día queda "no pude verificar", que también va como aviso en la línea. Nunca se da por buena.
 */
const REINTENTO_MS = 10 * 60_000;
const FALLAS_MAX = 3;
/** Estado de los reintentos, por instancia de la app (en el contenedor): nada escondido en el módulo. */
export interface EstadoRevisiones {
  ultimoIntento: Map<string, number>;
  fallas: Map<string, { n: number; error: string }>;
  corriendo: boolean;
}

const portfolioUsd = async (c: Container) => (await c.store.latestRisk().catch(() => null))?.report.totalValue ?? null;

export async function asegurarRevisiones(c: Container, opts: { hoy?: string; rearmar?: () => Promise<unknown>; ahora?: () => number } = {}): Promise<void> {
  const reviewer = c.radarDeps.reviewer;
  const st = (c.revisiones ??= { ultimoIntento: new Map(), fallas: new Map(), corriendo: false });
  // Con el agente de Claude (22/9) la revisión la escribe el agente: si esta vuelta corriera, fallaría tres veces y
  // guardaría "no pude verificar" en cada línea del plan.
  if (!reviewer || reviewer.porAgente || st.corriendo) return;
  st.corriendo = true;
  try {
    const hoy = opts.hoy ?? todayLocal();
    const ahora = (opts.ahora ?? Date.now)();
    const rearmar = opts.rearmar ?? (async () => { await replan(c.radarDeps, { today: hoy, portfolioUsd: await portfolioUsd(c) }); await c.controlar?.(); });
    const pendientes = (await c.store.latestPlan())?.reviewsPending ?? [];
    const toca = pendientes.filter((s) => ahora - (st.ultimoIntento.get(`${hoy}|${s}`) ?? -Infinity) >= REINTENTO_MS);
    if (!toca.length) return;
    for (const s of toca) st.ultimoIntento.set(`${hoy}|${s}`, ahora);
    const r = await reviewPending(c.radarDeps, { today: hoy, symbols: toca });
    let cambio = r.reviewed.length > 0;
    for (const e of r.errors) {
      const k = `${hoy}|${e.symbol}`;
      const f = { n: (st.fallas.get(k)?.n ?? 0) + 1, error: e.error };
      st.fallas.set(k, f);
      console.error(`[revisión] ${e.symbol} falló (${f.n}/${FALLAS_MAX}): ${e.error}`);
      if (f.n >= FALLAS_MAX) {
        await c.store.savePreTradeReview({ symbol: e.symbol, date: hoy, verdict: "no_pude_verificar", reason: `la búsqueda falló ${FALLAS_MAX} veces: ${f.error}`.slice(0, 300), sources: [], researchText: "", model: "", promptVersion: reviewer.promptVersion });
        cambio = true;
      }
    }
    if (cambio) await rearmar();
  } finally {
    st.corriendo = false;
  }
}
