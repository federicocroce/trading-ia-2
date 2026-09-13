import { computeTarget, computeTrailingStop } from "../cartera/stop.js";
import type { Candle } from "../cartera/types.js";
import { atrPct, returnPct, sma } from "./candidate.js";
import { entryTiming, type EntryTiming } from "./entry.js";
import { crossesSplit } from "./split.js";
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
  /**
   * Cuándo entrar. Solo para satélites: un ETF temático extendido se paga caro igual que una acción.
   * El núcleo va en `null` a propósito, porque se compra por calendario y no se busca el momento.
   */
  entry: EntryTiming | null;
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
  };
  // El núcleo no se vende por stop ni tiene objetivo: se compra por calendario y se mantiene.
  // Las banderas son NOMBRES estables, no frases: la pantalla las traduce y las pinta según su signo. Antes
  // acá viajaba "núcleo: se compra por calendario, sin timing", una oración que la UI no podía reconocer y
  // pintaba en ámbar con el mismo ⚑ que una salvedad. Que un ETF sea del núcleo no es una advertencia.
  if (cfg.role === "nucleo") return { ...base, stop: null, target: null, entry: null, verdict: "NUCLEO", reasons: ["nucleo_por_calendario"] };
  base.entry = entryTiming(candles);
  const reasons: string[] = [];
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
