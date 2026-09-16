import type { FinnhubMetrics } from "./universe.js";
import type { RadarPolicy } from "./types.js";

/**
 * Ranking fundamental contra pares (spec etapa 2 §6). Puro.
 * z robusto = (x − mediana) / (1.4826 × MAD), winsorizado a ±3, dentro del grupo de comparación.
 */
export interface Fundamentals {
  symbol: string;
  asOf: string;
  metrics: FinnhubMetrics;
  peers: string[];
  industry: string | null;
  /** null = desconocida (ADR cuya relación no se conoce); cuenta como riesgo alto. */
  mcapUsd: number | null;
  dollarVolumeUsd: number;
  priceUsd: number;
  nextEarnings: string | null;
  insiderBuys90d: number | null;
  insiderSells90d: number | null;
  analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null;
  /**
   * `actual` y `estimate` son los números con los que el proveedor calculó `surprisePercent`. Se guardan desde el
   * 16/9 porque sin ellos la fila afirmaba "el último resultado decepcionó" y no había con qué contrastarlo: SPNT
   * marcaba −10,85% y en su comunicado había superado (0,67 operativa contra 0,65 de consenso), mientras que
   * (0,58 contable − 0,65) / 0,65 = −10,77%. Opcionales: las corridas guardadas antes de esa fecha no los tienen.
   */
  earningsSurprises: Array<{ period: string; actual?: number | null; estimate?: number | null; surprisePercent: number | null }> | null;
  /** Métricas de Finnhub originales cuando `metrics` fue recalculado con la ganancia núcleo (spec verificación §4). */
  metricsRaw?: FinnhubMetrics | null;
  /** Fin del último trimestre usado; null = se intentó y no hay estados (IFRS, sin CIK, sin resultado operativo). */
  statementsAsOf?: string | null;
}

export type Axis = "valuation" | "quality" | "growth" | "balance";
export const AXES: Axis[] = ["valuation", "quality", "growth", "balance"];
export const AXIS_METRICS: Record<Axis, Array<{ key: string; invert: boolean; positiveOnly?: boolean }>> = {
  valuation: [
    { key: "peTTM", invert: true, positiveOnly: true },
    { key: "evEbitdaTTM", invert: true, positiveOnly: true },
    { key: "psTTM", invert: true, positiveOnly: true },
  ],
  quality: [{ key: "roeTTM", invert: false }, { key: "operatingMarginTTM", invert: false }, { key: "netProfitMarginTTM", invert: false }],
  // El último trimestre pesa igual que el año: un trimestre en baja no queda tapado por el crecimiento a 5 años (NUTX −13,6% con growth 1,99).
  growth: [{ key: "revenueGrowthTTMYoy", invert: false }, { key: "revenueGrowth5Y", invert: false }, { key: "epsGrowthTTMYoy", invert: false }, { key: "revenueGrowthQuarterlyYoy", invert: false }],
  balance: [{ key: "totalDebt/totalEquityAnnual", invert: true }, { key: "currentRatioAnnual", invert: false }],
};

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export function robustZ(values: Array<number | null>): Array<number | null> {
  const present = values.filter((v): v is number => v !== null && Number.isFinite(v));
  const med = median(present);
  if (med === null) return values.map(() => null);
  const mad = median(present.map((v) => Math.abs(v - med)));
  const scale = mad === null || mad === 0 ? 0 : 1.4826 * mad;
  return values.map((v) => {
    if (v === null || !Number.isFinite(v)) return null;
    if (scale === 0) return 0;
    return round4(Math.max(-3, Math.min(3, (v - med) / scale)));
  });
}

/**
 * Crecimiento de ingresos no confiable en bancos (2026-09-13). NBN era 1° por convicción con +124% TTM y +133%
 * trimestral según Finnhub; su comunicado dice +4% (65,2 M contra 62,7 M). Dos de las cuatro métricas del eje de
 * crecimiento quedaban en +3 por un dato que no existe.
 *
 * Contra la base del 13/9 el problema es de la fuente con los bancos, no de NBN: TFC +58%, AMTB +78%, MBWM +59%,
 * JPM +109%, cuando un banco crece de 0 a 15% por año. Primero probé "más de 100% sin estados de la SEC" y marcaba
 * además a NBIS (+488%), APLD (+365%) y ASTS, que crecen de verdad: le sacaba a una empresa su mejor número por un
 * defecto de otra. Por eso la regla es por industria: en bancos, el crecimiento de ingresos de Finnhub (TTM y
 * trimestral) no entra al ranking. El de 5 años y el de EPS siguen; la fila lo dice con `crecimiento_no_confiable`.
 */
export const UNRELIABLE_GROWTH_INDUSTRY = /^bank/i;
const REVENUE_GROWTH_KEYS = ["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"] as const;
export function unreliableGrowthKeys(f: Fundamentals): string[] {
  if (!f.industry || !UNRELIABLE_GROWTH_INDUSTRY.test(f.industry)) return [];
  return REVENUE_GROWTH_KEYS.filter((k) => {
    const v = f.metrics[k];
    return typeof v === "number" && Number.isFinite(v);
  });
}

const metricOf = (f: Fundamentals, spec: { key: string; positiveOnly?: boolean }): number | null => {
  const v = f.metrics[spec.key];
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (unreliableGrowthKeys(f).includes(spec.key)) return null;
  if (spec.positiveOnly && v <= 0) return null;
  return v;
};

