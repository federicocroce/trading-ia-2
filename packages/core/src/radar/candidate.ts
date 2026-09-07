import { atr, computeTarget, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import type { Fundamentals } from "./ranking.js";
import type { RadarPolicy } from "./types.js";

/** Reglas de candidato (spec etapa 2 §6): lo técnico filtra, no rankea. Puro. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

export function sma(candles: Candle[], n: number): number | null {
  if (candles.length < n) return null;
  const last = candles.slice(-n);
  return round2(last.reduce((s, c) => s + c.close, 0) / n);
}
/** Retorno del cierre actual contra el cierre de hace `n` velas, en %. */
export function returnPct(candles: Candle[], n: number): number | null {
  if (candles.length < n + 1) return null;
  const last = candles[candles.length - 1]!.close;
  const prev = candles[candles.length - 1 - n]!.close;
  return prev > 0 ? round2((last / prev - 1) * 100) : null;
}
export function atrPct(candles: Candle[], period = 14): number | null {
  const a = atr(candles, period);
  const close = candles[candles.length - 1]?.close;
  return a === null || !close ? null : round2((a / close) * 100);
}

export interface TechnicalGate {
  status: "ok" | "observar" | "excluido";
  reasons: string[];
  close: number;
  sma200: number | null;
  return21dPct: number | null;
  atrPct: number | null;
}

export function technicalGate(candles: Candle[], p: RadarPolicy["technical"], nextEarnings: string | null, today: string): TechnicalGate {
  const close = candles[candles.length - 1]?.close ?? Number.NaN;
  const s200 = sma(candles, 200);
  const r21 = returnPct(candles, 21);
  const a = atrPct(candles);
  if (candles.length < 200 || s200 === null) return { status: "excluido", reasons: ["sin_historial"], close, sma200: s200, return21dPct: r21, atrPct: a };
  if (close < s200) return { status: "excluido", reasons: ["bajo_sma200"], close, sma200: s200, return21dPct: r21, atrPct: a };
  const reasons: string[] = [];
  if (r21 !== null && r21 > p.maxReturn21dPct) reasons.push("no_perseguir");
  if (nextEarnings) {
    const days = (Date.parse(nextEarnings) - Date.parse(today)) / DAY;
    if (days >= 0 && days <= p.earningsWithinDays) reasons.push("resultados_cerca");
  }
  return { status: reasons.length ? "observar" : "ok", reasons, close, sma200: s200, return21dPct: r21, atrPct: a };
}

/** Riesgo por operación como % de la cartera, entre entrada alta y stop; tope por posición. */
export function positionSize(i: { entryHigh: number; stop: number | null; portfolioUsd: number | null }, s: RadarPolicy["sizing"]): { qty: number; sizeUsd: number; riskUsd: number } | null {
  if (i.stop === null || i.stop >= i.entryHigh) return null;
  const portfolio = i.portfolioUsd ?? s.fallbackPortfolioUsd;
  const riskUsd = round2((portfolio * s.riskPerTradePct) / 100);
  let qty = Math.floor(riskUsd / (i.entryHigh - i.stop));
  const cap = (portfolio * s.maxPositionPct) / 100;
  if (qty * i.entryHigh > cap) qty = Math.floor(cap / i.entryHigh);
  if (qty <= 0) return null;
  return { qty, sizeUsd: round2(qty * i.entryHigh), riskUsd };
}

/** 1 (tranquilo) a 10 (especulativo). Tabla de la spec. */
export function riskScore(i: { beta: number | null; atrPct: number | null; debtToEquity: number | null; dollarVolumeUsd: number; mcapUsd: number }): number {
  let r = 1;
  if (i.beta !== null) r += i.beta > 1.5 ? 2 : i.beta > 1.2 ? 1 : 0;
  if (i.atrPct !== null) r += i.atrPct > 4 ? 2 : i.atrPct > 2.5 ? 1 : 0;
  if (i.debtToEquity !== null) r += i.debtToEquity > 1.5 ? 2 : i.debtToEquity > 0.8 ? 1 : 0;
  r += i.dollarVolumeUsd < 10e6 ? 2 : i.dollarVolumeUsd < 25e6 ? 1 : 0;
  r += i.mcapUsd < 2e9 ? 2 : i.mcapUsd < 10e9 ? 1 : 0;
  return Math.min(10, r);
}

export function buildFlags(f: Fundamentals, gate: TechnicalGate, nthAppearance: number, chronicWeeks: number): string[] {
  const flags: string[] = [];
  if ((f.insiderBuys90d ?? 0) >= 1) flags.push("insiders_compran");
  if ((f.insiderSells90d ?? 0) >= 3) flags.push("insiders_venden");
  if (f.analyst) {
    const total = f.analyst.strongBuy + f.analyst.buy + f.analyst.hold + f.analyst.sell + f.analyst.strongSell;
    if (total > 0 && (f.analyst.strongBuy + f.analyst.buy) / total > 0.6) flags.push("consenso_compra");
    if (total > 0 && (f.analyst.sell + f.analyst.strongSell) / total > 0.4) flags.push("consenso_venta");
  }
  const last = f.earningsSurprises?.[0]?.surprisePercent;
  if (last !== null && last !== undefined) {
    if (last > 5) flags.push("sorpresa_positiva");
    if (last < -5) flags.push("sorpresa_negativa");
  }
  const dy = f.metrics["dividendYieldIndicatedAnnual"];
  if (dy !== null && dy !== undefined && dy > 2) flags.push("dividendo");
  flags.push(...gate.reasons);
  if (nthAppearance >= chronicWeeks) flags.push("residente_cronico");
  return flags;
}

export interface CandidateDecision {
  verdict: "COMPRAR" | "OBSERVAR";
  flags: string[];
  entryLow: number;
  entryHigh: number;
  stop: number | null;
  target: number | null;
  size: { qty: number; sizeUsd: number } | null;
  riskScore: number;
  reasons: string[];
  gate: TechnicalGate;
}

export function decideCandidate(
  i: { f: Fundamentals; candles: Candle[]; nthAppearance: number; portfolioUsd: number | null; today: string },
  p: Pick<RadarPolicy, "technical" | "sizing" | "candidates">,
): CandidateDecision | { excluded: true; reasons: string[] } {
  const gate = technicalGate(i.candles, p.technical, i.f.nextEarnings, i.today);
  if (gate.status === "excluido") return { excluded: true, reasons: gate.reasons };
  const flags = buildFlags(i.f, gate, i.nthAppearance, p.candidates.chronicWeeks);
  const reasons = [...gate.reasons, ...(flags.includes("residente_cronico") ? ["residente_cronico"] : [])];
  const close = gate.close;
  const entryHigh = round2(close * 1.02);
  const stop = computeTrailingStop(i.candles);
  const target = computeTarget(close, stop);
  const size = positionSize({ entryHigh, stop, portfolioUsd: i.portfolioUsd }, p.sizing);
  const risk = riskScore({ beta: i.f.metrics["beta"] ?? null, atrPct: gate.atrPct, debtToEquity: i.f.metrics["totalDebt/totalEquityAnnual"] ?? null, dollarVolumeUsd: i.f.dollarVolumeUsd, mcapUsd: i.f.mcapUsd });
  return { verdict: reasons.length ? "OBSERVAR" : "COMPRAR", flags, entryLow: close, entryHigh, stop, target, size: size ? { qty: size.qty, sizeUsd: size.sizeUsd } : null, riskScore: risk, reasons, gate };
}
