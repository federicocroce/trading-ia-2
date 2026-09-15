import { checkPantallas, summarizeFindings, todayLocal, type ContributionPlan, type Pantallas, type PlanControles } from "@thesis/core";
import { checkRun } from "@thesis/pipeline";
import type { Container } from "./container.js";

/**
 * Controles automáticos (15/9). La auditoría de pantallas y la consistencia de filas existían desde el 12/9, pero
 * solo corrían cuando alguien las corría: el 15/9 el plan siguió diciendo "comprar NVDA" con NVDA en OBSERVAR, y el
 * control que lo detecta nunca se ejecutó. Ahora corren solos sobre cada versión del plan y el resultado queda
 * guardado en ella. Con un grave, un error o sin controles sobre la versión vigente, el plan no se ejecuta.
 */

/** Pide una ruta como la pide el navegador. Tira si no responde: una pantalla que falla no es un verde. */
export type Pedir = <T>(ruta: string) => Promise<T>;

/** Pedir sin red, al mismo proceso: las mismas rutas que usa el navegador. */
export const pedirEnProceso = (app: { request: (ruta: string) => Response | Promise<Response> }): Pedir => async <T,>(ruta: string): Promise<T> => {
  const r = await app.request(ruta);
  if (!r.ok) throw new Error(`${ruta} respondió ${r.status}`);
  return (await r.json()) as T;
};

/** Lo mismo que mira el dueño: Radar, plan (el de la base, que es el que se controla), Cartera, Hoy y el gráfico de cada línea. */
export async function juntarPantallas(pedir: Pedir, plan: ContributionPlan): Promise<Pantallas> {
  const [candidatos, veredictos, novedades, posiciones, movimientos, top] = await Promise.all([
    pedir<Pantallas["candidatos"]>("/radar/candidates"),
    pedir<Pantallas["veredictos"]>("/cartera/verdicts"),
    pedir<Pantallas["novedades"]>("/novedades"),
    pedir<NonNullable<Pantallas["posiciones"]>>("/cartera/positions"),
    pedir<NonNullable<Pantallas["movimientos"]>>("/cartera/transactions"),
    pedir<{ picks: NonNullable<Pantallas["top"]> } | null>("/radar/top?n=20"),
  ]);
  const diaUtc = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);
  const ultima = (b: Array<{ time: number }> | null) => (Array.isArray(b) && b.length ? diaUtc(b[b.length - 1]!.time) : null);
  // El intradiario puede no responder (Yahoo): sin él no hay con qué comparar el gráfico, y no es un error de la app.
  const graficos = await Promise.all(plan.lines.map(async (l) => {
    const [diario, intradiario] = await Promise.all([
      pedir<Array<{ time: number }>>(`/ticker/${l.symbol}/chart?range=3mo&interval=1d`).catch(() => null),
      pedir<Array<{ time: number }>>(`/ticker/${l.symbol}/chart?range=1d&interval=5m`).catch(() => null),
    ]);
    return { symbol: l.symbol, ultimaDiaria: ultima(diario), ultimaIntradiaria: ultima(intradiario) };
  }));
  return { candidatos: candidatos ?? [], plan, veredictos: veredictos ?? [], posiciones: posiciones ?? [], movimientos: movimientos ?? [], top: top?.picks ?? [], graficos, ...(novedades ? { novedades } : {}) };
}

/** Corre los controles sobre el plan vigente y los guarda en él. */
export async function correrControles(c: Container, pedir: Pedir, plan: ContributionPlan & { builtAt: string }, today = todayLocal()): Promise<PlanControles> {
  const at = new Date().toISOString();
  let result: PlanControles;
  try {
    const pantallas = checkPantallas(await juntarPantallas(pedir, plan));
    const filas = await checkRun({ store: c.radarDeps.store }, { today });
    const findings = [...pantallas, ...filas.findings].map(({ check, symbol, severity, detail }) => ({ check, symbol, severity, detail }));
    const { graves, avisos } = summarizeFindings(findings);
    result = { at, planBuiltAt: plan.builtAt, graves, avisos, findings };
  } catch (e) {
    result = { at, planBuiltAt: plan.builtAt, graves: 0, avisos: 0, findings: [], error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
  }
  await c.store.savePlanControles(plan.month, result);
  if (result.error) console.error(`[controles] no pudieron correr: ${result.error}`);
  else if (result.graves) console.error(`[controles] ${result.graves} graves sobre el plan de ${plan.builtAt}: ${result.findings.filter((f) => f.severity === "grave").map((f) => `${f.check} ${f.symbol ?? ""}`).join(", ")}`);
  return result;
}

let corriendo: Promise<PlanControles | null> | null = null;

/**
 * Asegura que el plan vigente tenga sus controles: si ya corrieron sobre esta versión, no hace nada. Lo llaman la
 * API cada minuto (así cubre también lo que rearma la CLI u otra sesión) y cada ruta o paso que rearma el plan.
 */
export async function asegurarControles(c: Container, pedir: Pedir): Promise<PlanControles | null> {
  if (corriendo) return corriendo;
  corriendo = (async () => {
    const plan = await c.store.latestPlan();
    if (!plan?.builtAt) return null;
    if (plan.controles && plan.controles.planBuiltAt === plan.builtAt && !plan.controles.error) return plan.controles;
    return correrControles(c, pedir, { ...plan, builtAt: plan.builtAt });
  })();
  try {
    return await corriendo;
  } finally {
    corriendo = null;
  }
}
