import { computeTarget, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { atrPct, returnPct, sma, totalReturnPct } from "./candidate.js";
import { entryTiming, type EntryTiming } from "./entry.js";
import { crossesSplit } from "./split.js";
import type { EtfConfig, RadarPolicy } from "./types.js";

/** Motor de ETFs (spec etapa 2 §7): fuerza relativa contra SPY; el núcleo no se "timea". Puro. */
const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/**
 * (1 + r_etf) / (1 + r_spy) − 1, en %, sobre las últimas n velas, con RETORNO TOTAL cuando se puede.
 *
 * Por qué importa (13/9). Hasta hoy usaba solo el precio, y eso castiga sistemáticamente a lo que rinde por
 * cupón o por dividendo: SGOV en precio da 0,0% a doce meses y en retorno total da ~3,4%, así que aparecía
 * como si le perdiera al SPY por todo lo que el SPY subió, cuando en realidad rindió lo suyo. La fuerza
 * relativa es el ÚNICO criterio con el que se decide un ETF satélite, así que el sesgo no era cosmético.
 *
 * Pero no se puede mezclar: si una serie tiene `adjClose` y la otra no, comparar total contra precio es peor
 * que comparar precio contra precio. Por eso se exige que las DOS lo tengan, y si no, se cae a precio y se
 * devuelve `partial: true` para que la pantalla lo pueda decir. SGOV, cuyas velas vienen del respaldo de
 * Alpaca y no traen `adjClose`, cae en ese caso.
 */
export function relativeStrengthDetail(etf: Candle[], spy: Candle[], n: number): { pct: number; partial: boolean } | null {
  const te = totalReturnPct(etf, n);
  const ts = totalReturnPct(spy, n);
  if (te === null || ts === null) return null;
  const partial = te.partial || ts.partial;
  // Si alguna de las dos no tiene dividendos, las dos se miden por precio: comparar bases distintas miente.
  const re = partial ? returnPct(etf, n) : te.pct;
  const rs = partial ? returnPct(spy, n) : ts.pct;
  if (re === null || rs === null) return null;
  return { pct: round4(((1 + re / 100) / (1 + rs / 100) - 1) * 100), partial };
}

/** La misma fuerza relativa, sin el detalle de la base. */
export function relativeStrength(etf: Candle[], spy: Candle[], n: number): number | null {
  return relativeStrengthDetail(etf, spy, n)?.pct ?? null;
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
  /**
   * Cuándo entrar. Solo para satélites: un ETF temático extendido se paga caro igual que una acción.
   * El núcleo va en `null` a propósito, porque se compra por calendario y no se busca el momento.
   */
  entry: EntryTiming | null;
  /**
   * Límites de la fuente que hay que mostrar pero que NO deciden. `reasons` degrada a OBSERVAR; esto no.
   * La distinción importa: que una serie no traiga dividendos ya perjudica al ETF en el número, y
   * degradarlo además por eso sería castigarlo dos veces por algo que no es suyo.
   */
  limitations: string[];
}

export function decideEtf(cfg: EtfConfig, candles: Candle[], spy: Candle[], p: RadarPolicy["technical"]): EtfDecision | { excluded: true; reasons: string[] } {
  if (candles.length < 200) return { excluded: true, reasons: ["sin_historial"] };
  // Un ETF también se divide: el mismo salto de escala rompe la fuerza relativa y la media de 200.
  const salto = crossesSplit(candles, 252);
  if (salto !== null) return { excluded: true, reasons: [`serie_con_salto:${salto.date}`] };
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
    entry: null as EntryTiming | null,
    limitations: [] as string[],
  };
  // El núcleo no se vende por stop ni tiene objetivo: se compra por calendario y se mantiene.
  // Las banderas son NOMBRES estables, no frases: la pantalla las traduce y las pinta según su signo. Antes
  // acá viajaba "núcleo: se compra por calendario, sin timing", una oración que la UI no podía reconocer y
  // pintaba en ámbar con el mismo ⚑ que una salvedad. Que un ETF sea del núcleo no es una advertencia.
  if (cfg.role === "nucleo") return { ...base, stop: null, target: null, entry: null, verdict: "NUCLEO", reasons: ["nucleo_por_calendario"] };
  base.entry = entryTiming(candles);
  const reasons: string[] = [];
  // Si la serie no trae dividendos, la fuerza relativa mide solo precio y SUBESTIMA a lo que rinde por
  // cupón. Va como limitación y no como motivo, a propósito: un motivo degrada a OBSERVAR, y acá el sesgo
  // ya juega en contra del ETF, así que degradarlo sería castigarlo dos veces por un límite de la fuente.
  if (relativeStrengthDetail(candles, spy, 126)?.partial) base.limitations.push("fr_sin_dividendos");
  // El dato va detrás de los dos puntos, no dentro de una frase: así hay UNA bandera con un valor y no
  // cuarenta cadenas distintas ("fuerza relativa 6m -10.9176% ≤ 0 contra SPY") que nadie puede traducir.
  if (base.rs6m === null || base.rs6m <= 0) reasons.push(`fr6m_negativa:${base.rs6m ?? "—"}`);
  if (s200 !== null && close < s200) reasons.push("bajo_sma200");
  const r21 = returnPct(candles, 21);
  if (r21 !== null && r21 > p.maxReturn21dPct) reasons.push("no_perseguir");
  // Cierre bajo el stop dinámico: viene cayendo desde un máximo reciente. Se observa; nunca un objetivo por debajo del precio.
  const belowStop = base.stop !== null && close <= base.stop;
  if (belowStop) reasons.push("bajo_stop");
  // El objetivo sale del precio que se va a PAGAR, igual que en las acciones. Con "esperar_retroceso" la
  // franja queda por debajo del cierre, y medir el 2 a 1 desde el cierre daba una relación que no era la
  // de la operación (EWT el 12/9: objetivo 119,93 desde el cierre contra 110,69 desde la entrada real).
  const techo = base.entry?.high ?? close;
  const ejecutable = !belowStop && base.stop !== null && base.stop < (base.entry?.low ?? close);
  base.target = ejecutable ? computeTarget(techo, base.stop) : null;
  return { ...base, verdict: reasons.length ? "OBSERVAR" : "COMPRAR", reasons };
}
