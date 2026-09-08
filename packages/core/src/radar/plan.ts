import type { AssetClass, EtfConfig, EtfRole, RadarPolicy } from "./types.js";

/**
 * Plan del aporte (spec etapa 2 §8, v2 2026-09-08). Puro. Con el aporte del mes o con un monto dado:
 * 1) mientras el núcleo esté bajo su objetivo, `coreSharePctWhileBelowTarget` del monto va al núcleo (no todo);
 * 2) SUMAR de Cartera hasta `sumarSharePctOfRest` de lo que queda;
 * 3) nuevas: acciones COMPRAR por prioridad (convicción), una de seguimiento y un ETF satélite como máximo,
 *    repartidas parejo, respetando el máximo de posiciones nuevas (acciones + ETFs; el seguimiento es elección tuya);
 * 4) sobrante al núcleo. Ninguna línea supera `maxLinePctOfContribution` del monto ni el tope por posición.
 */
export interface PlanInput {
  month: string;
  portfolioValueUsd: number;
  positions: Array<{ symbol: string; valueUsd: number; assetClass: AssetClass; role?: EtfRole }>;
  sumarCandidates: Array<{ symbol: string; valueUsd: number; weightPct: number; stop?: number | null; target?: number | null }>;
  buyCandidates: Array<{ symbol: string; kind: "stock" | "etf" | "watch"; priority: number | null; score: number | null; sizeUsd: number | null; close: number; entryHigh?: number | null; stop?: number | null; target?: number | null }>;
  coreEtfs: EtfConfig[];
  spyClose: number | null;
  closes: Record<string, number>;
}
export interface PlanLine {
  symbol: string;
  kind: "nucleo" | "sumar" | "comprar" | "seguimiento";
  amountUsd: number;
  rationale: string;
  close: number | null;
  spyClose: number | null;
  alpha30dPct: number | null;
  alpha90dPct: number | null;
  /** Ticket para ejecutar (solo comprar/seguimiento): hasta dónde pagar, stop y objetivo del día del plan. */
  entryHigh?: number | null;
  stop?: number | null;
  target?: number | null;
  /** Solo núcleo: cuánto rindió el ETF en los últimos 12 meses. Contexto, no objetivo ni promesa. */
  ret12mPct?: number | null;
}
export interface PlanOptions {
  /** Monto a repartir en vez del aporte mensual (plata líquida de una vez). */
  amountUsd?: number;
}
const DEFAULTS = { coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
export interface ContributionPlan {
  month: string;
  totalUsd: number;
  lines: PlanLine[];
  notes: string[];
  /** Todo COMPRAR que no entró, con su lugar y motivo: el plan se explica solo. */
  leftOut?: Array<{ symbol: string; reason: string }>;
}

const MIN_LINE_USD = 100;

export function planContribution(i: PlanInput, c: RadarPolicy["contribution"], o: PlanOptions = {}): ContributionPlan {
  const cfg = { ...DEFAULTS, coreSharePctWhileBelowTarget: c.coreSharePctWhileBelowTarget ?? DEFAULTS.coreSharePctWhileBelowTarget, sumarSharePctOfRest: c.sumarSharePctOfRest ?? DEFAULTS.sumarSharePctOfRest, watchLinesMax: c.watchLinesMax ?? DEFAULTS.watchLinesMax, etfLinesMax: c.etfLinesMax ?? DEFAULTS.etfLinesMax };
  const aporte = Math.round(o.amountUsd ?? c.monthlyUsd);
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

  // 1. Núcleo: mientras esté bajo el objetivo, una parte fija del monto (el resto sigue bajando a lo demás).
  const coreValue = i.positions.filter(isCore).reduce((s, p) => s + p.valueUsd, 0);
  const coreTarget = (c.coreTargetPct / 100) * total;
  const gap = Math.max(0, coreTarget - coreValue);
  if (gap > 0) {
    const toCore = Math.min(Math.round(gap), Math.round((cfg.coreSharePctWhileBelowTarget / 100) * aporte), remaining);
    if (i.coreEtfs.some((e) => e.role === "nucleo")) allocateCore(toCore, `núcleo al ${Math.round((coreValue / total) * 100)}% de la cartera, objetivo ${c.coreTargetPct}%: ${cfg.coreSharePctWhileBelowTarget}% del monto`);
    else notes.push(`Sin núcleo definido en config/etfs.json: faltan USD ${Math.round(gap)} para el objetivo del ${c.coreTargetPct}%.`);
  }

  // 2. SUMAR de Cartera (subponderadas primero), hasta una parte de lo que queda.
  const satellites = i.positions.filter((p) => !isCore(p));
  const equalTarget = satellites.length ? (total * (1 - c.coreTargetPct / 100)) / satellites.length : 0;
  let sumarPool = Math.round((cfg.sumarSharePctOfRest / 100) * remaining);
  for (const s of [...i.sumarCandidates].sort((a, b) => a.weightPct - b.weightPct)) {
    if (remaining < MIN_LINE_USD || sumarPool < MIN_LINE_USD) break;
    const amt = Math.floor(Math.min(remaining, sumarPool, maxLine, Math.max(0, equalTarget - s.valueUsd), capFor(s.symbol)));
    if (amt < MIN_LINE_USD) continue;
    lines.push({ ...line(s.symbol, "sumar", amt, `subponderada (${s.weightPct}% vs ${Math.round((equalTarget / total) * 100)}% igualitario)`), stop: s.stop ?? null, target: s.target ?? null });
    remaining -= amt;
    sumarPool -= amt;
  }

  // 3. Nuevas: acciones por prioridad (convicción), una de seguimiento, un ETF satélite. Repartidas parejo.
  const byPriority = (a: PlanInput["buyCandidates"][number], b: PlanInput["buyCandidates"][number]) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity) || (b.score ?? -Infinity) - (a.score ?? -Infinity);
  // Un monto grande (3 aportes o más de una vez) admite una posición nueva extra: repartir 40k en 2 acciones es concentrar.
  const maxNew = c.maxNewPositionsPerMonth + (aporte >= 3 * c.monthlyUsd ? 1 : 0);
  const pools: Array<{ kind: "stock" | "watch" | "etf"; max: number; countsAsNew: boolean }> = [
    { kind: "stock", max: maxNew, countsAsNew: true },
    { kind: "watch", max: cfg.watchLinesMax, countsAsNew: false },
    { kind: "etf", max: cfg.etfLinesMax, countsAsNew: true },
  ];
  const chosen: PlanInput["buyCandidates"] = [];
  /** Todo COMPRAR que no entró, con su lugar en la fila y el motivo: el plan tiene que poder explicarse solo. */
  const leftOut: Array<{ symbol: string; reason: string }> = [];
  const POOL_LABEL: Record<"stock" | "watch" | "etf", string> = { stock: "posiciones nuevas", watch: "de seguimiento", etf: "ETF satélite" };
  let newCount = 0;
  for (const pool of pools) {
    let taken = 0;
    const queue = i.buyCandidates.filter((x) => x.kind === pool.kind).sort(byPriority);
    queue.forEach((b, idx) => {
      const place = pool.kind === "stock" ? `${idx + 1}° por convicción` : pool.kind === "watch" ? "seguimiento" : "ETF";
      const isNew = valueOf(b.symbol) === 0;
      if (taken >= pool.max) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: tope de ${pool.max} ${POOL_LABEL[pool.kind]}` });
        return;
      }
      if (pool.countsAsNew && isNew && newCount >= maxNew) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: tope de ${maxNew} posiciones nuevas` });
        return;
      }
      chosen.push(b);
      taken++;
      if (pool.countsAsNew && isNew) newCount++;
    });
  }
  if (chosen.length && remaining >= MIN_LINE_USD) {
    const per = Math.floor(remaining / chosen.length);
    let used = 0;
    chosen.forEach((b, idx) => {
      const share = idx === chosen.length - 1 ? remaining - used : per;
      const amt = Math.floor(Math.min(share, maxLine, b.sizeUsd ?? share, capFor(b.symbol)));
      if (amt < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `quedaría con menos de USD ${MIN_LINE_USD} (tope por posición o monto chico)` });
        return;
      }
      const kind: PlanLine["kind"] = b.kind === "watch" ? "seguimiento" : "comprar";
      const why = b.kind === "watch" ? `tu lista de seguimiento, COMPRAR hoy${b.score !== null ? `, score ${b.score}` : ""}` : b.kind === "etf" ? "ETF satélite con fuerza relativa positiva" : `candidato del Radar, convicción ${b.priority ?? "—"}${b.score !== null ? `, score ${b.score}` : ""}`;
      lines.push({ ...line(b.symbol, kind, amt, why), entryHigh: b.entryHigh ?? null, stop: b.stop ?? null, target: b.target ?? null });
      used += amt;
    });
    remaining -= used;
  }
  if (leftOut.length) {
    const shown = leftOut.slice(0, 5).map((x) => `${x.symbol} (${x.reason})`);
    notes.push(`No entraron esta vez: ${shown.join(" · ")}${leftOut.length > 5 ? ` y ${leftOut.length - 5} más (ver detalle)` : ""}.`);
  }
  if (!i.sumarCandidates.length && !i.buyCandidates.length) notes.push("Sin candidatos este mes: el aporte va al núcleo.");

  // 4. Sobrante al núcleo.
  if (remaining >= 1) {
    const ok = allocateCore(remaining, "sobrante del aporte");
    if (!ok) notes.push(`Sin núcleo definido: quedan USD ${remaining} sin asignar.`);
  }
  return { month: i.month, totalUsd: aporte, lines, notes, leftOut };
}
