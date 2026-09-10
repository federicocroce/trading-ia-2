import { STEPS, buildContributionPlan, dailyRun, dueSteps, expectedDate, measureRadar, measureVerdicts, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, runCartera, scanUniverse, stepById, withUsageStep, type DueStep, type StepId } from "@thesis/pipeline";
import { state, type Container } from "./container.js";

/** El registro de uso de fuentes externas se guarda este tiempo; lo viejo se borra en cada chequeo de "ponerme al día". */
export const USAGE_RETENTION_DAYS = 90;

/**
 * Ponerse al día: corre solo los pasos programados que quedaron sin correr (máquina apagada o dormida),
 * en orden, y registra cada uno en `job_runs` para no repetirlo. Lo llama el botón, la ruta y un chequeo automático.
 */
export type StepRunner = (c: Container, today: string) => Promise<string>;
export type Runners = Record<StepId, StepRunner>;
export interface CatchUpResult {
  at: string;
  ran: Array<{ id: string; label: string; ok: boolean; detail: string }>;
}
export interface StepStatus {
  id: StepId;
  label: string;
  /** Cuándo corre solo, en palabras. */
  schedule: string;
  /** Última corrida buena: fecha que cubrió, hora en que corrió y resumen. */
  lastDate: string | null;
  ranAt: string | null;
  detail: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  expected: string;
  due: boolean;
  running: boolean;
}
export interface CatchUpStatus {
  now: string;
  due: DueStep[];
  last: Record<StepId, { lastDate: string; ranAt: string | null; detail: string | null } | null>;
  /** Vista por paso para el panel del encabezado. */
  steps: StepStatus[];
  /** Hora de la última corrida buena de cualquier paso. */
  lastRunAt: string | null;
  running: boolean;
  current: string | null;
  lastResult: CatchUpResult | null;
}
const SCHEDULE: Record<StepId, string> = { scan: "domingo 20:00", cartera: "lun–vie 07:45", radar: "lun–vie 07:50", argentina: "lun–vie 07:50", plan: "día 1, 08:00", tesis: "lun–vie 07:30" };

const pad = (n: number) => String(n).padStart(2, "0");
/** Fecha local (la de los crons de la máquina), no UTC: a la noche en Argentina UTC ya es mañana. */
export const localDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const portfolioUsd = async (c: Container) => (await c.store.latestRisk())?.report.totalValue ?? null;

/** Barrido + ranking. Tarda ~1 h: se dispara en segundo plano y el paso se registra cuando termina el ranking. */
async function scanAndRank(c: Container, today: string): Promise<string> {
  if (state.scan.running) return "el barrido ya está corriendo";
  const store = c.store;
  const scanDate = await store.latestScanDate();
  const pending = scanDate ? await store.scanPending(scanDate) : [];
  const needScan = !scanDate || scanDate < today || pending.length > 0;
  const job = (async () => {
    state.scan = { running: true, stopRequested: false, startedAt: new Date().toISOString(), progress: null, last: null };
    try {
      if (needScan) state.scan.last = await scanUniverse(c.radarDeps, { scanDate: scanDate && pending.length > 0 && scanDate >= today ? scanDate : today, today });
      const r = await rankRadar(c.radarDeps, { today, portfolioUsd: await portfolioUsd(c) });
      await store.markJobRun("scan", today, `${r.candidates.length} candidatos, ${r.errors.length} errores`);
      console.log(`[catchup] barrido+ranking listo: ${r.candidates.length} candidatos`);
    } catch (e) {
      console.error("[catchup] barrido/ranking falló", e);
    } finally {
      state.scan.running = false;
    }
  })();
  void job;
  return needScan ? "barrido iniciado en segundo plano (≈1 h); el ranking corre al terminar" : "ranking iniciado en segundo plano";
}

export function defaultRunners(): Runners {
  return {
    scan: scanAndRank,
    cartera: async (c, today) => {
      const s = await runCartera(c.carteraDeps, { today });
      const m = await measureVerdicts(c.carteraDeps, { today });
      return `${s.verdicts.length} veredictos, ${s.errors.length} errores, medidos ${m.measured7}/${m.measured30}`;
    },
    radar: async (c, today) => {
      const r = await refreshRadar(c.radarDeps, { today, portfolioUsd: await portfolioUsd(c) });
      const m = await measureRadar(c.radarDeps, { today });
      const w = await refreshWatchlist(c.radarDeps, { today, portfolioUsd: await portfolioUsd(c) });
      return `${r.refreshed} candidatos refrescados, seguimiento ${w.rows}/${w.symbols}, medidos 7d ${m.candidates["7"]} · 30d ${m.candidates["30"]} · 90d ${m.candidates["90"]}`;
    },
    argentina: async (c, today) => {
      const r = await refreshArgentina(c.argentinaDeps, { today });
      return `${r.acciones} acciones, ${r.cedears} CEDEARs, ${r.errors.length} errores`;
    },
    plan: async (c, today) => {
      const p = await buildContributionPlan(c.radarDeps, { month: today.slice(0, 7), portfolioUsd: await portfolioUsd(c) });
      return `plan ${p.month}: ${p.lines.length} líneas`;
    },
    tesis: async (c, today) => {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
      const summary = await dailyRun(c.runDeps, { since, today });
      state.lastRun = { at: new Date().toISOString(), summary: { ...summary, proposed: summary.proposed.length, rejected: summary.rejected.length } };
      return `${summary.proposed.length} propuestas, ${summary.rejected.length} rechazadas, ${summary.errors.length} errores`;
    },
  };
}

