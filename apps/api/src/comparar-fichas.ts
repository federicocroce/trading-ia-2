import { appendFile } from "node:fs/promises";
import { rankStocks, todayLocal } from "@thesis/core";
import { cardInputFor, rankableFundamentals } from "@thesis/pipeline";
import { LocalCardWriter } from "@thesis/reasoner";
import { loadConfig } from "./config.js";
import { buildContainer } from "./container.js";

/**
 * Compara fichas (9/10). Toma filas de acción que YA tienen ficha de Gemini, le arma al modelo local la MISMA
 * entrada que arma el Radar (`cardInputFor`) y muestra las dos fichas una al lado de la otra. Solo lectura sobre la
 * base: no guarda la ficha local en ninguna fila.
 *
 * Uso: tsx src/comparar-fichas.ts [cantidad] [--url http://127.0.0.1:8091] [--modelo nombre] [--salida archivo.jsonl]
 *
 * Por qué existe: cambiar el modelo que escribe la ficha sin medirlo es cambiar una compuerta de compra a ciegas.
 */
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const n = Number(process.argv[2]) > 0 ? Number(process.argv[2]) : 10;
const url = arg("--url") ?? process.env["LOCAL_LLM_URL"] ?? "http://127.0.0.1:8091";
const modelo = arg("--modelo") ?? process.env["LOCAL_LLM_MODEL"] ?? "local";
const salida = arg("--salida");

const cfg = await loadConfig();
const c = buildContainer(cfg);
const deps = c.radarDeps;
const today = todayLocal();
const filas = (await c.store.latestCandidates()).filter((r) => r.kind === "stock" && r.summary !== null);
// Primero las COMPRAR (son las que la ficha puede degradar), después el resto.
filas.sort((a, b) => (a.verdict === b.verdict ? 0 : a.verdict === "COMPRAR" ? -1 : 1));
const elegidas = filas.slice(0, n);
const ranked = new Map(rankStocks(await rankableFundamentals(deps, today), deps.policy.weights).ranked.map((r) => [r.symbol, r]));
const local = new LocalCardWriter({ url, model: modelo });
console.log(`[comparar] ${elegidas.length} filas con ficha de Gemini · modelo local ${modelo} en ${url}`);
let ok = 0, fallas = 0, degradaLocal = 0, degradaGemini = 0, ms = 0;
for (const row of elegidas) {
  const r = ranked.get(row.symbol);
  const f = await c.store.fundamentals(row.symbol);
  if (!r || !f || row.close === null) { console.log(`\n## ${row.symbol}: sin ranking, fundamentales o cierre hoy, se saltea`); continue; }
  const st = await c.store.statements(row.symbol);
  const verdict = row.verdict === "COMPRAR" ? "COMPRAR" : "OBSERVAR";
  const input = await cardInputFor(deps, f, r, verdict, { flags: row.flags, close: row.close, stop: row.stop, target: row.target, riskScore: row.riskScore ?? 0 }, f.insiderBuys90d === null ? null : { buys: f.insiderBuys90d, sells: f.insiderSells90d ?? 0 }, { core: st?.core ?? null, quarters: st?.quarters.slice(-4) ?? [], events: row.events });
  const t0 = Date.now();
  try {
    const card = await local.write(input);
    const t = Date.now() - t0;
    ms += t; ok++;
    if (card.degrade) degradaLocal++;
    if (row.degradedBy === "narrator") degradaGemini++;
    console.log(`\n## ${row.symbol} (${row.verdict}) · local en ${(t / 1000).toFixed(1)} s`);
    console.log(`GEMINI  qué hace:  ${row.summary}`);
    console.log(`LOCAL   qué hace:  ${card.summary}`);
    console.log(`GEMINI  por qué:   ${row.whyRanks}`);
    console.log(`LOCAL   por qué:   ${card.whyRanks}`);
    console.log(`GEMINI  riesgo:    ${row.mainRisk}`);
    console.log(`LOCAL   riesgo:    ${card.mainRisk}`);
    console.log(`foso    gemini ${row.moat} · local ${card.moat}${card.degrade ? ` · LOCAL DEGRADA: ${card.degradeReason}` : ""}`);
    if (salida) await appendFile(salida, `${JSON.stringify({ symbol: row.symbol, input, gemini: { summary: row.summary, whyRanks: row.whyRanks, mainRisk: row.mainRisk, moat: row.moat, degradedBy: row.degradedBy }, local: card, ms: t })}\n`);
  } catch (e) {
    fallas++;
    console.log(`\n## ${row.symbol}: la ficha local FALLÓ: ${String(e).slice(0, 200)}`);
  }
}
console.log(`\n[comparar] ${ok} fichas locales válidas, ${fallas} fallidas · ${ok ? (ms / ok / 1000).toFixed(1) : "—"} s promedio · degradaría local ${degradaLocal}, Gemini degradó ${degradaGemini}`);
process.exit(0);
