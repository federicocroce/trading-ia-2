import { todayLocal } from "@thesis/core";
import { serve } from "@hono/node-server";
import cron from "node-cron";
import { buildContributionPlan, dailyRun, tesisSince, measureRadar, measureVerdicts, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, runCartera, scanUniverse, syncOrders, withUsageStep } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer, state } from "./container.js";
import { buildApp } from "./routes/index.js";
import { runCatchUp } from "./catchup.js";
import { PriceHub } from "./prices-hub.js";

const cfg = await loadConfig();
const c = buildContainer(cfg);
// Precios en vivo para toda la app: un lote cada 15 s con el mercado abierto, 60 s fuera; se empujan por SSE.
c.priceHub = new PriceHub(c, { log: (m) => console.warn(m) });
c.priceHub.start();
const app = buildApp(c);

// Corrida diaria (lun-vie) + sync de órdenes cada 15 min en horario de mercado.
cron.schedule(cfg.dailyCron, () => withUsageStep({ step: "tesis" }, async () => {
  const today = todayLocal();
  const since = tesisSince();
  try {
    const summary = await dailyRun(c.runDeps, { since, today });
    state.lastRun = { at: new Date().toISOString(), summary: { ...summary, proposed: summary.proposed.length, rejected: summary.rejected.length } };
    console.log(`[cron] daily run: ${summary.proposed.length} proposed, ${summary.rejected.length} rejected, ${summary.errors.length} errors`);
  } catch (e) {
    console.error("[cron] daily run failed", e);
  }
}));
cron.schedule("*/15 9-17 * * 1-5", () => withUsageStep({ step: "ordenes" }, () => syncOrders(c.store, c.broker).catch((e) => console.error("[cron] sync failed", e))));

// Veredicto diario de la cartera real + medición de los veredictos viejos contra SPY.
cron.schedule(cfg.carteraCron, () => withUsageStep({ step: "cartera" }, async () => {
  const today = todayLocal();
  try {
    const s = await runCartera(c.carteraDeps, { today });
    const m = await measureVerdicts(c.carteraDeps, { today });
    console.log(`[cron] cartera: ${s.verdicts.length} veredictos, ${s.errors.length} errores, medidos ${m.measured7}/${m.measured30}`);
  } catch (e) {
    console.error("[cron] cartera failed", e);
  }
}));

// Radar: barrido + ranking semanal, refresco + medición diarios, plan mensual.
const isoToday = () => todayLocal();
cron.schedule(cfg.radarScanCron, () => withUsageStep({ step: "scan" }, async () => {
  if (state.scan.running) return;
  state.scan = { running: true, stopRequested: false, startedAt: new Date().toISOString(), progress: null, last: null };
  try {
    const today = isoToday();
    state.scan.last = await scanUniverse(c.radarDeps, { scanDate: today, today });
    const r = await rankRadar(c.radarDeps, { today, portfolioUsd: (await c.store.latestRisk())?.report.totalValue ?? null });
    console.log(`[cron] radar: barrido ${JSON.stringify(state.scan.last)}; ${r.candidates.length} candidatos, ${r.errors.length} errores`);
  } catch (e) {
    console.error("[cron] radar scan failed", e);
  } finally {
    state.scan.running = false;
  }
}));
cron.schedule(cfg.radarRefreshCron, () => withUsageStep({ step: "radar" }, async () => {
  const today = isoToday();
  try {
    const r = await refreshRadar(c.radarDeps, { today, portfolioUsd: (await c.store.latestRisk())?.report.totalValue ?? null });
    const m = await measureRadar(c.radarDeps, { today });
    const w = await refreshWatchlist(c.radarDeps, { today, portfolioUsd: (await c.store.latestRisk())?.report.totalValue ?? null }).catch((e) => { console.error("[cron] watchlist failed", e); return null; });
    if (w) console.log(`[cron] seguimiento: ${w.rows} de ${w.symbols}, ${w.errors.length} errores`);
    const ar = await refreshArgentina(c.argentinaDeps, { today }).catch((e) => { console.error("[cron] argentina failed", e); return null; });
    if (ar) console.log(`[cron] argentina: ${ar.acciones} acciones, ${ar.cedears} cedears, ${ar.errors.length} errores`);
    console.log(`[cron] radar refresh: ${r.refreshed} candidatos, medidos ${JSON.stringify(m)}`);
  } catch (e) {
    console.error("[cron] radar refresh failed", e);
  }
}));
cron.schedule(cfg.radarPlanCron, () => withUsageStep({ step: "plan" }, async () => {
  try {
    const p = await buildContributionPlan(c.radarDeps, { month: isoToday().slice(0, 7), portfolioUsd: null });
    console.log(`[cron] plan del aporte ${p.month}: ${p.lines.length} líneas`);
  } catch (e) {
    console.error("[cron] radar plan failed", e);
  }
}));

// Ponerse al día solo: si la máquina estaba apagada o dormida a la hora de un cron, se corre lo que faltó
// un minuto después de arrancar y se vuelve a chequear cada 30 minutos. Lo ya hecho no se repite (job_runs).
if (cfg.catchupAuto) {
  const tick = () => runCatchUp(c).then((r) => { if (r.ran.length) console.log(`[catchup] ${r.ran.map((x) => `${x.label}: ${x.ok ? "ok" : "falló"}`).join(" · ")}`); }).catch((e) => console.error("[catchup] failed", e));
  setTimeout(tick, 60_000);
  setInterval(tick, 30 * 60_000);
}

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`thesis-engine api on :${cfg.port} (paper only) — daily cron "${cfg.dailyCron}"`);
});
