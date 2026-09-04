import { serve } from "@hono/node-server";
import cron from "node-cron";
import { dailyRun, syncOrders } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer, state } from "./container.js";
import { buildApp } from "./routes/index.js";

const cfg = await loadConfig();
const c = buildContainer(cfg);
const app = buildApp(c);

// Corrida diaria (lun-vie) + sync de órdenes cada 15 min en horario de mercado.
cron.schedule(cfg.dailyCron, async () => {
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  try {
    const summary = await dailyRun(c.runDeps, { since, today });
    state.lastRun = { at: new Date().toISOString(), summary: { ...summary, proposed: summary.proposed.length, rejected: summary.rejected.length } };
    console.log(`[cron] daily run: ${summary.proposed.length} proposed, ${summary.rejected.length} rejected, ${summary.errors.length} errors`);
  } catch (e) {
    console.error("[cron] daily run failed", e);
  }
});
cron.schedule("*/15 9-17 * * 1-5", () => syncOrders(c.store, c.broker).catch((e) => console.error("[cron] sync failed", e)));

serve({ fetch: app.fetch, port: cfg.port }, () => {
  console.log(`thesis-engine api on :${cfg.port} (paper only) — daily cron "${cfg.dailyCron}"`);
});
