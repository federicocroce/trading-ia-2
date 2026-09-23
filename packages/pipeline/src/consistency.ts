import type { Candle, Finding } from "@thesis/core";
import { checkConsistency, lastCompletedSession, summarizeFindings } from "@thesis/core";
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

export async function checkRun(deps: Pick<RadarDeps, "store" | "log">, opts: { today: string; now?: () => Date }): Promise<ConsistencyReport> {
  const rows = await deps.store.latestCandidates();
  const plan = await deps.store.latestPlan().catch(() => null);
  // Hasta dónde TENÍAN que llegar las velas. Sale del calendario, no de lo guardado: es el único testigo de
  // afuera que tiene el chequeo (23/9, ver `velas_desfasadas`). Se ancla a CUÁNDO SE ARMÓ la corrida, no a
  // "ahora": entre el cierre de EE.UU. y el refresco de la mañana siguiente las velas están legítimamente una
  // rueda atrás, y un control que grita todas las tardes con datos correctos enseña a ignorar los graves.
  const armadoEn = plan?.builtAt ? new Date(plan.builtAt) : (opts.now ?? (() => new Date()))();
  const lastSession = lastCompletedSession(armadoEn);
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
  const industries: Record<string, string | null> = {};
  for (const r of rows) {
    const f = await deps.store.fundamentals(r.symbol).catch(() => null);
    if (f) {
      metrics[r.symbol] = f.metrics;
      mcaps[r.symbol] = f.mcapUsd;
      industries[r.symbol] = f.industry;
    }
  }
  // Hasta qué fecha se leyeron las noticias de cada símbolo: es lo que separa "no hubo eventos" de "nadie miró".
  const newsScannedTo: Record<string, string | null> = {};
  for (const r of rows) newsScannedTo[r.symbol] = await deps.store.newsScannedTo(r.symbol).catch(() => null);
  // Lo que está en cartera usa su stop de seguimiento: sin esta lista, `stop_dentro_del_ruido` no puede correr.
  const held = (await deps.store.positions().catch(() => null))?.map((p) => p.symbol);
  // La última verificación guardada de cada símbolo, la que muestra la ficha: la fila tiene que decir la misma.
  const verifications: Record<string, { date: string; verdict: string } | null> = {};
  for (const r of rows) {
    const v = await deps.store.verification(r.symbol).catch(() => null);
    verifications[r.symbol] = v ? { date: v.date, verdict: v.verdict } : null;
  }
  const findings = checkConsistency({ rows, candles, plan, metrics, mcaps, industries, newsScannedTo, verifications, lastSession, today: opts.today, ...(held ? { held } : {}) });
  const { graves, avisos } = summarizeFindings(findings);
  if (findings.length === 0) deps.log?.(`[consistencia] ${rows.length} filas revisadas: sin contradicciones`);
  else {
    deps.log?.(`[consistencia] ${graves} graves y ${avisos} avisos sobre ${rows.length} filas`);
    for (const f of findings) deps.log?.(`[consistencia] ${f.severity === "grave" ? "GRAVE" : "aviso"} ${f.check} ${f.symbol ?? ""}: ${f.detail}`);
  }
  return { date: opts.today, findings, graves, avisos };
}
