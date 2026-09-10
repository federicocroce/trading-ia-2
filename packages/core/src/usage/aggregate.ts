import { USAGE_LIMITS, estimateCostUsd, type SourceLimit } from "./limits.js";
import type { UsageCall, UsageResult, UsageSource } from "./types.js";

export interface UsageSourceRow {
  source: UsageSource;
  calls: number;
  ok: number;
  errors: number;
  /** Máximo de llamadas en un mismo minuto del día. */
  peakPerMinute: number;
  limitPerMinute: number | null;
  limitPerDay: number | null;
  /** % del límite por minuto que alcanzó el pico; null sin límite. */
  pctMinute: number | null;
  pctDay: number | null;
}

export interface UsageGeminiRow {
  model: string;
  keyIndex: number;
  calls: number;
  ok: number;
  rpm: number;
  rpd: number;
  saturado: number;
  validacion: number;
  error: number;
  tokensIn: number;
  tokensOut: number;
  tokensThink: number;
  costUsd: number;
  limitPerDay: number | null;
  pctDay: number | null;
}

export interface UsageStepRow {
  step: string;
  source: UsageSource;
  calls: number;
  errors: number;
  ms: number;
}

export interface UsageSummary {
  date: string;
  total: { calls: number; errors: number; costUsd: number };
  bySource: UsageSourceRow[];
  gemini: {
    rows: UsageGeminiRow[];
    tokensIn: number;
    tokensOut: number;
    tokensThink: number;
    costUsd: number;
    /** % de llamadas a Gemini que no fueron ok (incluye validación). */
    failedPct: number | null;
  };
  byStep: UsageStepRow[];
  /** Avisos en palabras: fuente cerca del límite, Gemini fallando demasiado. */
  warnings: string[];
}

export interface SummarizeOptions {
  date: string;
  limits?: Record<UsageSource, SourceLimit>;
  /** Aviso cuando una fuente pasa este % de su límite (día o minuto). */
  warnAtPct?: number;
  /** Aviso cuando Gemini falla más que este % del día. */
  geminiFailWarnPct?: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number, limit: number | null) => (limit === null || limit <= 0 ? null : r2((n / limit) * 100));
const isError = (r: UsageResult) => r !== "ok";

/** Resumen del día para el panel: por fuente contra su límite, Gemini por modelo y clave, y por paso. Puro. */
export function summarizeUsage(calls: UsageCall[], opts: SummarizeOptions): UsageSummary {
  const limits = opts.limits ?? USAGE_LIMITS;
  const warnAt = opts.warnAtPct ?? 80;
  const failWarn = opts.geminiFailWarnPct ?? 20;

  const bySource = new Map<UsageSource, { calls: number; ok: number; errors: number; minutes: Map<string, number> }>();
  const gem = new Map<string, UsageGeminiRow>();
  const steps = new Map<string, UsageStepRow>();
  let costUsd = 0;
  for (const c of calls) {
    let s = bySource.get(c.source);
    if (!s) {
      s = { calls: 0, ok: 0, errors: 0, minutes: new Map() };
      bySource.set(c.source, s);
    }
    s.calls++;
    if (isError(c.result)) s.errors++;
    else s.ok++;
    const minute = c.at.slice(0, 16);
    s.minutes.set(minute, (s.minutes.get(minute) ?? 0) + 1);

    const sk = `${c.step}|${c.source}`;
    let st = steps.get(sk);
    if (!st) {
      st = { step: c.step, source: c.source, calls: 0, errors: 0, ms: 0 };
      steps.set(sk, st);
    }
    st.calls++;
    if (isError(c.result)) st.errors++;
    st.ms += c.ms;

    if (c.source === "gemini") {
      const model = c.model ?? c.endpoint;
      const keyIndex = c.keyIndex ?? 0;
      const gk = `${model}#${keyIndex}`;
      let g = gem.get(gk);
      if (!g) {
        g = { model, keyIndex, calls: 0, ok: 0, rpm: 0, rpd: 0, saturado: 0, validacion: 0, error: 0, tokensIn: 0, tokensOut: 0, tokensThink: 0, costUsd: 0, limitPerDay: limits.gemini.perDay, pctDay: null };
        gem.set(gk, g);
      }
      g.calls++;
      g[c.result]++;
      g.tokensIn += c.tokensIn ?? 0;
      g.tokensOut += c.tokensOut ?? 0;
      g.tokensThink += c.tokensThink ?? 0;
      const cost = estimateCostUsd(model, c.tokensIn, c.tokensOut, c.tokensThink);
      g.costUsd += cost;
      costUsd += cost;
    }
  }

  const warnings: string[] = [];
  const sourceRows: UsageSourceRow[] = [...bySource.entries()]
    .map(([source, s]) => {
      const lim = limits[source];
      const peak = Math.max(0, ...s.minutes.values());
      const row: UsageSourceRow = { source, calls: s.calls, ok: s.ok, errors: s.errors, peakPerMinute: peak, limitPerMinute: lim.perMinute, limitPerDay: lim.perModelKey ? null : lim.perDay, pctMinute: pct(peak, lim.perMinute), pctDay: lim.perModelKey ? null : pct(s.calls, lim.perDay) };
      if (row.pctMinute !== null && row.pctMinute >= warnAt) warnings.push(`${source}: pico de ${peak} llamadas en un minuto (${row.pctMinute}% del límite de ${lim.perMinute})`);
      if (row.pctDay !== null && row.pctDay >= warnAt) warnings.push(`${source}: ${s.calls} llamadas hoy (${row.pctDay}% del límite diario de ${lim.perDay})`);
      return row;
    })
    .sort((a, b) => b.calls - a.calls);

  const geminiRows = [...gem.values()]
    .map((g) => {
      g.costUsd = r2(g.costUsd * 1000) / 1000;
      g.pctDay = pct(g.calls, g.limitPerDay);
      if (g.pctDay !== null && g.pctDay >= warnAt) warnings.push(`gemini ${g.model} clave ${g.keyIndex}: ${g.calls} llamadas hoy (${g.pctDay}% de ${g.limitPerDay})`);
      return g;
    })
    .sort((a, b) => a.model.localeCompare(b.model) || a.keyIndex - b.keyIndex);
  const gCalls = geminiRows.reduce((n, g) => n + g.calls, 0);
  const gOk = geminiRows.reduce((n, g) => n + g.ok, 0);
  const failedPct = gCalls ? r2(((gCalls - gOk) / gCalls) * 100) : null;
  if (failedPct !== null && failedPct >= failWarn && gCalls >= 5) warnings.push(`gemini: falló el ${failedPct}% de ${gCalls} llamadas hoy`);

  const errors = calls.filter((c) => isError(c.result)).length;
  return {
    date: opts.date,
    total: { calls: calls.length, errors, costUsd: r2(costUsd * 1000) / 1000 },
    bySource: sourceRows,
    gemini: {
      rows: geminiRows,
      tokensIn: geminiRows.reduce((n, g) => n + g.tokensIn, 0),
      tokensOut: geminiRows.reduce((n, g) => n + g.tokensOut, 0),
      tokensThink: geminiRows.reduce((n, g) => n + g.tokensThink, 0),
      costUsd: r2(geminiRows.reduce((n, g) => n + g.costUsd, 0) * 1000) / 1000,
      failedPct,
    },
    byStep: [...steps.values()].sort((a, b) => b.calls - a.calls),
    warnings,
  };
}
