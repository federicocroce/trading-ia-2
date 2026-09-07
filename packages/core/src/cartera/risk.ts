import type { Candle, Position, SymbolProfile } from "./types.js";

export interface RiskInput {
  positions: Position[];
  candles: Record<string, Candle[]>;
  spy: Candle[];
  profiles: Record<string, SymbolProfile | null>;
  /** Etiquetas por símbolo (etapa 2): sector y temas para concentración. */
  tags?: Record<string, { sector: string; themes: string[] }>;
}
export interface RiskReport {
  totalValue: number;
  weights: Array<{ symbol: string; value: number; weightPct: number }>;
  concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; bySector: Record<string, number>; byTheme: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
  correlatedPairs: Array<{ a: string; b: string; corr: number }>;
  betas: Record<string, number | null>;
  portfolioBeta: number | null;
  /** Caída estimada (%) si SPY cae 20%: Σ peso × beta × (−20). Aproximación lineal. */
  stressSpyMinus20Pct: number | null;
  liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const MIN_POINTS = 20;

export function dailyReturns(c: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < c.length; i++) out.push(c[i]!.close / c[i - 1]!.close - 1);
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pearson sobre las últimas min(len) observaciones alineadas por el final. null si < 20. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < MIN_POINTS) return null;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  return round4(sxy / Math.sqrt(sxx * syy));
}

/** Beta = cov(asset, bench) / var(bench). null si < 20 puntos o varianza cero. */
export function beta(asset: number[], bench: number[]): number | null {
  const n = Math.min(asset.length, bench.length);
  if (n < MIN_POINTS) return null;
  const x = bench.slice(-n), y = asset.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
  }
  if (sxx === 0) return null;
  return round4(sxy / sxx);
}

/** Herfindahl sobre participaciones en % (0..10000). */
export function hhi(shares: Record<string, number>): number {
  return Math.round(Object.values(shares).reduce((s, p) => s + p * p, 0));
}

const countryOf = (p: Position, prof: SymbolProfile | null) => prof?.country ?? (p.market === "adr" || p.market === "ar" ? "AR" : "US");

export function buildRiskReport(i: RiskInput): RiskReport {
  const notes: string[] = [];
  const lastClose = (s: string) => i.candles[s]?.[i.candles[s]!.length - 1]?.close ?? null;
  const values = i.positions.map((p) => ({ symbol: p.symbol, value: (lastClose(p.symbol) ?? 0) * p.quantity }));
  const totalValue = round2(values.reduce((s, v) => s + v.value, 0));
  const weights = values.map((v) => ({ symbol: v.symbol, value: round2(v.value), weightPct: totalValue > 0 ? round2((v.value / totalValue) * 100) : 0 }));
  for (const p of i.positions) if (lastClose(p.symbol) === null) notes.push(`${p.symbol}: sin velas, valuada en 0`);

  const byCountry: Record<string, number> = {};
  const byIndustry: Record<string, number> = {};
  for (const p of i.positions) {
    const w = weights.find((x) => x.symbol === p.symbol)!.weightPct;
    const c = countryOf(p, i.profiles[p.symbol] ?? null);
    byCountry[c] = round2((byCountry[c] ?? 0) + w);
    const ind = i.profiles[p.symbol]?.industry ?? "desconocida";
    byIndustry[ind] = round2((byIndustry[ind] ?? 0) + w);
  }
  // Sector y tema (etiquetas): una acción aporta todo su peso a cada uno de sus temas.
  const bySector: Record<string, number> = {};
  const byTheme: Record<string, number> = {};
  if (i.tags) {
    for (const p of i.positions) {
      const tg = i.tags[p.symbol];
      if (!tg) continue;
      const w = weights.find((x) => x.symbol === p.symbol)!.weightPct;
      bySector[tg.sector] = round2((bySector[tg.sector] ?? 0) + w);
      for (const th of tg.themes) byTheme[th] = round2((byTheme[th] ?? 0) + w);
    }
  }
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(byCountry)) if (v > 40) warnings.push(`País ${k}: ${v}% de la cartera (> 40%)`);
  for (const [k, v] of Object.entries(byIndustry)) if (v > 40 && k !== "desconocida") warnings.push(`Industria ${k}: ${v}% de la cartera (> 40%)`);
  for (const [k, v] of Object.entries(bySector)) if (v > 40 && k !== "Otros") warnings.push(`Sector ${k}: ${v}% de la cartera (> 40%)`);
  for (const [k, v] of Object.entries(byTheme)) if (v > 40) warnings.push(`Tema ${k}: ${v}% de la cartera (> 40%)`);

  const rets: Record<string, number[]> = {};
  for (const p of i.positions) rets[p.symbol] = dailyReturns((i.candles[p.symbol] ?? []).slice(-127));
  const spyRets = dailyReturns(i.spy.slice(-127));

  const correlatedPairs: RiskReport["correlatedPairs"] = [];
  const syms = i.positions.map((p) => p.symbol);
  for (let a = 0; a < syms.length; a++) {
    for (let b = a + 1; b < syms.length; b++) {
      const c = correlation(rets[syms[a]!]!, rets[syms[b]!]!);
      if (c !== null && c > 0.7) correlatedPairs.push({ a: syms[a]!, b: syms[b]!, corr: c });
    }
  }

  const betas: Record<string, number | null> = {};
  for (const s of syms) betas[s] = beta(rets[s]!.slice(-63), spyRets.slice(-63));
  const withBeta = weights.filter((w) => betas[w.symbol] !== null);
  const portfolioBeta = withBeta.length ? round4(withBeta.reduce((s, w) => s + (w.weightPct / 100) * betas[w.symbol]!, 0)) : null;
  const stressSpyMinus20Pct = portfolioBeta === null ? null : round2(withBeta.reduce((s, w) => s + (w.weightPct / 100) * betas[w.symbol]! * -20, 0));
  if (withBeta.length < weights.length) notes.push("Estrés calculado solo sobre posiciones con beta (faltan velas en el resto).");

  const liquidity = i.positions.map((p) => {
    const last30 = (i.candles[p.symbol] ?? []).slice(-30);
    if (!last30.length) return { symbol: p.symbol, avgDollarVolume30d: null, daysToLiquidate: null };
    const avgShares = last30.reduce((s, c) => s + c.volume, 0) / last30.length;
    const avgDollar = round2(last30.reduce((s, c) => s + c.volume * c.close, 0) / last30.length);
    return { symbol: p.symbol, avgDollarVolume30d: avgDollar, daysToLiquidate: avgShares > 0 ? round4(p.quantity / (avgShares * 0.1)) : null };
  });

  return { totalValue, weights, concentration: { byCountry, byIndustry, bySector, byTheme, hhiCountry: hhi(byCountry), hhiIndustry: hhi(byIndustry), warnings }, correlatedPairs, betas, portfolioBeta, stressSpyMinus20Pct, liquidity, notes };
}
