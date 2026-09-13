import type { Candle, Finding } from "@thesis/core";
import { checkConsistency, summarizeFindings } from "@thesis/core";
import type { RadarDeps } from "./radar.js";

/**
 * Corre el chequeo de consistencia sobre lo que la app acaba de guardar (ver core/radar/consistency.ts).
 * Va al final de cada corrida: si la salida se contradice con sus propias fuentes, se entera la app, no el dueño.
 */
const DAY = 86_400_000;

export interface ConsistencyReport {
  date: string;
  findings: Finding[];
  graves: number;
  avisos: number;
}

export async function checkRun(deps: Pick<RadarDeps, "store" | "log">, opts: { today: string }): Promise<ConsistencyReport> {
  const rows = await deps.store.latestCandidates();
  const plan = await deps.store.latestPlan().catch(() => null);
  // Solo las últimas ruedas: alcanza para comparar el cierre guardado contra el último cierre real.
  const desde = new Date(Date.parse(opts.today) - 10 * DAY).toISOString().slice(0, 10);
  const candles: Record<string, Candle[]> = {};
  for (const r of rows) {
    // Las filas argentinas cotizan en pesos y no comparten la serie con el resto: se saltean.
    if (r.kind === "ar" || r.kind === "cedear") continue;
    const c = await deps.store.candles(r.symbol, desde).catch(() => [] as Candle[]);
    if (c.length) candles[r.symbol] = c;
  }
  // Métricas de Finnhub por símbolo: sin esto no se pueden ver los fundamentales que se contradicen solos.
  const metrics: Record<string, Record<string, number | null | undefined>> = {};
  const mcaps: Record<string, number | null> = {};
  for (const r of rows) {
    const f = await deps.store.fundamentals(r.symbol).catch(() => null);
    if (f) {
      metrics[r.symbol] = f.metrics;
      mcaps[r.symbol] = f.mcapUsd;
    }
  }
  const findings = checkConsistency({ rows, candles, plan, metrics, mcaps, today: opts.today });
  const { graves, avisos } = summarizeFindings(findings);
  if (findings.length === 0) deps.log?.(`[consistencia] ${rows.length} filas revisadas: sin contradicciones`);
  else {
    deps.log?.(`[consistencia] ${graves} graves y ${avisos} avisos sobre ${rows.length} filas`);
    for (const f of findings) deps.log?.(`[consistencia] ${f.severity === "grave" ? "GRAVE" : "aviso"} ${f.check} ${f.symbol ?? ""}: ${f.detail}`);
  }
  return { date: opts.today, findings, graves, avisos };
}
