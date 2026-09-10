import type { MacroRegime } from "./regime.js";
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
  /** `caution`: si el ETF del tema está en OBSERVAR (oro bajo la media de 200 con NEM subponderada), no se suma y la nota lo dice. */
  sumarCandidates: Array<{ symbol: string; valueUsd: number; weightPct: number; stop?: number | null; target?: number | null; caution?: string | null }>;
  /** `cautions`: salvedades ya escritas (p. ej. "se mueve como YPF que ya tenés") que van a la razón de la línea.
   *  `verification`: veredicto de la verificación web; "con_reservas" no entra como posición nueva y la nota dice por qué.
   *  `flags`: banderas del candidato; las de precio (`consenso_en_precio`, `subio_mucho_12m`) tampoco entran como nueva. */
  buyCandidates: Array<{ symbol: string; kind: "stock" | "etf" | "watch"; priority: number | null; score: number | null; sizeUsd: number | null; close: number; entryHigh?: number | null; stop?: number | null; target?: number | null; cautions?: string[]; verification?: { verdict: "apto" | "con_reservas" | "evitar"; reason: string } | null; flags?: string[] }>;
  /** Régimen macro (pieza 4): con régimen restrictivo una parte del aporte va a letras del Tesoro antes que nada. */
  regime?: MacroRegime | null;
  coreEtfs: EtfConfig[];
  spyClose: number | null;
  closes: Record<string, number>;
}
export interface PlanLine {
  symbol: string;
  kind: "reserva" | "nucleo" | "sumar" | "comprar" | "seguimiento";
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
  /** Prioridad con la que entró (convicción para acciones, −riesgo para seguimiento, FR 6m para ETFs). */
  priority?: number | null;
}
export interface PlanOptions {
  /** Monto a repartir en vez del aporte mensual (plata líquida de una vez). */
  amountUsd?: number;
}
const DEFAULTS = { coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
export const DEFAULT_RESERVE_SYMBOL = "SGOV";
/** Banderas de precio que dejan a un candidato fuera de las posiciones nuevas del plan (la convicción ya lo descuenta; acá se explica). */
export const PLAN_PRICE_BLOCKERS: Record<string, string> = {
  consenso_en_precio: "el objetivo de consenso está a menos de 10% del precio",
  subio_mucho_12m: "subió más de 100% en 12 meses",
};
/** Posiciones nuevas según el monto: el tope base más una por cada 3 aportes mensuales, hasta 5 (40k con 6.5k mensual → 4). */
export const maxNewPositions = (aporte: number, monthlyUsd: number, base: number) => Math.min(5, base + Math.floor(aporte / (3 * Math.max(1, monthlyUsd))));
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

  // 0. Reserva (pieza 4): con régimen restrictivo, una parte del aporte espera en letras del Tesoro antes de repartir el resto.
  if (i.regime && i.regime.reservePct > 0) {
    const amt = Math.round((i.regime.reservePct / 100) * aporte);
    if (amt >= MIN_LINE_USD) {
      lines.push(line(c.reserveSymbol ?? DEFAULT_RESERVE_SYMBOL, "reserva", amt, `régimen ${i.regime.state}: ${i.regime.why}. ${i.regime.reservePct}% del aporte en letras del Tesoro, para comprar en una corrección`));
      remaining -= amt;
    }
  }
  if (i.regime) notes.push(`Régimen macro al ${i.regime.asOf}: ${i.regime.state} (${i.regime.why}).`);

  // 1. Núcleo: mientras esté bajo el objetivo, una parte fija del monto (el resto sigue bajando a lo demás).
  const coreValue = i.positions.filter(isCore).reduce((s, p) => s + p.valueUsd, 0);
  const coreTarget = (c.coreTargetPct / 100) * total;
  const gap = Math.max(0, coreTarget - coreValue);
  if (gap > 0) {
    // Sobre lo que queda después de la reserva (sin reserva es el aporte entero).
    const toCore = Math.min(Math.round(gap), Math.round((cfg.coreSharePctWhileBelowTarget / 100) * remaining), remaining);
    if (i.coreEtfs.some((e) => e.role === "nucleo")) allocateCore(toCore, `núcleo al ${Math.round((coreValue / total) * 100)}% de la cartera, objetivo ${c.coreTargetPct}%: ${cfg.coreSharePctWhileBelowTarget}% del monto`);
    else notes.push(`Sin núcleo definido en config/etfs.json: faltan USD ${Math.round(gap)} para el objetivo del ${c.coreTargetPct}%.`);
  }

  // 2. SUMAR de Cartera (subponderadas primero), hasta una parte de lo que queda.
  const satellites = i.positions.filter((p) => !isCore(p));
  const equalTarget = satellites.length ? (total * (1 - c.coreTargetPct / 100)) / satellites.length : 0;
  let sumarPool = Math.round((cfg.sumarSharePctOfRest / 100) * remaining);
  for (const s of [...i.sumarCandidates].sort((a, b) => a.weightPct - b.weightPct)) {
    if (remaining < MIN_LINE_USD || sumarPool < MIN_LINE_USD) break;
    // Coherencia (pieza 3): subponderada, pero el ETF de su tema dice OBSERVAR: no se suma y se dice por qué.
    if (s.caution) {
      notes.push(`No se sumó ${s.symbol}: ${s.caution}.`);
      continue;
    }
    const amt = Math.floor(Math.min(remaining, sumarPool, maxLine, Math.max(0, equalTarget - s.valueUsd), capFor(s.symbol)));
    if (amt < MIN_LINE_USD) continue;
    lines.push({ ...line(s.symbol, "sumar", amt, `subponderada (${s.weightPct}% vs ${Math.round((equalTarget / total) * 100)}% igualitario)`), stop: s.stop ?? null, target: s.target ?? null });
    remaining -= amt;
    sumarPool -= amt;
  }

  // 3. Nuevas: acciones por prioridad (convicción), una de seguimiento, un ETF satélite. Repartidas por convicción (pieza 5).
  const byPriority = (a: PlanInput["buyCandidates"][number], b: PlanInput["buyCandidates"][number]) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity) || (b.score ?? -Infinity) - (a.score ?? -Infinity);
  // Un monto grande admite más posiciones nuevas: una extra por cada 3 aportes mensuales, hasta 5 (repartir 40k en 2 acciones es concentrar).
  const maxNew = maxNewPositions(aporte, c.monthlyUsd, c.maxNewPositionsPerMonth);
  const pools: Array<{ kind: "stock" | "watch" | "etf"; max: number; countsAsNew: boolean }> = [
    { kind: "stock", max: maxNew, countsAsNew: true },
    { kind: "watch", max: cfg.watchLinesMax, countsAsNew: false },
    { kind: "etf", max: cfg.etfLinesMax, countsAsNew: true },
  ];
  const chosen: PlanInput["buyCandidates"] = [];
  const placeOf = new Map<string, string>();
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
      // La verificación web con reservas no compra: queda en la fila con su motivo (evitar ya es OBSERVAR y no llega acá).
      if (b.verification && b.verification.verdict !== "apto") {
        leftOut.push({ symbol: b.symbol, reason: `${place}: verificación web ${b.verification.verdict === "evitar" ? "dice evitar" : "con reservas"}: ${b.verification.reason}` });
        return;
      }
      // Salvedades de precio (pieza 3): tampoco entra como nueva, con el motivo.
      const blocker = (b.flags ?? []).find((f) => PLAN_PRICE_BLOCKERS[f]);
      if (blocker) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${PLAN_PRICE_BLOCKERS[blocker]}` });
        return;
      }
      // Ya está en el tope por posición (PAM 10/9: 15,8% de la cartera): no ocupa un lugar que otro puede usar.
      if (capFor(b.symbol) < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ya está en el tope del ${c.maxPositionPct}% por posición` });
        return;
      }
      if (taken >= pool.max) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: tope de ${pool.max} ${POOL_LABEL[pool.kind]}` });
        return;
      }
      if (pool.countsAsNew && isNew && newCount >= maxNew) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: tope de ${maxNew} posiciones nuevas` });
        return;
      }
      chosen.push(b);
      if (pool.kind === "stock") placeOf.set(b.symbol, `${idx + 1}° por convicción de ${queue.length} COMPRAR del Radar`);
      taken++;
      if (pool.countsAsNew && isNew) newCount++;
    });
  }
  if (chosen.length && remaining >= MIN_LINE_USD) {
    // Reparto por convicción (pieza 5): cada acción pesa 1 + su convicción (más convicción, más plata, sin extremos: 1,5 contra 0,6
    // de convicción reparte 62/38, no 71/29); seguimiento y ETF pesan como el promedio de las acciones.
    const stockWeights = chosen.filter((b) => b.kind === "stock" && b.priority !== null).map((b) => 1 + Math.max(0, b.priority!));
    const avg = stockWeights.length ? stockWeights.reduce((s, x) => s + x, 0) / stockWeights.length : 1;
    const weightOf = (b: PlanInput["buyCandidates"][number]) => (b.kind === "stock" && b.priority !== null ? 1 + Math.max(0, b.priority) : avg);
    const wsum = chosen.reduce((s, b) => s + weightOf(b), 0);
    let used = 0;
    chosen.forEach((b, idx) => {
      const share = idx === chosen.length - 1 ? remaining - used : Math.floor((remaining * weightOf(b)) / wsum);
      const amt = Math.floor(Math.min(share, maxLine, b.sizeUsd ?? share, capFor(b.symbol)));
      if (amt < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `quedaría con menos de USD ${MIN_LINE_USD} (tope por posición o monto chico)` });
        return;
      }
      const kind: PlanLine["kind"] = b.kind === "watch" ? "seguimiento" : "comprar";
      const base = b.kind === "watch" ? `tu lista de seguimiento, COMPRAR hoy${b.score !== null ? `, score ${b.score}` : ""}` : b.kind === "etf" ? "ETF satélite con fuerza relativa positiva" : `${placeOf.get(b.symbol) ?? "candidato del Radar"}, convicción ${b.priority ?? "—"}${b.score !== null ? `, score ${b.score}` : ""}`;
      const why = b.cautions?.length ? `${base} · ⚠ ${b.cautions.join(" · ⚠ ")}` : base;
      lines.push({ ...line(b.symbol, kind, amt, why), entryHigh: b.entryHigh ?? null, stop: b.stop ?? null, target: b.target ?? null, priority: b.priority ?? null });
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
