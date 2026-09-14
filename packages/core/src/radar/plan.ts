import type { EntryTiming } from "./entry.js";
import { firstTrancheFrom } from "./fomc.js";
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
  /** `caution`: si el ETF del tema está en OBSERVAR (oro bajo la media de 200 con NEM subponderada), no se suma y la nota lo dice.
   *  `verification`: la del Radar si el símbolo está ahí. Un SUMAR es una compra: con reservas, evitar o con el cuestionario anterior no se suma. */
  sumarCandidates: Array<{ symbol: string; valueUsd: number; weightPct: number; stop?: number | null; target?: number | null; caution?: string | null; verification?: PlanVerification | null | undefined }>;
  /** `cautions`: salvedades ya escritas (p. ej. "se mueve como YPF que ya tenés") que van a la razón de la línea.
   *  `verification`: veredicto de la verificación web. Una acción entra solo apta y con el cuestionario vigente;
   *  `null` = pendiente (no entra); `undefined` = no hay verificador (no se exige).
   *  `flags`: banderas del candidato; las de precio (`consenso_en_precio`, `subio_mucho_12m`) tampoco entran como nueva. */
  buyCandidates: Array<{ symbol: string; kind: "stock" | "etf" | "watch"; priority: number | null; score: number | null; sizeUsd: number | null; close: number; entryHigh?: number | null; stop?: number | null; target?: number | null; cautions?: string[]; verification?: PlanVerification | null | undefined; flags?: string[]; entry?: PlanLine["entry"] }>;
  /** Régimen macro (pieza 4): con régimen restrictivo una parte del aporte va a letras del Tesoro antes que nada. */
  regime?: MacroRegime | null;
  /** Fecha del plan y decisiones de la Fed (`config/fomc.json`): con una dentro de 3 días hábiles, el primer tramo va después. */
  fomc?: { today: string; decisions: string[] } | null;
  coreEtfs: EtfConfig[];
  spyClose: number | null;
  closes: Record<string, number>;
}
/**
 * Dictamen de la verificación web tal como lo usa el plan. `current`: hecha con el cuestionario vigente. El 13/9
 * NBN estaba "apta" con un cuestionario que no preguntaba si la sorpresa sobrevivía sin extraordinarios; con el
 * nuevo, lo verificado antes vale como pendiente hasta repetirse. Sin el campo (llamadores viejos) cuenta como vigente.
 */
export interface PlanVerification {
  verdict: "apto" | "con_reservas" | "evitar";
  reason: string;
  current?: boolean;
}

