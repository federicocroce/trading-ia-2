import { computeTarget, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { atrPct, returnPct, sma } from "./candidate.js";
import { relativeStrength } from "./etf.js";
import type { RadarPolicy } from "./types.js";

/**
 * Argentina (etapa 3): acciones de BYMA contra el Merval, CEDEARs contra el CCL y el contexto macro.
 * Todo puro. Los precios locales están en pesos; el CCL los traduce a dólares.
 */
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

export interface ArStockConfig {
  symbol: string;
  name: string;
  /** Ticker del ADR en EE.UU. si existe: ahí están los fundamentals y el precio en dólares. */
  adr: string | null;
  sector: string;
  themes?: string[] | undefined;
}
export interface CedearConfig {
  symbol: string;
  us: string;
  /** Cuántos CEDEARs equivalen a una acción en EE.UU. Cambia con splits: el chequeo de brecha lo delata. */
  ratio: number;
}
export interface ArgentinaConfig {
  benchmark: string;
  acciones: ArStockConfig[];
  cedears: CedearConfig[];
}

export interface MacroAr {
  date: string;
  oficial: number | null;
  mep: number | null;
  ccl: number | null;
  blue: number | null;
  mayorista: number | null;
  /** CCL contra oficial, en %. */
  brechaPct: number | null;
  riesgoPais: number | null;
  merval: number | null;
  mervalUsd: number | null;
}

export function macroAr(i: { date: string; dolares: Partial<Record<"oficial" | "mep" | "ccl" | "blue" | "mayorista", number>>; riesgoPais: number | null; merval: number | null }): MacroAr {
  const d = i.dolares;
  const ccl = d.ccl ?? null;
  const oficial = d.oficial ?? null;
  return {
    date: i.date,
    oficial,
    mep: d.mep ?? null,
    ccl,
    blue: d.blue ?? null,
    mayorista: d.mayorista ?? null,
    brechaPct: ccl && oficial ? round2((ccl / oficial - 1) * 100) : null,
    riesgoPais: i.riesgoPais,
    merval: i.merval,
    mervalUsd: ccl && i.merval ? round2(i.merval / ccl) : null,
  };
}

export interface ArStockDecision {
  verdict: "COMPRAR" | "OBSERVAR";
  rs3m: number | null;
  rs6m: number | null;
  rs12m: number | null;
  distSma200Pct: number | null;
  atrPct: number | null;
  reasons: string[];
  close: number;
  closeUsd: number | null;
  stop: number | null;
  target: number | null;
}

/** Misma regla que los ETFs satélite, con el Merval de referencia: fuerza relativa 6m > 0 y sobre la SMA200. */
export function decideArStock(candles: Candle[], merval: Candle[], ccl: number | null, p: RadarPolicy["technical"]): ArStockDecision | { excluded: true; reasons: string[] } {
  if (candles.length < 200) return { excluded: true, reasons: ["sin_historial"] };
  const close = candles[candles.length - 1]!.close;
  const s200 = sma(candles, 200);
  const stop = computeTrailingStop(candles);
  const rs6m = relativeStrength(candles, merval, 126);
  const reasons: string[] = [];
  if (rs6m === null || rs6m <= 0) reasons.push(`fuerza relativa 6m ${rs6m ?? "—"}% ≤ 0 contra el Merval`);
  if (s200 !== null && close < s200) reasons.push("bajo SMA200");
  const r21 = returnPct(candles, 21);
  if (r21 !== null && r21 > p.maxReturn21dPct) reasons.push("no_perseguir");
  return {
    verdict: reasons.length ? "OBSERVAR" : "COMPRAR",
    rs3m: relativeStrength(candles, merval, 63),
    rs6m,
    rs12m: relativeStrength(candles, merval, 252),
    distSma200Pct: s200 ? round2((close / s200 - 1) * 100) : null,
    atrPct: atrPct(candles),
    reasons,
    close,
    closeUsd: ccl ? round4(close / ccl) : null,
    stop,
    target: computeTarget(close, stop),
  };
}

export type CedearFlag = "en_linea" | "caro_vs_ccl" | "barato_vs_ccl" | "ratio_dudoso";
export interface CedearCheck {
  /** Dólar que pagás comprando la acción vía CEDEAR: precio local × ratio / precio en EE.UU. */
  impliedCcl: number;
  /** Dólar implícito contra el CCL, en %. Positivo = el CEDEAR está caro. */
  gapPct: number;
  /** Precio del CEDEAR pasado a dólares al CCL, comparable con el precio en EE.UU. */
  priceUsd: number;
  flag: CedearFlag;
}
const CEDEAR_GAP_PCT = 2;
const CEDEAR_RATIO_DOUBT_PCT = 10;

export function cedearCheck(cfg: CedearConfig, baClose: number, usClose: number, ccl: number): CedearCheck {
  const impliedCcl = round2((baClose * cfg.ratio) / usClose);
  const gapPct = round2((impliedCcl / ccl - 1) * 100);
  const flag: CedearFlag = Math.abs(gapPct) > CEDEAR_RATIO_DOUBT_PCT ? "ratio_dudoso" : gapPct > CEDEAR_GAP_PCT ? "caro_vs_ccl" : gapPct < -CEDEAR_GAP_PCT ? "barato_vs_ccl" : "en_linea";
  return { impliedCcl, gapPct, priceUsd: round2((baClose * cfg.ratio) / ccl), flag };
}