/** Última fecha por paso: lo registrado en job_runs, o lo que ya hay en la base de antes de que existiera el registro. */
async function lastDates(c: Container): Promise<CatchUpStatus["last"]> {
  const store = c.store;
  const jobs = await store.jobRuns();
  const out = {} as CatchUpStatus["last"];
  const fromData: Record<StepId, () => Promise<string | null>> = {
    scan: async () => {
      const scanDate = await store.latestScanDate();
      if (!scanDate) return null;
      const cands = await store.latestCandidates();
      const ranked = cands.some((r) => (r.kind === "stock" || r.kind === "etf") && r.candidateDate >= scanDate);
      return ranked ? scanDate : null;
    },
    cartera: async () => (await store.latestVerdicts()).map((v) => v.verdictDate).sort().at(-1) ?? null,
    radar: async () => (await store.latestCandidates()).filter((r) => r.kind === "stock" || r.kind === "etf").map((r) => r.candidateDate).sort().at(-1) ?? null,
    argentina: async () => (await store.latestMacroAr())?.date ?? null,
    plan: async () => (await store.latestPlan())?.month ?? null,
    tesis: async () => state.lastRun?.at.slice(0, 10) ?? null,
  };
  for (const s of STEPS) {
    const j = jobs[s.id];
    if (j && j.lastDate) out[s.id] = { lastDate: j.lastDate, ranAt: j.ranAt, detail: j.detail };
    else {
      const d = await fromData[s.id]().catch(() => null);
      out[s.id] = d ? { lastDate: d, ranAt: null, detail: "según lo que hay en la base" } : null;
    }
  }
  return out;
}

export async function catchUpStatus(c: Container, now = new Date()): Promise<CatchUpStatus> {
  const last = await lastDates(c);
  const due = dueSteps(Object.fromEntries(STEPS.map((s) => [s.id, last[s.id]?.lastDate ?? null])) as Partial<Record<StepId, string | null>>, now);
  const jobs = await c.store.jobRuns();
  const steps: StepStatus[] = STEPS.map((s) => {
    const l = last[s.id];
    const j = jobs[s.id];
    const d = due.find((x) => x.id === s.id);
    return { id: s.id, label: s.label, schedule: SCHEDULE[s.id], lastDate: l?.lastDate ?? null, ranAt: l?.ranAt ?? null, detail: l?.detail ?? null, lastError: j?.lastError ?? null, lastErrorAt: j?.lastErrorAt ?? null, expected: d?.expected ?? expectedDate(s, now), due: !!d, running: state.catchup.current === s.id };
  });
  const lastRunAt = steps.map((x) => x.ranAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  return { now: now.toISOString(), due, last, steps, lastRunAt, running: state.catchup.running, current: state.catchup.current, lastResult: state.catchup.last };
}

/** Corre pasos concretos (uno o varios) en orden, registrando éxito o error. Devuelve lo que corrió. */
async function runSteps(c: Container, ids: StepId[], runners: Runners, now: Date): Promise<CatchUpResult> {
  const today = localDate(now);
  const result: CatchUpResult = { at: now.toISOString(), ran: [] };
  for (const id of STEPS.map((s) => s.id).filter((x) => ids.includes(x))) {
    const label = stepById(id).label;
    state.catchup.current = id;
    try {
      // Cada pedido saliente del paso queda atribuido a él en el registro de uso.
      const detail = await withUsageStep({ step: id }, () => runners[id](c, today));
      // El barrido se registra solo cuando termina (corre en segundo plano).
      if (id !== "scan") await c.store.markJobRun(id, today, detail);
      result.ran.push({ id, label, ok: true, detail });
      console.log(`[catchup] ${label}: ${detail}`);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      await c.store.markJobError(id, detail).catch(() => {});
      result.ran.push({ id, label, ok: false, detail });
      console.error(`[catchup] ${label} falló: ${detail}`);
    } finally {
      state.catchup.current = null;
    }
  }
  return result;
}

/** Un paso a mano (botón "Correr" del panel), esté pendiente o no. */
export async function runStep(c: Container, id: StepId, opts: { now?: Date; runners?: Runners } = {}): Promise<CatchUpResult> {
  if (state.catchup.running) return state.catchup.last ?? { at: new Date().toISOString(), ran: [] };
  state.catchup.running = true;
  try {
    const r = await runSteps(c, [id], opts.runners ?? c.catchupRunners ?? defaultRunners(), opts.now ?? new Date());
    state.catchup.last = r;
    return r;
  } finally {
    state.catchup.running = false;
  }
}

export async function runCatchUp(c: Container, opts: { now?: Date; runners?: Runners } = {}): Promise<CatchUpResult> {
  if (state.catchup.running) return state.catchup.last ?? { at: new Date().toISOString(), ran: [] };
  const now = opts.now ?? new Date();
  const runners = opts.runners ?? c.catchupRunners ?? defaultRunners();
  state.catchup.running = true;
  try {
    // Retención del registro de uso: 90 días. Barato (índice por fecha) y corre con cada chequeo.
    await c.store.deleteCallsBefore(new Date(now.getTime() - USAGE_RETENTION_DAYS * 86_400_000).toISOString()).catch(() => {});
    const { due } = await catchUpStatus(c, now);
    const result = await runSteps(c, due.map((d) => d.id), runners, now);
    state.catchup.last = result;
    return result;
  } finally {
    state.catchup.running = false;
  }
}
