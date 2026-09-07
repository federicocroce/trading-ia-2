import { computeTarget, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { atrPct, returnPct, sma } from "./candidate.js";
import type { EtfConfig, RadarPolicy } from "./types.js";

/** Motor de ETFs (spec etapa 2 §7): fuerza relativa contra SPY; el núcleo no se "timea". Puro. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** (1 + r_etf) / (1 + r_spy) − 1, en %, sobre las últimas n velas. */
export function relativeStrength(etf: Candle[], spy: Candle[], n: number): number | null {
  const re = returnPct(etf, n);
  const rs = returnPct(spy, n);
  if (re === null || rs === null) return null;
  return round4(((1 + re / 100) / (1 + rs / 100) - 1) * 100);
}

export interface EtfDecision {
  verdict: "NUCLEO" | "COMPRAR" | "OBSERVAR";
  rs3m: number | null;
  rs6m: number | null;
  rs12m: number | null;
  distSma200Pct: number | null;
  atrPct: number | null;
  reasons: string[];
  close: number;
  stop: number | null;
  target: number | null;
}

export function decideEtf(cfg: EtfConfig, candles: Candle[], spy: Candle[], p: RadarPolicy["technical"]): EtfDecision | { excluded: true; reasons: string[] } {
  if (candles.length < 200) return { excluded: true, reasons: ["sin_historial"] };
  const close = candles[candles.length - 1]!.close;
  const s200 = sma(candles, 200);
  const base = {
    rs3m: relativeStrength(candles, spy, 63),
    rs6m: relativeStrength(candles, spy, 126),
    rs12m: relativeStrength(candles, spy, 252),
    distSma200Pct: s200 ? round2((close / s200 - 1) * 100) : null,
    atrPct: atrPct(candles),
    close,
    stop: computeTrailingStop(candles),
    target: null as number | null,
  };
  base.target = computeTarget(close, base.stop);
  if (cfg.role === "nucleo") return { ...base, verdict: "NUCLEO", reasons: ["núcleo: se compra por calendario, sin timing"] };
  const reasons: string[] = [];
  if (base.rs6m === null || base.rs6m <= 0) reasons.push(`fuerza relativa 6m ${base.rs6m ?? "—"}% ≤ 0 contra SPY`);
  if (s200 !== null && close < s200) reasons.push("bajo SMA200");
  const r21 = returnPct(candles, 21);
  if (r21 !== null && r21 > p.maxReturn21dPct) reasons.push("no_perseguir");
  return { ...base, verdict: reasons.length ? "OBSERVAR" : "COMPRAR", reasons };
}
