import { buildContributionPlan, measureRadar, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, scanUniverse, withUsageStep } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";

/** Uso: tsx src/radar-cli.ts scan | rank | refresh | plan | measure | argentina */
const cmd = process.argv[2];
const cfg = await loadConfig();
const c = buildContainer(cfg);
const today = new Date().toISOString().slice(0, 10);
const portfolioUsd = (await c.store.latestRisk())?.report.totalValue ?? null;
let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\n[radar] deteniendo al terminar el símbolo actual…"); });
const deps = { ...c.radarDeps, shouldStop: () => stop, onProgress: (p: { done: number; total: number; stage: string }) => console.log(`[radar] ${p.stage}: ${p.done}/${p.total}`) };

// El registro de uso atribuye cada pedido al mismo paso que en "ponerme al día" (scan/rank → scan; refresh/measure → radar).
const STEP: Record<string, string> = { scan: "scan", rank: "scan", refresh: "radar", measure: "radar", watchlist: "radar", plan: "plan", argentina: "argentina" };
let code = 0;
await withUsageStep({ step: STEP[cmd ?? ""] ?? "cli" }, async () => {
  if (cmd === "scan") console.log(await scanUniverse(deps, { scanDate: today, today }));
  else if (cmd === "rank") { const r = await rankRadar(deps, { today, portfolioUsd }); console.log(JSON.stringify({ candidates: r.candidates.map((x) => ({ symbol: x.symbol, kind: x.kind, verdict: x.verdict, score: x.score, flags: x.flags })), skipped: r.skipped.length, errors: r.errors }, null, 2)); }
  // Como el paso "radar" de ponerme al día: refresco, medición y lista de seguimiento.
  else if (cmd === "refresh") { console.log(await refreshRadar(deps, { today, portfolioUsd })); console.log(await measureRadar(deps, { today })); console.log(await refreshWatchlist(deps, { today, portfolioUsd })); }
  else if (cmd === "watchlist") console.log(await refreshWatchlist(deps, { today, portfolioUsd }));
  else if (cmd === "plan") console.log(JSON.stringify(await buildContributionPlan(deps, { month: today.slice(0, 7), portfolioUsd }), null, 2));
  else if (cmd === "measure") console.log(await measureRadar(deps, { today }));
  else if (cmd === "argentina") { const r = await refreshArgentina(c.argentinaDeps, { today }); console.log(JSON.stringify({ macro: r.macro, acciones: r.acciones, cedears: r.cedears, errors: r.errors }, null, 2)); }
  else { console.error("uso: tsx src/radar-cli.ts scan | rank | refresh | watchlist | plan | measure | argentina"); code = 1; }
});
// Lo encolado por el registro de uso se escribe antes de salir: process.exit no espera al volcado.
await c.usage?.flush();
process.exit(code);
