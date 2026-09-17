import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { todayLocal } from "@thesis/core";
import { buildContributionPlan, checkRun, explorarMercado, importarHechos, measureRadar, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, replan, scanUniverse, verifyFor, withUsageStep, type VerifyBudget } from "@thesis/pipeline";
import { loadConfig, findRoot } from "./config.js";
import { buildContainer } from "./container.js";

/** Uso: tsx src/radar-cli.ts scan | rank | refresh | plan | measure | argentina | consistencia | mercado */
const cmd = process.argv[2];
const cfg = await loadConfig();
const c = buildContainer(cfg);
const today = todayLocal();
const portfolioUsd = (await c.store.latestRisk())?.report.totalValue ?? null;
let stop = false;
process.on("SIGINT", () => { stop = true; console.log("\n[radar] deteniendo al terminar el símbolo actual…"); });
const deps = { ...c.radarDeps, shouldStop: () => stop, onProgress: (p: { done: number; total: number; stage: string }) => console.log(`[radar] ${p.stage}: ${p.done}/${p.total}`) };

// El registro de uso atribuye cada pedido al mismo paso que en "ponerme al día" (scan/rank → scan; refresh/measure → radar).
const STEP: Record<string, string> = { scan: "scan", rank: "scan", refresh: "radar", measure: "radar", watchlist: "radar", plan: "plan", argentina: "argentina", consistencia: "radar", "verificar-cartera": "cartera", mercado: "radar", hechos: "radar" };
let code = 0;
await withUsageStep({ step: STEP[cmd ?? ""] ?? "cli" }, async () => {
  if (cmd === "scan") console.log(await scanUniverse(deps, { scanDate: today, today }));
  else if (cmd === "rank") { const r = await rankRadar(deps, { today, portfolioUsd }); await replan(deps, { today, portfolioUsd }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; }); console.log(JSON.stringify({ candidates: r.candidates.map((x) => ({ symbol: x.symbol, kind: x.kind, verdict: x.verdict, score: x.score, flags: x.flags })), skipped: r.skipped.length, errors: r.errors }, null, 2)); }
  // Como el paso "radar" de ponerme al día: refresco, medición y lista de seguimiento.
  else if (cmd === "refresh") { console.log(await refreshRadar(deps, { today, portfolioUsd })); console.log(await measureRadar(deps, { today })); console.log(await refreshWatchlist(deps, { today, portfolioUsd })); await replan(deps, { today, portfolioUsd }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; }); const chk = await checkRun(deps, { today }); if (chk.graves > 0) code = 1; }
  else if (cmd === "watchlist") { console.log(await refreshWatchlist(deps, { today, portfolioUsd })); await replan(deps, { today, portfolioUsd }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; }); }
  // plan [monto]: sin monto usa el aporte mensual de la política; con monto arma el plan para esa plata.
  else if (cmd === "plan") { const amountUsd = Number(process.argv[3]); console.log(JSON.stringify(await buildContributionPlan(deps, { month: today.slice(0, 7), portfolioUsd, ...(Number.isFinite(amountUsd) && amountUsd > 0 ? { amountUsd } : {}) }), null, 2)); }
  else if (cmd === "measure") console.log(await measureRadar(deps, { today }));
  // Revisa lo guardado contra sus propias fuentes. Sale con 1 si hay algo grave, para que un cron se entere.
  else if (cmd === "consistencia") { const chk = await checkRun(deps, { today }); if (chk.graves > 0) code = 1; }
  // Verifica en la web lo que YA TENÉS, no lo que se quiere comprar. Sin esto el veredicto de mantener
  // mira solo el precio: la evidencia del negocio existía para las candidatas y no para tus posiciones,
  // que es al revés de lo que conviene, porque ahí está la plata puesta.
  else if (cmd === "verificar-cartera") {
    const posiciones = await c.store.positions();
    const budget: VerifyBudget = { left: Number(process.argv[3]) > 0 ? Number(process.argv[3]) : 6 };
    let quedan = posiciones.length;
    for (const p of posiciones) {
      if (budget.left <= 0) { console.log(`[cartera] sin presupuesto de búsqueda: ${quedan} posiciones sin verificar, probá de nuevo cuando reponga la cuota`); break; }
      const perfil = await c.store.profile(p.symbol).catch(() => null);
      const v = await verifyFor(deps, p.symbol, { today, name: perfil?.profile.name ?? null, context: `posición en cartera, capa ${p.layer}`, budget });
      console.log(`${p.symbol}: ${v ? `${v.verdict} — ${v.reason.slice(0, 130)}` : "sin verificación"}`);
      quedan--;
    }
  }
  // mercado [...] [SÍMBOLOS...]: el embudo del comando /mercado con las reglas de la app. NO escribe nada: ni el Radar,
  // ni el plan, ni caché (con --guardar deja la caché de velas y estados). Con símbolos, evalúa solo esos.
  else if (cmd === "mercado") {
    const args = process.argv.slice(3);
    const num = (bandera: string) => { const i = args.indexOf(bandera); const v = i >= 0 ? Number(args[i + 1]) : NaN; return Number.isFinite(v) && v > 0 ? v : undefined; };
    const symbols = args.filter((a, i) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(a) && !(args[i - 1] ?? "").startsWith("--"));
    const preselect = num("--preselect");
    const top = num("--top");
    const m = await explorarMercado(deps, { today, portfolioUsd, ...(preselect ? { preselect } : {}), ...(top ? { top } : {}), ...(symbols.length ? { symbols } : {}), ...(args.includes("--sin-estados") ? { conEstados: false } : {}), ...(args.includes("--guardar") ? { guardar: true } : {}) });
    // El log del ranking va por la salida estándar, así que el JSON entero se guarda aparte: `--salida <archivo>`.
    const i = args.indexOf("--salida");
    const salida = i >= 0 ? args[i + 1] : undefined;
    if (salida) await writeFile(salida, JSON.stringify(m, null, 2), "utf8");
    else console.log(JSON.stringify(m, null, 2));
    console.error(`[mercado] universo ${m.universo.conFundamentales} de ${m.universo.barrido} del barrido · rankeadas ${m.rankeadas} · preseleccionadas ${m.preseleccionadas} · con velas ${m.conVelas} · pasan ${m.filas.length} · descartadas ${m.descartadas.length}${m.avisos.length ? ` · avisos ${m.avisos.length}` : ""}`);
  }
  else if (cmd === "argentina") { const r = await refreshArgentina(c.argentinaDeps, { today }); console.log(JSON.stringify({ macro: r.macro, acciones: r.acciones, cedears: r.cedears, errors: r.errors }, null, 2)); }
  // hechos --importar archivo.json [--origen agente|manual]: el único camino de escritura a hechos_externos (17/9).
  else if (cmd === "hechos") {
    const args = process.argv.slice(3);
    const i = args.indexOf("--importar");
    const archivo = i >= 0 ? args[i + 1] : undefined;
    if (!archivo) { console.error("uso: tsx src/radar-cli.ts hechos --importar archivo.json [--origen agente|manual]"); code = 1; }
    else {
      const origen = args[args.indexOf("--origen") + 1] === "manual" ? "manual" : "agente";
      // pnpm exec corre desde apps/api: una ruta relativa se toma desde la raíz del repo (pnpm-workspace.yaml).
      const archivoResuelto = path.isAbsolute(archivo) ? archivo : path.resolve(await findRoot(), archivo);
      const r = await importarHechos(c.store, JSON.parse(await readFile(archivoResuelto, "utf8")), { hostsPrimarios: cfg.radar.hechosFuentes, origen, detectadoAt: new Date().toISOString() });
      console.log(JSON.stringify(r, null, 2));
      if (r.guardados === 0) code = 1;
    }
  }
  else { console.error("uso: tsx src/radar-cli.ts scan | rank | refresh | watchlist | plan | measure | argentina | consistencia | verificar-cartera [n] | mercado [--preselect N] [--top N] [--sin-estados] [--guardar] [--salida archivo] [SÍMBOLOS...] | hechos --importar archivo.json [--origen agente|manual]"); code = 1; }
});
// Lo encolado por el registro de uso se escribe antes de salir: process.exit no espera al volcado.
await c.usage?.flush();
process.exit(code);
