import { todayLocal, verificationOrder } from "@thesis/core";
import { refreshRadar, refreshWatchlist, replan, verifyFor } from "@thesis/pipeline";
import type { Container } from "./container.js";
import { enTurno } from "./seguimiento.js";

/**
 * Verificaciones pendientes (15/9). La verificación web corre con la corrida de la mañana; si Google está saturado a
 * esa hora, las candidatas quedaban sin verificar hasta el día siguiente y el plan, sin acciones todo el día (el 15/9
 * APH, TSM y PBT fallaron por 503 a las 7:50). Ahora las de más convicción que no tienen la verificación vigente se
 * reintentan solas cada 15 minutos, de a dos y hasta 6 veces por día; las que salen bien refrescan su fila y el plan.
 *
 * Qué se verifica lo dice el plan (`verificationsPending`): lo que solo la verificación frena. Antes se tomaban las de
 * más convicción sin verificar, y SNDK y NBN, que una regla fija dejaba afuera igual, se llevaban la cuota.
 */
const REINTENTO_MS = 15 * 60_000;
const INTENTOS_MAX = 6;
const POR_VUELTA = 2;
/** Cuántas acciones y de seguimiento, por orden del plan, se consideran "lo que el plan compraría". */
const ACCIONES = 3;
const SEGUIMIENTO = 1;

export interface EstadoVerificaciones {
  ultimoIntento: Map<string, number>;
  intentos: Map<string, number>;
  corriendo: boolean;
}

const portfolioUsd = async (c: Container) => (await c.store.latestRisk().catch(() => null))?.report.totalValue ?? null;

export async function asegurarVerificaciones(c: Container, opts: { hoy?: string; ahora?: () => number; refrescar?: (simbolos: string[]) => Promise<unknown> } = {}): Promise<void> {
  const verifier = c.radarDeps.verifier;
  const st = (c.verificaciones ??= { ultimoIntento: new Map(), intentos: new Map(), corriendo: false });
  if (!verifier || st.corriendo) return;
  st.corriendo = true;
  try {
    const hoy = opts.hoy ?? todayLocal();
    const ahora = (opts.ahora ?? Date.now)();
    const filas = await c.store.latestCandidates();
    const sinVigente = (r: (typeof filas)[number]) => !r.verification || r.verification.promptVersion !== verifier.promptVersion;
    const falta = (r: (typeof filas)[number]) => r.verdict === "COMPRAR" && sinVigente(r);
    const plan = await c.store.latestPlan().catch(() => null);
    const porSimbolo = new Map(filas.map((r) => [r.symbol, r]));
    // La lista del plan ya viene en su orden (sumar, acciones por convicción, seguimiento). Se vuelve a mirar la fila:
    // si la verificación llegó después de armar el plan, ya no toca. Un plan guardado antes de la lista usa el orden viejo.
    const delPlan = plan?.verificationsPending?.map((s) => porSimbolo.get(s)).filter((r): r is (typeof filas)[number] => !!r && sinVigente(r));
    const acciones = delPlan ? delPlan.filter((r) => r.kind !== "watch").slice(0, ACCIONES) : verificationOrder(filas.filter((r) => r.kind === "stock"), await c.store.allTags()).filter(falta).slice(0, ACCIONES);
    const seguimiento = delPlan ? delPlan.filter((r) => r.kind === "watch").slice(0, SEGUIMIENTO) : filas.filter((r) => r.kind === "watch" && falta(r)).sort((a, b) => (a.riskScore ?? 10) - (b.riskScore ?? 10)).slice(0, SEGUIMIENTO);
    const toca = [...acciones, ...seguimiento]
      .map((r) => r.symbol)
      .filter((s) => ahora - (st.ultimoIntento.get(`${hoy}|${s}`) ?? -Infinity) >= REINTENTO_MS && (st.intentos.get(`${hoy}|${s}`) ?? 0) < INTENTOS_MAX)
      .slice(0, POR_VUELTA);
    if (!toca.length) return;
    const bien: string[] = [];
    for (const s of toca) {
      const k = `${hoy}|${s}`;
      st.ultimoIntento.set(k, ahora);
      st.intentos.set(k, (st.intentos.get(k) ?? 0) + 1);
      const name = (await c.store.profile(s).catch(() => null))?.profile.name ?? null;
      const v = await verifyFor({ store: c.radarDeps.store, verifier, log: (m, extra) => console.log(m, extra ?? "") }, s, { today: hoy, name });
      if (v && v.promptVersion === verifier.promptVersion) bien.push(s);
    }
    if (!bien.length) return;
    const refrescar = opts.refrescar ?? (async (simbolos: string[]) => {
      const usd = await portfolioUsd(c);
      await refreshRadar(c.radarDeps, { today: hoy, portfolioUsd: usd, only: simbolos });
      await enTurno(c, () => refreshWatchlist(c.radarDeps, { today: hoy, portfolioUsd: usd, only: simbolos }));
      await replan(c.radarDeps, { today: hoy, portfolioUsd: usd });
      await c.controlar?.();
    });
    await refrescar(bien);
  } finally {
    st.corriendo = false;
  }
}
