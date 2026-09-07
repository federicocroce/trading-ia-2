import type { AssetClass, EtfConfig, EtfRole, RadarPolicy } from "./types.js";

/**
 * Plan del aporte mensual (spec etapa 2 §8). Puro.
 * 1) núcleo hasta su objetivo; 2) SUMAR de Cartera; 3) COMPRAR del Radar por score; sobrante al núcleo.
 * Ninguna línea supera `maxLinePctOfContribution` del aporte ni el tope por posición.
 */
export interface PlanInput {
  month: string;
  portfolioValueUsd: number;
  positions: Array<{ symbol: string; valueUsd: number; assetClass: AssetClass; role?: EtfRole }>;
  sumarCandidates: Array<{ symbol: string; valueUsd: number; weightPct: number }>;
  buyCandidates: Array<{ symbol: string; kind: "stock" | "etf"; score: number | null; sizeUsd: number | null; close: number }>;
  coreEtfs: EtfConfig[];
  spyClose: number | null;
  closes: Record<string, number>;
}
export interface PlanLine {
  symbol: string;
  kind: "nucleo" | "sumar" | "comprar";
  amountUsd: number;
  rationale: string;
  close: number | null;
  spyClose: number | null;
  alpha30dPct: number | null;
  alpha90dPct: number | null;
}
export interface ContributionPlan {
  month: string;
  totalUsd: number;
  lines: PlanLine[];
  notes: string[];
}

const MIN_LINE_USD = 100;

export function planContribution(i: PlanInput, c: RadarPolicy["contribution"]): ContributionPlan {
  const aporte = c.monthlyUsd;
  const total = i.portfolioValueUsd + aporte;
  const notes: string[] = [];
  const lines: PlanLine[] = [];
  const line = (symbol: string, kind: PlanLine["kind"], amountUsd: number, rationale: string): PlanLine => ({ symbol, kind, amountUsd, rationale, close: i.closes[symbol] ?? null, spyClose: i.spyClose, alpha30dPct: null, alpha90dPct: null });
  const isCore = (p: PlanInput["positions"][number]) => p.role === "nucleo" || i.coreEtfs.some((e) => e.symbol === p.symbol);
  const valueOf = (symbol: string) => i.positions.find((p) => p.symbol === symbol)?.valueUsd ?? 0;
  const capFor = (symbol: string) => Math.max(0, (c.maxPositionPct / 100) * total - valueOf(symbol));
  const maxLine = Math.round((c.maxLinePctOfContribution / 100) * aporte);
  let remaining = aporte;

  /** Reparte `amount` entre los ETFs de núcleo por peso objetivo; el resto de redondeo va al último. */
  const allocateCore = (amount: number, rationale: string) => {
    const core = i.coreEtfs.filter((e) => e.role === "nucleo");
    if (!core.length || amount <= 0) return false;
    const wsum = core.reduce((s, e) => s + (e.coreWeight ?? 1), 0);
    let used = 0;
    core.forEach((e, idx) => {
      const amt = idx === core.length - 1 ? amount - used : Math.round((amount * (e.coreWeight ?? 1)) / wsum);
      used += amt;
      if (amt <= 0) return;
      const existing = lines.find((l) => l.symbol === e.symbol && l.kind === "nucleo");
      if (existing) existing.amountUsd += amt;
      else lines.push(line(e.symbol, "nucleo", amt, rationale));
    });
    remaining -= amount;
    return true;
  };

  // 1. Núcleo hasta su objetivo.
  const coreValue = i.positions.filter(isCore).reduce((s, p) => s + p.valueUsd, 0);
  const coreTarget = (c.coreTargetPct / 100) * total;
  const gap = Math.max(0, coreTarget - coreValue);
  if (gap > 0) {
    const toCore = Math.min(Math.round(gap), remaining);
    if (i.coreEtfs.some((e) => e.role === "nucleo")) allocateCore(toCore, `núcleo al ${Math.round((coreValue / total) * 100)}% de la cartera, objetivo ${c.coreTargetPct}%`);
    else notes.push(`Sin núcleo definido en config/etfs.json: faltan USD ${Math.round(gap)} para el objetivo del ${c.coreTargetPct}%.`);
  }

  // 2. SUMAR de Cartera (subponderadas primero).
  const satellites = i.positions.filter((p) => !isCore(p));
  const equalTarget = satellites.length ? (total * (1 - c.coreTargetPct / 100)) / satellites.length : 0;
  for (const s of [...i.sumarCandidates].sort((a, b) => a.weightPct - b.weightPct)) {
    if (remaining < MIN_LINE_USD) break;
    const amt = Math.floor(Math.min(remaining, maxLine, Math.max(0, equalTarget - s.valueUsd), capFor(s.symbol)));
    if (amt < MIN_LINE_USD) continue;
    lines.push(line(s.symbol, "sumar", amt, `subponderada (${s.weightPct}% vs ${Math.round((equalTarget / total) * 100)}% igualitario)`));
    remaining -= amt;
  }

  // 3. COMPRAR del Radar: acciones por score, después ETFs satélite.
  const buys = [...i.buyCandidates].sort((a, b) => (a.kind === b.kind ? (b.score ?? -Infinity) - (a.score ?? -Infinity) : a.kind === "stock" ? -1 : 1));
  let newCount = 0;
  const skippedNew: string[] = [];
  for (const b of buys) {
    if (remaining < MIN_LINE_USD) break;
    const isNew = valueOf(b.symbol) === 0;
    if (isNew && newCount >= c.maxNewPositionsPerMonth) {
      skippedNew.push(b.symbol);
      continue;
    }
    const amt = Math.floor(Math.min(remaining, maxLine, b.sizeUsd ?? remaining, capFor(b.symbol)));
    if (amt < MIN_LINE_USD) continue;
    lines.push(line(b.symbol, "comprar", amt, b.score !== null ? `candidato del Radar, score ${b.score}` : "ETF satélite con fuerza relativa positiva"));
    remaining -= amt;
    if (isNew) newCount++;
  }
  if (skippedNew.length) notes.push(`Máximo de posiciones nuevas por mes (${c.maxNewPositionsPerMonth}) alcanzado: ${skippedNew.join(", ")} quedan para el mes que viene.`);
  if (!i.sumarCandidates.length && !i.buyCandidates.length) notes.push("Sin candidatos este mes: el aporte va al núcleo.");

  // 4. Sobrante al núcleo.
  if (remaining >= 1) {
    const ok = allocateCore(remaining, "sobrante del aporte");
    if (!ok) notes.push(`Sin núcleo definido: quedan USD ${remaining} sin asignar.`);
  }
  return { month: i.month, totalUsd: aporte, lines, notes };
}
