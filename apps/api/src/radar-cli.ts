import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { medirFrenos, revisarCorrida, todayLocal } from "@thesis/core";
import { buildContributionPlan, checkRun, explorarMercado, importarDelAgente, importarHechos, pendientesDelAgente, measureRadar, medirPares, porQueNoEsta, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, replan, scanUniverse, verifyFor, withUsageStep, type VerifyBudget } from "@thesis/pipeline";
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
const STEP: Record<string, string> = { scan: "scan", rank: "scan", refresh: "radar", measure: "radar", watchlist: "radar", plan: "plan", argentina: "argentina", consistencia: "radar", "verificar-cartera": "cartera", mercado: "radar", hechos: "radar", porque: "radar", pares: "radar", frenos: "radar", guardia: "radar", reverificar: "radar", verificar: "agente" };
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
  else if (cmd === "frenos") {
    // Solo lectura (18/9): qué pasó con lo que cada freno dejó afuera, contra lo que ningún freno tocó.
    const h = Number(process.argv[3] ?? 7);
    const horizonte = h === 30 ? 30 : h === 90 ? 90 : 7;
    const m = medirFrenos(await c.store.allCandidates(), horizonte);
    console.log(`[frenos] alfa contra el S&P a ${m.horizonte} días · filas medidas del ${m.desde ?? "—"} al ${m.hasta ?? "—"} · ${m.sinMedir} filas todavía sin medir`);
    for (const g of m.grupos) {
      const alfa = g.alfa === null ? "sin datos" : `${g.alfa > 0 ? "+" : ""}${g.alfa}% · le gana al S&P ${g.acierto}%`;
      const contra = g.contraSinFreno === null ? "" : ` · ${g.contraSinFreno > 0 ? "+" : ""}${g.contraSinFreno} puntos contra lo que ningún freno tocó`;
      console.log(`[frenos] ${g.titulo}: ${g.n} filas de ${g.simbolos} símbolos · ${alfa}${contra}${g.n > 0 && g.pocasFilas ? " · POCOS SÍMBOLOS: es ruido" : ""}${g.lista.length ? ` · ${g.lista.slice(0, 12).join(" ")}${g.lista.length > 12 ? " …" : ""}` : ""}`);
    }
  }
  else if (cmd === "verificar") {
    // La puerta del agente de verificación (22/9). Solo lectura con --pendientes; --importar valida, decide por regla y
    // guarda (con --ensayo, decide y muestra sin guardar), y después le pide a la API que refresque esas filas y el plan.
    const args = process.argv.slice(3);
    const val = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
    if (args.includes("--pendientes")) {
      const simbolos = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--salida");
      const p = await pendientesDelAgente(deps, { today, topeVerificaciones: cfg.radar.agente.topeVerificaciones, topeRevisiones: cfg.radar.agente.topeRevisiones, ...(simbolos.length ? { simbolos } : {}) });
      const salida = val("--salida");
      const json = JSON.stringify(p, null, 2);
      if (salida) { await writeFile(path.isAbsolute(salida) ? salida : path.resolve(await findRoot(), salida), json); console.log(`[verificar] ${p.verificar.length} a verificar y ${p.revisar.length} a revisar → ${salida}`); }
      else console.log(json);
    } else if (val("--importar") && !deps.verifier?.porAgente) {
      // Con VERIFICADOR=gemini se guardaría lo del agente bajo la versión de Gemini.
      console.error("[verificar] el importador del agente necesita VERIFICADOR=agente"); code = 1;
    } else if (val("--importar")) {
      const archivo = val("--importar")!;
      const ruta = path.isAbsolute(archivo) ? archivo : path.resolve(await findRoot(), archivo);
      const ensayo = args.includes("--ensayo");
      const r = await importarDelAgente(c.store, JSON.parse(await readFile(ruta, "utf8")), { hostsPrimarios: cfg.radar.hechosFuentes, today, version: deps.verifier?.promptVersion ?? "", versionRevision: deps.reviewer?.promptVersion ?? "", ensayo });
      console.log(JSON.stringify(r, null, 2));
      console.log(`[verificar] ${ensayo ? "ENSAYO, no se guardó nada: " : ""}${r.verificados.length} verificaciones, ${r.revisados.length} revisiones, ${r.rechazados.length} rechazadas`);
      const simbolos = [...new Set([...r.verificados, ...r.revisados].map((x) => x.symbol))];
      if (!ensayo && simbolos.length) {
        const res = await fetch(`http://localhost:${cfg.port}/radar/tras-verificar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ symbols: simbolos }) }).catch((e: unknown) => e as Error);
        console.log(res instanceof Error || !res.ok ? `[verificar] la API no respondió (${res instanceof Error ? res.message : res.status}): el próximo refresco lo toma igual` : "[verificar] la API refrescó esas filas y rearmó el plan");
      }
      if (!r.verificados.length && !r.revisados.length) code = 1;
    } else { console.error("uso: tsx src/radar-cli.ts verificar --pendientes [--salida archivo] [SÍMBOLOS…] | verificar --importar archivo [--ensayo]"); code = 1; }
  }
  else if (cmd === "reverificar") {
    // A pedido (18/9): una fila en OBSERVAR por un "evitar" no se vuelve a verificar sola. Sin --buscar re-estructura el
    // informe guardado si se puede (no gasta búsqueda); con --buscar hace una búsqueda nueva (gasta una de la cuota).
    const sym = process.argv[3]?.toUpperCase();
    if (deps.verifier?.porAgente) { console.error("[reverificar] con VERIFICADOR=agente la verificación la hace el agente: corré /verificar SÍMBOLO (o 'verificar --pendientes SÍMBOLO')"); code = 1; }
    else if (!sym || sym.startsWith("--") || !deps.verifier) { console.error("uso: tsx src/radar-cli.ts reverificar SÍMBOLO [--buscar]  (necesita el verificador configurado)"); code = 1; }
    else {
      const antes = await c.store.verification(sym);
      const perfil = await c.store.profile(sym).catch(() => null);
      const v = await verifyFor(deps, sym, { today, name: perfil?.profile.name ?? null, ...(process.argv.includes("--buscar") ? { forzar: true } : {}) });
      console.log(`[reverificar] ${sym}: ${antes ? `${antes.verdict} del ${antes.date}` : "sin verificación"} → ${v ? `${v.verdict} del ${v.date}: ${v.reason}` : "sigue sin verificación (la búsqueda falló)"}`);
      console.log("[reverificar] la fila del Radar y el plan lo toman en la próxima corrida (o con \"Rearmar plan\").");
    }
  }
  // Revisa lo guardado contra sus propias fuentes. Sale con 1 si hay algo grave, para que un cron se entere.
  else if (cmd === "consistencia") { const chk = await checkRun(deps, { today }); if (chk.graves > 0) code = 1; }
  // Verifica en la web lo que YA TENÉS, no lo que se quiere comprar. Sin esto el veredicto de mantener
  // mira solo el precio: la evidencia del negocio existía para las candidatas y no para tus posiciones,
  // que es al revés de lo que conviene, porque ahí está la plata puesta.
  else if (cmd === "verificar-cartera") {
    if (deps.verifier?.porAgente) { console.error("[cartera] con VERIFICADOR=agente la verificación la hace el agente: corré /verificar con los símbolos de tu cartera"); code = 1; }
    else {
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
  // guardia: ¿la corrida de esta mañana salió bien? Sale 1 si hay algo que avisar, para que launchd lo grite.
  // Solo se esperan pasos de lunes a viernes: el sábado y el domingo no corre ninguno (ver cronPlan).
  else if (cmd === "guardia") {
    const dia = new Date(`${today}T12:00:00Z`).getUTCDay();
    const esperados = dia >= 1 && dia <= 5 ? ["tesis", "cartera", "radar", "argentina"] : [];
    const avisos = revisarCorrida({ today, plan: await c.store.latestPlan().catch(() => null), jobRuns: await c.store.jobRuns(), esperados });
    if (!avisos.length) console.log(`[guardia] ${today}: la corrida de hoy está en orden`);
    else {
      for (const a of avisos) console.log(`[guardia] ${a.motivo}: ${a.detalle}`);
      code = 1;
    }
  }
  // pares (24/9, P15): ¿los pares con los que se compara cada acción del Radar se mueven como ella? Solo lectura.
  else if (cmd === "pares") {
    const m = await medirPares(deps);
    const no = m.filter((x) => x.noSeParecen);
    console.log(`[pares] ${m.length} acciones del Radar · ${no.length} se parecen menos a sus pares que al mercado (mediana de correlación con los pares < correlación con SPY)`);
    const r2 = (n: number | null) => (n === null ? "—" : n.toFixed(2));
    for (const x of m) console.log(`[pares] ${x.noSeParecen ? "✗" : " "} ${x.symbol.padEnd(6)} ${x.rankInGroup ?? "?"} de ${x.groupSize ?? "?"} · pares ${r2(x.mediana)} · mercado ${r2(x.conMercado)} · ${x.porPar.slice(0, 5).map((p) => `${p.symbol} ${r2(p.corr)}`).join(", ")}`);
  }
  // porque SÍMBOLO (24/9): ¿por qué no está en el Radar? Solo lectura.
  else if (cmd === "porque") {
    const sym = process.argv[3];
    if (!sym) { console.error("uso: tsx src/radar-cli.ts porque SÍMBOLO"); code = 1; }
    else for (const l of await porQueNoEsta(deps, sym, today)) console.log(`[porque] ${l}`);
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
  else { console.error("uso: tsx src/radar-cli.ts scan | rank | refresh | watchlist | plan | measure | argentina | consistencia | guardia | frenos [7|30|90] | reverificar SÍMBOLO [--buscar] | verificar-cartera [n] | mercado [--preselect N] [--top N] [--sin-estados] [--guardar] [--salida archivo] [SÍMBOLOS...] | hechos --importar archivo.json [--origen agente|manual] | porque SÍMBOLO | pares"); code = 1; }
});
// Lo encolado por el registro de uso se escribe antes de salir: process.exit no espera al volcado.
await c.usage?.flush();
process.exit(code);
