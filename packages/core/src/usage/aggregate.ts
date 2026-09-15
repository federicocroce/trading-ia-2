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
  /** 429 sin decir qué límite: no es cuota diaria (15/9). */
  limite: number;
  saturado: number;
  validacion: number;
  error: number;
  tokensIn: number;
  tokensOut: number;
  tokensThink: number;
  costUsd: number;
  limitPerDay: number | null;
  pctDay: number | null;
  /**
   * Cuota diaria agotada: hubo un 429 por día (después del reinicio de Google) y ninguna respuesta buena después
   * del último. El 15/9 la clave 1 de 2.5-flash dio 429 "por día" a las 10:51 y siguió contestando bien a las 14:56
   * y a las 15:48; la tabla decía "agotada hoy" desde las 10:51. Una respuesta buena posterior prueba que no lo estaba.
   */
  exhausted: boolean;
  /** Último 429 por día del día de cuota (ISO), y última respuesta buena (ISO): la pantalla muestra las dos horas. */
  lastRpdAt: string | null;
  lastOkAt: string | null;
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
  /** Cuánto del día cubre el registro: un día anterior al registro no tuvo cero llamadas, no tiene datos. */
  coverage: { state: UsageCoverage; from: string | null };
  /** Reinicio de la cuota de Gemini dentro del día (ISO): lo anterior cuenta para la cuota del día previo. */
  quotaResetAt: string | null;
}

/** `sin_registro`: el día entero es anterior al registro. `parcial`: el registro empieza ese día. */
export type UsageCoverage = "completo" | "parcial" | "sin_registro";

/**
 * Primera fila de `external_calls`: el 14/9 a las 00:33 de Buenos Aires. La tabla existe desde el 10/9, pero la
 * API que corría (la de launchd) no registraba hasta ese momento; del 10 al 13/9 no hay datos, y la pestaña Uso
 * los dibujaba como días con cero llamadas. Lo anterior a esta fecha, o al vencimiento de la retención, es "sin registro".
 */
export const REGISTRO_USO_DESDE = "2026-09-14T03:33:52.384Z";

export interface SummarizeOptions {
  date: string;
  limits?: Record<UsageSource, SourceLimit>;
  /** Aviso cuando una fuente pasa este % de su límite (día o minuto). */
  warnAtPct?: number;
  /** Aviso cuando Gemini falla más que este % del día. */
  geminiFailWarnPct?: number;
  /** Límites del día pedido (ISO) y desde cuándo hay registro: para decir "sin registro" en vez de cero. */
  dayFrom?: string;
  dayTo?: string;
  registroDesde?: string | null;
  /** Reinicio de la cuota de Gemini dentro del día (ver `geminiQuotaResetWithin`). */
  quotaResetAt?: string | null;
}

/** Un día de la serie de uso: llamadas, errores, costo equivalente y llamadas por fuente. */
export interface UsageDay {
  date: string;
  calls: number;
  errors: number;
  costUsd: number;
  bySource: Record<string, number>;
  geminiCalls: number;
  geminiFailed: number;
  coverage: UsageCoverage;
}

/**
 * Medianoche de California (reinicio de la cuota gratis de Gemini) dentro de [fromIso, toIso), o null. Con
 * horario de verano allá es a las 07:00 UTC, 04:00 en Buenos Aires; sin él, a las 08:00 UTC (05:00). La pestaña
 * Uso corta el día a la medianoche de acá: lo de 00:00 a 04:00 es de la cuota del día anterior.
 */
export function geminiQuotaResetWithin(fromIso: string, toIso: string): string | null {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  const horaEnLA = (ms: number) => Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hourCycle: "h23" }).format(new Date(ms)));
  for (let d = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate() - 1); d <= to; d += 86_400_000) {
    for (const h of [7, 8]) {
      const t = d + h * 3_600_000;
      if (t >= from && t < to && horaEnLA(t) === 0) return new Date(t).toISOString();
    }
  }
  return null;
}

const coverageOf = (dayFrom: string | undefined, dayTo: string | undefined, registroDesde: string | null | undefined): UsageCoverage => {
  if (!registroDesde || !dayFrom || !dayTo) return "completo";
  if (dayTo <= registroDesde) return "sin_registro";
  return dayFrom < registroDesde ? "parcial" : "completo";
};

/**
 * Serie diaria para el gráfico de la pestaña Uso. `dates` fija qué días salen (con ceros si no hubo nada) y
 * `dateOf` traduce la hora ISO de cada llamada al día local (la API pasa su `localDate`). Con `registroDesde`, los
 * días anteriores salen `sin_registro` y el del inicio `parcial`. Puro.
 */