/**
 * Umbrales para descartar comparables sin ingresos reales. Una empresa antes de facturar tiene P/S de miles
 * y margen operativo de miles negativos: sus ratios no son una medición, son una división por casi cero.
 * Metidos en un grupo de diez, corren la escala y aplastan la ventaja de los demás. Amphenol comparaba contra
 * LWLG (825 M de capitalización, P/S 3.295, margen operativo −9.720%) y eso le bajaba su z de margen
 * operativo de +3,00 a +2,00: dejaba de verse que tiene el mejor margen del grupo por lejos.
 *
 * Los umbrales son deliberadamente extremos: no sacan a una empresa cara ni a una que pierde plata, solo a la
 * que todavía no vende. Un biotech con margen operativo de −421% sigue entrando.
 */
export const PEER_BAR = { maxPs: 50, minOperatingMarginPct: -500 };

/** ¿Tiene ingresos suficientes para que sus ratios midan algo? */
export function comparablePeer(f: Fundamentals | undefined): boolean {
  if (!f) return false;
  const ps = f.metrics["psTTM"];
  const mo = f.metrics["operatingMarginTTM"];
  if (typeof ps === "number" && Number.isFinite(ps) && ps > PEER_BAR.maxPs) return false;
  if (typeof mo === "number" && Number.isFinite(mo) && mo < PEER_BAR.minOperatingMarginPct) return false;
  return true;
}

/** Grupo de comparación: pares ∩ universo con ingresos reales (máx 10); si < minSize, la industria; si tampoco, null. */
export function peerGroup(symbol: string, all: Map<string, Fundamentals>, minSize = 4): { members: string[]; basis: "pares" | "industria" } | null {
  const f = all.get(symbol);
  if (!f) return null;
  const peers = [...new Set(f.peers.map((p) => p.toUpperCase()))].filter((p) => p !== symbol && all.has(p) && comparablePeer(all.get(p))).slice(0, 10);
  if (peers.length >= minSize) return { members: peers, basis: "pares" };
  if (f.industry) {
    const ind = [...all.values()].filter((x) => x.symbol !== symbol && x.industry === f.industry && comparablePeer(x)).map((x) => x.symbol);
    if (ind.length >= minSize) return { members: ind, basis: "industria" };
  }
  return null;
}

export interface RankedStock {
  symbol: string;
  score: number;
  axes: Record<Axis, number | null>;
  group: string[];
  basis: "pares" | "industria";
  rankInGroup: number;
  groupSize: number;
  /** Mediana del grupo (incluido el símbolo) por métrica, para la ficha. */
  medians: Record<string, number | null>;
}

/** Score de un miembro dentro de un conjunto (el conjunto incluye al miembro). null si ≤ 1 eje disponible. */
function scoreWithin(symbol: string, set: Fundamentals[], weights: RadarPolicy["weights"]): { score: number; axes: Record<Axis, number | null> } | null {
  const idx = set.findIndex((f) => f.symbol === symbol);
  const axes = {} as Record<Axis, number | null>;
  for (const axis of AXES) {
    const zs: number[] = [];
    for (const spec of AXIS_METRICS[axis]) {
      const z = robustZ(set.map((f) => metricOf(f, spec)))[idx];
      if (z !== null && z !== undefined) zs.push(spec.invert ? -z : z);
    }
    axes[axis] = zs.length ? round4(zs.reduce((a, b) => a + b, 0) / zs.length) : null;
  }
  const available = AXES.filter((a) => axes[a] !== null);
  if (available.length <= 1) return null;
  const wsum = available.reduce((s, a) => s + weights[a], 0);
  const score = round4(available.reduce((s, a) => s + weights[a] * axes[a]!, 0) / wsum);
  return { score, axes };
}

/**
 * Mediana de cada métrica sobre el grupo COMPLETO, la propia empresa incluida, con las mismas reglas que el
 * puntaje (`positiveOnly` descarta un P/E negativo, que no es "barato": es no ganar plata).
 *
 * Es la única fuente de esa mediana. Existe porque el 13/9 la tabla de comparables la recalculaba por su
 * cuenta en el navegador, EXCLUYENDO a la propia empresa y sin `positiveOnly`: mostraba "mediana del grupo
 * (8)" y un P/E de 67,3× para APH, cuando el puntaje usaba 66,0× sobre nueve. Dos números distintos para lo
 * mismo, en la tabla que existe justamente para justificar el puntaje.
 */
export function groupMedians(set: Array<Pick<Fundamentals, "metrics">>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const axis of AXES) {
    for (const spec of AXIS_METRICS[axis]) {
      out[spec.key] = median(set.map((m) => metricOf(m as Fundamentals, spec)).filter((v): v is number => v !== null));
    }
  }
  return out;
}

export function rankStocks(all: Map<string, Fundamentals>, weights: RadarPolicy["weights"]): { ranked: RankedStock[]; skipped: Array<{ symbol: string; reason: string }> } {
  const ranked: RankedStock[] = [];
  const skipped: Array<{ symbol: string; reason: string }> = [];
  for (const f of all.values()) {
    const g = peerGroup(f.symbol, all);
    if (!g) {
      skipped.push({ symbol: f.symbol, reason: "sin_pares" });
      continue;
    }
    const set = [f, ...g.members.map((m) => all.get(m)!)];
    const own = scoreWithin(f.symbol, set, weights);
    if (!own) {
      skipped.push({ symbol: f.symbol, reason: "ejes_insuficientes" });
      continue;
    }
    const scores = set.map((m) => ({ symbol: m.symbol, score: scoreWithin(m.symbol, set, weights)?.score ?? Number.NEGATIVE_INFINITY })).sort((a, b) => b.score - a.score);
    const rankInGroup = scores.findIndex((s) => s.symbol === f.symbol) + 1;
    ranked.push({ symbol: f.symbol, score: own.score, axes: own.axes, group: g.members, basis: g.basis, rankInGroup, groupSize: set.length, medians: groupMedians(set) });
  }
  ranked.sort((a, b) => b.score - a.score);
  return { ranked, skipped };
}
