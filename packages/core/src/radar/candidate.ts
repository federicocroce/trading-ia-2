import { atr, computeTarget, computeTrailingStop, entryStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { UNRELIABLE_GROWTH_INDUSTRY, unreliableGrowthKeys, type Fundamentals } from "./ranking.js";
import { bajoOfertaDeCompra } from "./oferta.js";
import { entryTiming, type EntryTiming } from "./entry.js";
import { earningsQualityFlags, hasExtraordinary } from "./statements.js";
import { crossesSplit } from "./split.js";
import type { AnalystTargets, CandidateEvent, CoreEarnings, RadarPolicy, VerificationSummary } from "./types.js";

/** Reglas de candidato (spec etapa 2 §6): lo técnico filtra, no rankea. Puro. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;
/** Un evento grave solo pesa en el veredicto dentro de esta ventana; antes, ya pasó. */
const EVENT_WINDOW_DAYS = 90;
/** Salvedades de calidad de la ganancia, de litigio, de la verificación web y de precio que, juntas, pasan un COMPRAR a OBSERVAR. */
export const QUALITY_FLAGS = new Set(["resultado_extraordinario", "interes_minoritario", "cobranza_lenta", "ganancia_sin_ventas", "evento_moderado", "verificacion_reservas", "consenso_en_precio", "subio_mucho_12m"]);
export const QUALITY_OBSERVE_AT = 2;
/**
 * Salvedades de precio (pieza 3). `consenso_en_precio` exige las dos cosas: objetivo de consenso a menos de 10% del precio
 * Y una subida de 12 meses mayor a 25% (el mercado ya pagó la historia: GLW +133% con consenso a +4%). Una acción barata
 * con objetivo cercano (LNC a 5x, +8%) no es "en el precio". `subio_mucho_12m`: subida mayor a 100% en 12 meses.
 */
export const PRICE_THRESHOLDS = { consensusMinUpsidePct: 10, consensusRunupPct: 25, runup12mPct: 100 };

/**
 * Banda de escala del consenso. Fuera de esto el número no es una opinión audaz: es un precio de otra serie,
 * casi siempre un split que la fuente no ajustó. APH el 10/9 tenía la mediana en 196 con la acción en 80,25
 * tras un 2:1, y eso daba un potencial de +144% que no existía.
 *
 * Deliberadamente NO se descartan los objetivos al guardarlos. Probé esa versión y descartaba objetivos
 * legítimos: ZVRA es un biotech caído a 12,57 con objetivos de 20 a 24, que son creíbles y se perdían.
 * Acá solo se niega a producir un potencial con un número que no está en escala; el dato queda guardado
 * y el chequeo de consistencia lo reporta como `objetivo_fuera_de_escala` para que se mire a mano.
 */
export const CONSENSUS_SCALE = { maxRatio: 2, minRatio: 0.5 };

/**
 * Objetivo de consenso: mediana de objetivos de titulares (2 o más) o, si no hay, el que trajo la verificación
 * web. null si no hay o si no está en escala contra el precio (split sin ajustar, ver `CONSENSUS_SCALE`).
 */
export function consensusTargetOf(close: number, analystTargets: AnalystTargets | null | undefined, consensusTarget: number | null | undefined): number | null {
  if (!(close > 0)) return null;
  const enEscala = (x: number | null | undefined) => x !== null && x !== undefined && x / close <= CONSENSUS_SCALE.maxRatio && x / close >= CONSENSUS_SCALE.minRatio;
  const titulares = analystTargets && analystTargets.n >= 2 ? analystTargets.median : null;
  // Si la mediana de titulares es de otra escala (APH el 13/9: 196 de antes del split, con la acción en 83,92),
  // vale el consenso de la verificación web, que sí está ajustado (100,6).
  if (enEscala(titulares)) return titulares;
  return enEscala(consensusTarget) ? consensusTarget! : null;
}

/** `consenso_en_precio`: potencial del consenso contra el cierre, en %. */
export function consensusUpsidePct(close: number, analystTargets: AnalystTargets | null | undefined, consensusTarget: number | null | undefined): number | null {
  const median = consensusTargetOf(close, analystTargets, consensusTarget);
  return median === null ? null : round2((median / close - 1) * 100);
}

/**
 * Bandera de la verificación web. `undefined` = no hay verificador; `null` = hay pero todavía no respondió (pendiente).
 * Una apta hecha con otro cuestionario que el vigente (`currentVersion`) es `verificacion_anterior` (15/9): se pintaba
 * en verde como "apta" y el plan igual no la compraba, porque hay que repetirla.
 */
export function verificationFlag(v: VerificationSummary | null | undefined, currentVersion?: string): string | null {
  if (v === undefined) return null;
  if (v === null) return "verificacion_pendiente";
  if (v.verdict === "apto") return currentVersion && v.promptVersion && v.promptVersion !== currentVersion ? "verificacion_anterior" : "verificacion_apta";
  return v.verdict === "con_reservas" ? "verificacion_reservas" : "verificacion_evitar";
}

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
/**
 * Retorno TOTAL contra `n` velas atrás, con dividendos (usa `adjClose`; sin él cae a `close` y avisa con `partial`).
 * Es lo único con lo que se puede comparar instrumentos que rinden por cupón contra los que rinden por precio:
 * SGOV en precio da 0,0% a 12 meses y en retorno total da ~3,4%, contra 17,7% de VTI.
 */
export function totalReturnPct(candles: Candle[], n: number): { pct: number; partial: boolean } | null {
  if (candles.length < n + 1) return null;
  const last = candles[candles.length - 1]!;
  const prev = candles[candles.length - 1 - n]!;
  const a = last.adjClose ?? null;
  const b = prev.adjClose ?? null;
  if (a !== null && b !== null && b > 0) return { pct: round2((a / b - 1) * 100), partial: false };
  return prev.close > 0 ? { pct: round2((last.close / prev.close - 1) * 100), partial: true } : null;
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
  // Split sin ajustar dentro de la ventana de la media de 200: la media mezcla dos escalas de precio, el
  // stop se calcula contra máximos de la escala vieja y el retorno de 21 ruedas puede ser un −90% que nunca
  // pasó. MIRG.BA el 12/9 traía 16.350 → 1.640 el 3 de agosto y la fila se mostraba como cualquier otra.
  // No se adivina el ajuste: se deja de calcular encima y se dice por qué.
  const salto = crossesSplit(candles, 200);
  if (salto !== null) return { status: "excluido", reasons: [`serie_con_salto:${salto.date}`], close, sma200: s200, return21dPct: r21, atrPct: a };
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
export function riskScore(i: { beta: number | null; atrPct: number | null; debtToEquity: number | null; dollarVolumeUsd: number; mcapUsd: number | null }): number {
  let r = 1;
  if (i.beta !== null) r += i.beta > 1.5 ? 2 : i.beta > 1.2 ? 1 : 0;
  if (i.atrPct !== null) r += i.atrPct > 4 ? 2 : i.atrPct > 2.5 ? 1 : 0;
  if (i.debtToEquity !== null) r += i.debtToEquity > 1.5 ? 2 : i.debtToEquity > 0.8 ? 1 : 0;
  r += i.dollarVolumeUsd < 10e6 ? 2 : i.dollarVolumeUsd < 25e6 ? 1 : 0;
  r += i.mcapUsd === null || i.mcapUsd < 2e9 ? 2 : i.mcapUsd < 10e9 ? 1 : 0;
  return Math.min(10, r);
}

/**
 * Rendimiento por dividendo: lo que la empresa PAGÓ en los últimos doce meses sobre el precio que la app tiene.
 *
 * No se usa `dividendYieldIndicatedAnnual`. Ese campo del proveedor no dice lo que parece: el 16/9/2026 daba 3,44%
 * para MCY, que paga 0,3175 por trimestre (1,27 al año sobre 101,93 = 1,25%), y 1,83% para HCI, que paga 1,60 (0,85%).
 * Sobre las 1.335 empresas con los dos datos, 148 recibían la bandera verde sin llegar al 2% real y 92 la merecían sin
 * tenerla; la relación entre los dos campos no es constante, así que no hay factor que lo corrija.
 *
 * Sin el dividendo pagado devuelve null: no se afirma que paga lo que no se puede comprobar.
 */
export function dividendYieldPct(f: Pick<Fundamentals, "metrics" | "priceUsd">): number | null {
  const dps = f.metrics["dividendPerShareTTM"];
  if (typeof dps !== "number" || !Number.isFinite(dps) || dps <= 0) return null;
  if (!Number.isFinite(f.priceUsd) || f.priceUsd <= 0) return null;
  return (dps / f.priceUsd) * 100;
}

export function buildFlags(
  f: Fundamentals,
  gate: TechnicalGate,
  nthAppearance: number,
  chronicWeeks: number,
  extra: { core?: CoreEarnings | null; events?: CandidateEvent[]; eventsUnclassified?: boolean; today?: string; verification?: VerificationSummary | null; verificationVersion?: string; filings?: readonly string[] } = {},
): string[] {
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
  const dy = dividendYieldPct(f);
  if (dy !== null && dy > 2) flags.push(`dividendo:${round2(dy)}`);
  flags.push(...gate.reasons);
  if (nthAppearance >= chronicWeeks) flags.push("residente_cronico");
  if (extra.core === null) flags.push("sin_estados");
  // En bancos el ranking ya no usa el crecimiento de ingresos de Finnhub (NBN +124% contra +4% real, 13/9): la fila lo dice.
  if (unreliableGrowthKeys(f).length) flags.push("crecimiento_no_confiable");
  // Un banco sin estados legibles no se puede verificar (14/9): los estados de la SEC no traen "resultado operativo" en
  // bancos, Finnhub infla sus ingresos, y la verificación web dio "apta" a NBN sin ver sus créditos fiscales comprados, sus
  // reservas liberadas ni su inmobiliario comercial al 485% del capital. El plan no lo compra (ver `PLAN_BLOCKERS`).
  if (extra.core === null && f.industry && UNRELIABLE_GROWTH_INDUSTRY.test(f.industry)) flags.push("banco_sin_estados");
  if (hasExtraordinary(extra.core)) flags.push("resultado_extraordinario");
  flags.push(...earningsQualityFlags(extra.core));
  const since = extra.today ? Date.parse(extra.today) - EVENT_WINDOW_DAYS * DAY : Number.NEGATIVE_INFINITY;
  const recent = (extra.events ?? []).filter((e) => Date.parse(e.date) >= since);
  if (recent.some((e) => e.severity === "grave")) flags.push("evento_grave");
  else if (recent.some((e) => e.severity === "moderado")) flags.push("evento_moderado");
  if (extra.eventsUnclassified) flags.push("eventos_sin_clasificar");
  const vf = verificationFlag(extra.verification, extra.verificationVersion);
  if (vf) flags.push(vf);
  // AES (16/9): COMPRAR con objetivo 15,93 contra una fusión en efectivo a 15,00 ya votada. El retorno está topado
  // por contrato y las señales del Radar apuntan todas al lado equivocado. Lo prueba el formulario, no el titular.
  const oferta = bajoOfertaDeCompra(extra.filings ?? []);
  if (oferta) flags.push("bajo_oferta_de_compra");
  return flags;
}

export interface CandidateDecision {
  verdict: "COMPRAR" | "OBSERVAR";
  flags: string[];
  /**
   * Último cierre. Está acá porque antes `entryLow` era siempre el cierre y quien guardaba la fila lo usaba
   * como tal; desde que la franja de compra depende del momento de entrada, `entryLow` puede quedar arriba
   * o abajo del cierre y confundir los dos números escribe un precio falso en la base.
   */
  close: number;
  /** Cuándo entrar: estado, nivel y condición. null si no hay velas suficientes. */
  entry: EntryTiming | null;
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
  i: {
    f: Fundamentals;
    candles: Candle[];
    nthAppearance: number;
    portfolioUsd: number | null;
    today: string;
    core?: CoreEarnings | null;
    events?: CandidateEvent[];
    eventsUnclassified?: boolean;
    /** Verificación web: `undefined` sin verificador, `null` pendiente. */
    verification?: VerificationSummary | null;
    /** Versión vigente del cuestionario: una apta con otra versión se marca como anterior. */
    verificationVersion?: string;
    /** Objetivos de analistas de titulares (90 días), para la salvedad "consenso en el precio". */
    analystTargets?: AnalystTargets | null;
    /** Ya está en cartera: el stop es el de la posición (el de seguimiento), porque una posición tiene un solo stop. */
    held?: boolean;
    /** Títulos de filings recientes de la SEC: de ahí sale si la empresa está bajo una oferta de compra (AES, 16/9). */
    filings?: readonly string[];
  },
  p: Pick<RadarPolicy, "technical" | "sizing" | "candidates">,
): CandidateDecision | { excluded: true; reasons: string[] } {
  const gate = technicalGate(i.candles, p.technical, i.f.nextEarnings, i.today);
  if (gate.status === "excluido") return { excluded: true, reasons: gate.reasons };
  const flags = buildFlags(i.f, gate, i.nthAppearance, p.candidates.chronicWeeks, {
    ...(i.core !== undefined ? { core: i.core } : {}),
    ...(i.events !== undefined ? { events: i.events } : {}),
    ...(i.eventsUnclassified !== undefined ? { eventsUnclassified: i.eventsUnclassified } : {}),
    ...(i.verification !== undefined ? { verification: i.verification } : {}),
    ...(i.verificationVersion !== undefined ? { verificationVersion: i.verificationVersion } : {}),
    ...(i.filings !== undefined ? { filings: i.filings } : {}),
    today: i.today,
  });
  // Salvedades de precio (pieza 3): objetivo de consenso pegado al precio tras una subida, o subida de 12 meses que ya descuenta mucho.
  const upside = consensusUpsidePct(gate.close, i.analystTargets, i.verification?.consensusTarget);
  const r12 = returnPct(i.candles, 252);
  if (upside !== null && upside < PRICE_THRESHOLDS.consensusMinUpsidePct && r12 !== null && r12 > PRICE_THRESHOLDS.consensusRunupPct) flags.push("consenso_en_precio");
  if (r12 !== null && r12 > PRICE_THRESHOLDS.runup12mPct) flags.push("subio_mucho_12m");
  // La verificación web que dice "evitar" observa por sí sola, como un evento grave. Y una empresa bajo oferta de
  // compra también (17/9): una fila que dice COMPRAR se compra, y un precio fijado por contrato no es una compra.
  const reasons = [...gate.reasons, ...(flags.includes("residente_cronico") ? ["residente_cronico"] : []), ...(flags.includes("evento_grave") ? ["evento_grave"] : []), ...(flags.includes("verificacion_evitar") ? ["verificacion_evitar"] : []), ...(flags.includes("bajo_oferta_de_compra") ? ["bajo_oferta_de_compra"] : [])];
  // Dos o más salvedades de calidad o litigio: cada una sola es una advertencia, juntas son un motivo para observar
  // (enmienda 2026-09-10: NUTX tenía demanda, ingresos cayendo con ganancia subiendo y socios minoritarios, y seguía COMPRAR).
  if (flags.filter((x) => QUALITY_FLAGS.has(x)).length >= QUALITY_OBSERVE_AT) {
    reasons.push("salvedades_de_calidad");
    // También como bandera: la fila guardada solo lleva banderas, y la ficha tiene que decir por qué observa.
    flags.push("salvedades_de_calidad");
  }
  const close = gate.close;
  // Momento de entrada: la franja de compra deja de ser "el cierre + 2%" y sale del estado técnico.
  // Si hay que esperar un retroceso el techo queda por debajo del cierre de hoy, que es justo el punto.
  const entry = entryTiming(i.candles);
  const entryLow = entry ? entry.low : close;
  const entryHigh = entry ? entry.high : round2(close * 1.02);
  // El stop de seguimiento es el FILTRO: decide si la tendencia sigue en pie (`bajo_stop`, `stop_dentro_de_la_entrada`).
  const trailing = computeTrailingStop(i.candles);
  // Cierre bajo el stop dinámico: viene cayendo desde un máximo reciente. Para un candidato nuevo
  // no es una compra: se observa hasta que el stop vuelva a quedar por debajo del precio.
  const belowStop = trailing !== null && close <= trailing;
  if (belowStop) {
    flags.push("bajo_stop");
    reasons.push("bajo_stop");
  }
  /*
   * El objetivo y el tamaño se calculan sobre el precio que se va a PAGAR, no sobre el cierre de hoy.
   * Mientras el objetivo salía del cierre y la entrada de otro lado, una misma fila mezclaba dos precios:
   * CLS decía "esperar a 311,90" y al lado "stop −10,6% / objetivo +21,2% (2 a 1)", porcentajes medidos
   * desde 346,55. Desde el precio real de entrada la relación era 52 a 1, y en ALL, MNPR, CARE y GOOGL el
   * objetivo quedaba POR DEBAJO del precio de entrada: la operación nacía perdida.
   *
   * Y si el stop no queda por debajo de toda la franja de compra, el boleto no se puede ejecutar: comprando
   * en el piso ya estarías debajo del stop (PAM, FRO, TRMD, META, BE el 12/9). En ese caso no hay objetivo
   * ni tamaño, y queda dicho por qué.
   */
  const stopSirve = trailing !== null && trailing < entryLow;
  if (!belowStop && trailing !== null && !stopSirve) {
    flags.push("stop_dentro_de_la_entrada");
    reasons.push("stop_dentro_de_la_entrada");
  }
  const ejecutable = !belowStop && stopSirve;
  // El stop de la ORDEN, en cambio, es el de una compra nueva: con aire mínimo de 2,5 ATR (ver `entryStop`).
  // Si ya está en cartera manda el de la posición. Una fila que no se puede ejecutar muestra el de seguimiento.
  const stop = ejecutable && !i.held ? entryStop(i.candles, entryLow) : trailing;
  const target = ejecutable ? computeTarget(entryHigh, stop) : null;
  const size = ejecutable ? positionSize({ entryHigh, stop, portfolioUsd: i.portfolioUsd }, p.sizing) : null;
  const risk = riskScore({ beta: i.f.metrics["beta"] ?? null, atrPct: gate.atrPct, debtToEquity: i.f.metrics["totalDebt/totalEquityAnnual"] ?? null, dollarVolumeUsd: i.f.dollarVolumeUsd, mcapUsd: i.f.mcapUsd });
  return { verdict: reasons.length ? "OBSERVAR" : "COMPRAR", flags, close, entry, entryLow, entryHigh, stop, target, size: size ? { qty: size.qty, sizeUsd: size.sizeUsd } : null, riskScore: risk, reasons, gate };
}
