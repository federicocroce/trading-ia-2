import { buildContributionPlan, measureRadar, rankRadar, refreshArgentina, refreshRadar, scanUniverse } from "@thesis/pipeline";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";

/** Uso: tsx src/radar-cli.ts scan | rank | refresh | plan | measure */
const cmd = process.argv[2];
const cfg = await loadConfig();
const c = buildContainer(cfg);
const today = new Date().toISOString().slice(0, 10);
const portfolioUsd = (await c.store.latestRisk())?.report.totalValue ?? null;
let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\n[radar] deteniendo al terminar el símbolo actual…"); });
const deps = { ...c.radarDeps, shouldStop: () => stop, onProgress: (p: { done: number; total: number; stage: string }) => console.log(`[radar] ${p.stage}: ${p.done}/${p.total}`) };

if (cmd === "scan") console.log(await scanUniverse(deps, { scanDate: today, today }));
else if (cmd === "rank") { const r = await rankRadar(deps, { today, portfolioUsd }); console.log(JSON.stringify({ candidates: r.candidates.map((x) => ({ symbol: x.symbol, kind: x.kind, verdict: x.verdict, score: x.score, flags: x.flags })), skipped: r.skipped.length, errors: r.errors }, null, 2)); }
else if (cmd === "refresh") { console.log(await refreshRadar(deps, { today, portfolioUsd })); console.log(await measureRadar(deps, { today })); }
else if (cmd === "plan") console.log(JSON.stringify(await buildContributionPlan(deps, { month: today.slice(0, 7), portfolioUsd }), null, 2));
else if (cmd === "measure") console.log(await measureRadar(deps, { today }));
else if (cmd === "argentina") { const r = await refreshArgentina(c.argentinaDeps, { today }); console.log(JSON.stringify({ macro: r.macro, acciones: r.acciones, cedears: r.cedears, errors: r.errors }, null, 2)); }
else { console.error("uso: tsx src/radar-cli.ts scan | rank | refresh | plan | measure | argentina"); process.exit(1); }
process.exit(0);
