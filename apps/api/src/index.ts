import { serve } from "@hono/node-server";
import cron from "node-cron";
import { syncOrders, withUsageStep } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";
import { buildApp } from "./routes/index.js";
import { runCatchUp } from "./catchup.js";
import { scheduleJobs } from "./jobs.js";
import { asegurarControles, pedirEnProceso } from "./controles.js";
import { asegurarRevisiones } from "./revisiones.js";
import { asegurarVerificaciones } from "./verificaciones.js";
import { PriceHub } from "./prices-hub.js";

const cfg = await loadConfig();
const c = buildContainer(cfg);
// Precios en vivo para toda la app: un lote cada 15 s con el mercado abierto, 60 s fuera; se empujan por SSE.
c.priceHub = new PriceHub(c, { log: (m) => console.warn(m) });
c.priceHub.start();
const app = buildApp(c);
// Controles automáticos sobre cada versión del plan (15/9): con las mismas rutas que el navegador, sin red. Cada
// minuto se asegura que el plan vigente los tenga, así cubre también lo que rearma la CLI u otra sesión.
const pedir = pedirEnProceso(app);
c.controlar = () => asegurarControles(c, pedir);
// Cada minuto, en orden: reintentar la verificación web de lo que el plan compraría (Google suele saturarse un rato),
// la revisión antes de comprar de lo que quedó pendiente, y los controles sobre la versión vigente del plan.
const vigilar = async () => {
  await asegurarVerificaciones(c).catch((e: unknown) => console.error("[verificación] falló", e));
  await asegurarRevisiones(c).catch((e: unknown) => console.error("[revisión] falló", e));
  await c.controlar?.().catch((e: unknown) => console.error("[controles] fallaron", e));
};
setTimeout(() => void vigilar(), 20_000);
setInterval(() => void vigilar(), 60_000);

// Sync de órdenes cada 15 min en horario de mercado.
cron.schedule("*/15 9-17 * * 1-5", () => withUsageStep({ step: "ordenes" }, () => syncOrders(c.store, c.broker).catch((e) => console.error("[cron] sync failed", e))));

// Corridas programadas: los mismos pasos del catch-up (cada uno rearma el plan y queda registrado), ver `jobs.ts`.
scheduleJobs(c, cfg, (expr, fn) => cron.schedule(expr, () => { void fn(); }));

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
