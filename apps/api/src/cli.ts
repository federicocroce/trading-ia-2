import { dailyRun, syncOrders } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";

const cmd = process.argv[2];
const cfg = await loadConfig();
const c = buildContainer(cfg);

if (cmd === "daily") {
  const today = new Date().toISOString().slice(0, 10);
  const since = process.argv[3] ?? new Date(Date.now() - 7 * 86_400_000).toISOString();
  const s = await dailyRun(c.runDeps, { since, today });
  console.log(JSON.stringify({ ...s, proposed: s.proposed.map((t) => ({ id: t.id, ticker: t.ticker, edge: t.edge, instrument: t.instrument })), rejected: s.rejected.length }, null, 2));
} else if (cmd === "sync") {
  console.log({ synced: await syncOrders(c.store, c.broker) });
} else {
  console.error("uso: tsx src/cli.ts daily [sinceISO] | sync");
  process.exit(1);
}
process.exit(0);