export function dailyUsage(calls: UsageCall[], dates: string[], dateOf: (iso: string) => string, opts: { registroDesde?: string | null } = {}): UsageDay[] {
  const inicio = opts.registroDesde ? dateOf(opts.registroDesde) : null;
  const cobertura = (d: string): UsageCoverage => (!inicio || d > inicio ? "completo" : d === inicio ? "parcial" : "sin_registro");
  const days = new Map<string, UsageDay>(dates.map((d) => [d, { date: d, calls: 0, errors: 0, costUsd: 0, bySource: {}, geminiCalls: 0, geminiFailed: 0, coverage: cobertura(d) }]));
  for (const c of calls) {
    const d = days.get(dateOf(c.at));
    if (!d) continue;
    d.calls++;
    if (c.result !== "ok") d.errors++;
    d.bySource[c.source] = (d.bySource[c.source] ?? 0) + 1;
    if (c.source === "gemini") {
      d.geminiCalls++;
      if (c.result !== "ok") d.geminiFailed++;
      d.costUsd += estimateCostUsd(c.model ?? c.endpoint, c.tokensIn, c.tokensOut, c.tokensThink);
    }
  }
  return dates.map((x) => {
    const d = days.get(x)!;
    return { ...d, costUsd: Math.round(d.costUsd * 1000) / 1000 };
  });
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
  // Orden de llegada del día de cuota por modelo y clave: "agotada" depende de qué pasó DESPUÉS del último 429 diario.
  const orden = new Map<string, { rpd: number; ok: number }>();
  const reset = opts.quotaResetAt ?? null;
  let costUsd = 0;
  const ordenadas = [...calls].sort((a, b) => a.at.localeCompare(b.at));
  for (const [i, c] of ordenadas.entries()) {
    let s = bySource.get(c.source);
    if (!s) {
      s = { calls: 0, ok: 0, errors: 0, minutes: new Map() };
      bySource.set(c.source, s);
    }
    s.calls++;
    if (isError(c.result)) s.errors++;
    else s.ok++;
    // El freno por minuto de Gemini es por modelo Y por clave (KeyedRateLimiter usa `modelo#clave`), así que
    // contar el minuto por fuente entera suma llamadas de cuatro claves contra un límite de una sola. El
    // 11/9 eso mostraba 12 llamadas y "120% del límite" en rojo, cuando el máximo real por modelo+clave era 6.
    const cubo = limits[c.source]?.perModelKey ? `${c.at.slice(0, 16)}|${c.model ?? ""}|${c.keyIndex ?? ""}` : c.at.slice(0, 16);
    s.minutes.set(cubo, (s.minutes.get(cubo) ?? 0) + 1);

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
        g = { model, keyIndex, calls: 0, ok: 0, rpm: 0, rpd: 0, limite: 0, saturado: 0, validacion: 0, error: 0, tokensIn: 0, tokensOut: 0, tokensThink: 0, costUsd: 0, limitPerDay: limits.gemini.perDay, pctDay: null, exhausted: false, lastRpdAt: null, lastOkAt: null };
        gem.set(gk, g);
      }
      g.calls++;
      g[c.result]++;
      // Un 429 diario de antes del reinicio de Google es de la cuota del día anterior: no agota la de hoy.
      if (!reset || c.at >= reset) {
        const o = orden.get(gk) ?? { rpd: -1, ok: -1 };
        if (c.result === "rpd") { o.rpd = i; g.lastRpdAt = c.at; }
        if (c.result === "ok") { o.ok = i; g.lastOkAt = c.at; }
        orden.set(gk, o);
      }
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
      // Google no publica la cuota diaria real de estas claves (10/9: 429 diario con 15–20 llamadas, y la búsqueda con menos de 10):
      // la evidencia manda. Agotada = 429 diario sin ninguna respuesta buena después (15/9: la clave 1 contestó bien
      // a las 14:56 y a las 15:48 después del 429 de las 10:51, y la pantalla la daba por agotada).
      const o = orden.get(`${g.model}#${g.keyIndex}`);
      g.exhausted = !!o && o.rpd > o.ok;
      g.pctDay = g.exhausted ? 100 : pct(g.calls, g.limitPerDay);
      if (g.exhausted) warnings.push(`gemini ${g.model} clave ${g.keyIndex}: cuota diaria agotada (429 por día sin respuestas buenas después) tras ${g.calls} llamadas`);
      if (g.limite > 0) warnings.push(`gemini ${g.model} clave ${g.keyIndex}: ${g.limite} rechazos 429 sin detalle (no es la cuota diaria; con claves gratis, por ejemplo, los 3.x no tienen búsqueda)`);
      // Solo contra un límite conocido. El 15/9 este aviso se sumaba al de "agotada" con "(100% de null)": dos avisos por
      // la misma clave, uno sin sentido.
      if (!g.exhausted && g.limitPerDay !== null && g.pctDay !== null && g.pctDay >= warnAt) warnings.push(`gemini ${g.model} clave ${g.keyIndex}: ${g.calls} llamadas hoy (${g.pctDay}% de ${g.limitPerDay})`);
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
    warnings: [...new Set(warnings)],
    coverage: { state: coverageOf(opts.dayFrom, opts.dayTo, opts.registroDesde), from: opts.registroDesde ?? null },
    quotaResetAt: reset,
  };
}