/** Motivo por el que una verificación no deja comprar, o null si deja. `undefined` = no hay verificador: no se exige. */
export function verificationBlock(v: PlanVerification | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return "verificación web pendiente: no entra hasta que se verifique";
  if (v.verdict !== "apto") return `verificación web ${v.verdict === "evitar" ? "dice evitar" : "con reservas"}: ${v.reason}`;
  if (v.current === false) return "verificación hecha con el cuestionario anterior: se repite antes de comprarla";
  return null;
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
  /** Rendimiento TOTAL (con dividendos) de los últimos 12 meses. Contexto para comparar contra el núcleo, no una promesa. */
  ret12mPct?: number | null;
  /** true = se calculó sin dividendos (no había cierre ajustado): el número subestima lo que rindió. */
  ret12mPartial?: boolean | null;
  /** Prioridad con la que entró (convicción para acciones, −riesgo para seguimiento, FR 6m para ETFs). */
  priority?: number | null;
  /** Cuándo comprarla: ahora, o esperando un nivel. `entryHigh` es el techo de esa franja. */
  entry?: EntryTiming | null;
}
export interface PlanOptions {
  /** Monto a repartir en vez del aporte mensual (plata líquida de una vez). */
  amountUsd?: number;
}
const DEFAULTS = { coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
/** A partir de cuántos aportes mensuales el plan sugiere escalonar la compra. */
export const TRANCHE_AT_MONTHS = 3;
/**
 * Banderas que dejan a un candidato fuera de las posiciones nuevas del plan, con el motivo que se muestra. Las de precio
 * ya las descuenta la convicción; `banco_sin_estados` (14/9) es que la app no tiene cómo verificar su ganancia.
 */
export const PLAN_BLOCKERS: Record<string, string> = {
  consenso_en_precio: "el objetivo de consenso está a menos de 10% del precio",
  subio_mucho_12m: "subió más de 100% en 12 meses",
  banco_sin_estados: "banco sin estados de la SEC legibles: la app no puede verificar su ganancia (Finnhub infla los ingresos de los bancos y la verificación web no encontró sus extraordinarios ni su concentración inmobiliaria)",
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
  /** En cuántas compras conviene ejecutarlo (1 = de una vez). */
  tranches?: number;
  /**
   * Cuándo se armó este plan, en ISO. El plan es una FOTO: no se rehace solo cuando cambian los precios ni
   * cuando se arregla el motor, así que el encabezado tiene que decir de cuándo es. El 13/9 el dueño
   * preguntó "¿sigo viendo el mismo plan que antes?" y no había forma de contestarle desde la pantalla.
   * Lo pone la persistencia al leerlo; al construirlo va sin esto.
   */
  builtAt?: string;
}

/**
 * Invariante del plan (2026-09-11): toda línea o es núcleo, que se compra y se mantiene por calendario, o es una
 * tesis con salida, es decir con stop. Nada intermedio. Nació de haber metido una reserva en letras sin regla de
 * despliegue: plata que entraba todos los meses y no salía nunca, y que además rinde menos que el núcleo.
 */
export function lineHasExit(l: Pick<PlanLine, "kind" | "stop">): boolean {
  return l.kind === "nucleo" || (l.stop !== null && l.stop !== undefined);
}

const MIN_LINE_USD = 100;
/** "2026-09-16" → "16/9". */
const dm = (isoDate: string) => `${Number(isoDate.slice(8, 10))}/${Number(isoDate.slice(5, 7))}`;

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

  if (i.regime) notes.push(`Régimen macro al ${i.regime.asOf}: ${i.regime.state} (${i.regime.why}).`);
  // Escalonado: un monto grande entra en tramos para no comprar todo en un solo precio. No es plata en efectivo
  // esperando una corrección (eso es plata muerta), es el mismo plan ejecutado en dos o tres compras.
  const tranches = aporte >= TRANCHE_AT_MONTHS * c.monthlyUsd ? Math.min(3, Math.floor(aporte / (TRANCHE_AT_MONTHS * c.monthlyUsd)) + 1) : 1;
  if (tranches > 1) notes.push(`Monto de ${Math.round(aporte / c.monthlyUsd)} aportes: conviene ejecutarlo en ${tranches} tramos de USD ${Math.round(aporte / tranches)}, con dos o tres semanas entre cada uno. Mismas líneas y mismas proporciones en cada tramo.`);
  // Reunión de la Fed (13/9): con una decisión a 3 días hábiles o menos, se compra después del anuncio.
  const fed = i.fomc ? firstTrancheFrom(i.fomc.today, i.fomc.decisions) : null;
  if (fed) notes.push(`La Fed decide el ${dm(fed.decision)}: ${tranches > 1 ? "el primer tramo" : "la compra"} va desde el ${dm(fed.from)}, después del anuncio. Esperar hasta 3 días hábiles cuesta poco y evita comprar justo antes de una decisión que mueve todo el mercado.`);

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
    // Un SUMAR es una compra: la misma vara que una nueva (13/9). Pendiente en el Radar (null) no frena: lo decide Cartera.
    const bloqueo = s.verification ? verificationBlock(s.verification) : null;
    if (bloqueo) {
      notes.push(`No se sumó ${s.symbol}: ${bloqueo}. Su parte (USD ${amt}) va al núcleo.`);
      if (allocateCore(amt, `lo que iba a ${s.symbol}, que no pasó la verificación`)) sumarPool -= amt;
      continue;
    }
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
  const yaEnSumar = new Set(lines.filter((l) => l.kind === "sumar").map((l) => l.symbol));
  const chosen: PlanInput["buyCandidates"] = [];
  const placeOf = new Map<string, string>();
  /** Todo COMPRAR que no entró, con su lugar en la fila y el motivo: el plan tiene que poder explicarse solo. */
  const leftOut: Array<{ symbol: string; reason: string }> = [];
  const POOL_LABEL: Record<"stock" | "watch" | "etf", string> = { stock: "posiciones nuevas", watch: "de seguimiento", etf: "ETF satélite" };
  let newCount = 0;
  /** Lugares de acciones que quedaron vacíos porque la que los ocupaba no pasó la verificación y ninguna la reemplazó. */
  let vacantes = 0;
  /** Prioridad de cada acción que cayó por la verificación, en orden: el lugar vacío pesa lo que pesaba ella. */
  const caidas: Array<number | null> = [];
  for (const pool of pools) {
    let taken = 0;
    const queue = i.buyCandidates.filter((x) => x.kind === pool.kind).sort(byPriority);
    queue.forEach((b, idx) => {
      const place = pool.kind === "stock" ? `${idx + 1}° por convicción` : pool.kind === "watch" ? "seguimiento" : "ETF";
      const isNew = valueOf(b.symbol) === 0;
      // Un símbolo que ya recibió plata como SUMAR no puede recibirla otra vez como compra nueva: TSM el
      // 12/9 salía dos veces en el mismo plan, con dos montos, para una sola posición.
      if (yaEnSumar.has(b.symbol)) {
        // No va a `leftOut`: NO quedó afuera, ya está en el plan como SUMAR. Ponerlo en las dos listas era
        // otra contradicción, y el chequeo entre pantallas la cazó apenas se hizo este arreglo.
        notes.push(`${b.symbol} entró como SUMAR y no se duplica: el Radar también lo tiene en COMPRAR (${place}).`);
        return;
      }
      // Una acción entra solo verificada, apta y con el cuestionario vigente (13/9). Con reservas, pendiente o con el
      // cuestionario anterior queda en la fila con su motivo. Los ETFs no se verifican en la web.
      const bloqueo = pool.kind === "etf" ? null : verificationBlock(b.verification);
      if (bloqueo) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${bloqueo}` });
        if (pool.kind === "stock") caidas.push(b.priority);
        return;
      }
      // Salvedades de precio (pieza 3) y banco sin estados legibles (14/9): tampoco entra como nueva, con el motivo.
      const blocker = (b.flags ?? []).find((f) => PLAN_BLOCKERS[f]);
      if (blocker) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${PLAN_BLOCKERS[blocker]}` });
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
        leftOut.push({ symbol: b.symbol, reason: vacantes > 0 ? `${place}: el lugar libre era de una acción que no pasó la verificación, y esa parte va al núcleo` : `${place}: tope de ${maxNew} posiciones nuevas` });
        return;
      }
      chosen.push(b);
      if (pool.kind === "stock") placeOf.set(b.symbol, `${idx + 1}° por convicción de ${queue.length} COMPRAR del Radar`);
      taken++;
      if (pool.countsAsNew && isNew) newCount++;
    });
    // Un lugar que dejó una acción que no pasó la verificación, y que ninguna verificada llenó, no lo toma un ETF ni
    // se reparte entre las demás: cuenta como ocupado y su parte va al núcleo. "¿Qué me asegura que la siguiente esté
    // bien?", preguntó el dueño el 13/9: solo la misma verificación.
    if (pool.kind === "stock") {
      vacantes = Math.min(caidas.length, Math.max(0, pool.max - taken));
      newCount += vacantes;
    }
  }
  if (chosen.length && remaining >= MIN_LINE_USD) {
    // Reparto por convicción (pieza 5): cada acción pesa 1 + su convicción (más convicción, más plata, sin extremos: 1,5 contra 0,6
    // de convicción reparte 62/38, no 71/29); seguimiento y ETF pesan como el promedio de las acciones.
    const stockWeights = chosen.filter((b) => b.kind === "stock" && b.priority !== null).map((b) => 1 + Math.max(0, b.priority!));
    const avg = stockWeights.length ? stockWeights.reduce((s, x) => s + x, 0) / stockWeights.length : 1;
    const weightOf = (b: PlanInput["buyCandidates"][number]) => (b.kind === "stock" && b.priority !== null ? 1 + Math.max(0, b.priority) : avg);
    // Cada lugar vacío pesa lo que pesaba la acción que se fue (así las demás reciben lo mismo que con el lugar
    // lleno) y su parte queda sin repartir: va al núcleo en el paso 4.
    const pesoVacante = caidas.slice(0, vacantes).reduce<number>((s, pr) => s + (pr !== null ? 1 + Math.max(0, pr) : avg), 0);
    const wsum = chosen.reduce((s, b) => s + weightOf(b), 0) + pesoVacante;
    const vacanteUsd = vacantes > 0 ? Math.floor((remaining * pesoVacante) / wsum) : 0;
    if (vacantes > 0) notes.push(`${vacantes === 1 ? "Un lugar" : `${vacantes} lugares`} de posiciones nuevas ${vacantes === 1 ? "quedó vacío" : "quedaron vacíos"}: la acción que lo ocupaba no pasó la verificación y ninguna verificada la reemplazó. Esa parte (USD ${vacanteUsd}) va al núcleo; no se reparte entre las demás ni la toma un ETF.`);
    let used = 0;
    chosen.forEach((b, idx) => {
      const share = idx === chosen.length - 1 && vacantes === 0 ? remaining - used : Math.floor((remaining * weightOf(b)) / wsum);
      const amt = Math.floor(Math.min(share, maxLine, b.sizeUsd ?? share, capFor(b.symbol)));
      if (amt < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `quedaría con menos de USD ${MIN_LINE_USD} (tope por posición o monto chico)` });
        return;
      }
      const kind: PlanLine["kind"] = b.kind === "watch" ? "seguimiento" : "comprar";
      const base = b.kind === "watch" ? `tu lista de seguimiento, COMPRAR hoy${b.score !== null ? `, score ${b.score}` : ""}` : b.kind === "etf" ? "ETF satélite con fuerza relativa positiva" : `${placeOf.get(b.symbol) ?? "candidato del Radar"}, convicción ${b.priority ?? "—"}${b.score !== null ? `, score ${b.score}` : ""}`;
      const why = b.cautions?.length ? `${base} · ⚠ ${b.cautions.join(" · ⚠ ")}` : base;
      lines.push({ ...line(b.symbol, kind, amt, why), entryHigh: b.entryHigh ?? null, stop: b.stop ?? null, target: b.target ?? null, priority: b.priority ?? null, entry: b.entry ?? null });
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
  // Invariante: nada sin salida sale en el plan. Si alguna línea la viola, no se muestra y queda dicho por qué.
  const sinSalida = lines.filter((l) => !lineHasExit(l));
  for (const l of sinSalida) {
    leftOut.push({ symbol: l.symbol, reason: `sin salida definida (no es núcleo y no tiene stop): no entra` });
    notes.push(`Se sacó ${l.symbol} del plan: toda línea que no sea núcleo tiene que tener stop, o es plata que entra y no sale.`);
  }
  const finales = lines.filter(lineHasExit);
  // Cuánta de esta plata se puede ejecutar hoy. Una línea que dice "esperar" tiene asignado un monto que no se
  // gasta hoy: sin decirlo, el plan parece ejecutable entero y el que lo lee termina comprando a mercado igual.
  const esperando = finales.filter((l) => l.entry && (l.entry.state === "esperar_retroceso" || l.entry.state === "esperar_confirmacion"));
  if (esperando.length) {
    const enEspera = Math.round(esperando.reduce((s, l) => s + l.amountUsd, 0));
    const detalle = esperando.map((l) => `${l.symbol} ${l.entry!.state === "esperar_retroceso" ? "en" : "arriba de"} ${l.entry!.level}`).join(", ");
    notes.push(`Hoy se ejecutan USD ${Math.round(aporte) - enEspera} de USD ${Math.round(aporte)}. Los otros USD ${enEspera} van como orden limitada, no a mercado: ${detalle}. Vale ${esperando[0]!.entry!.validSessions} ruedas; si no se da, esa plata se reasigna en la próxima corrida.`);
  }
  return { month: i.month, totalUsd: aporte, lines: finales, notes, leftOut, tranches };
}
