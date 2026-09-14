import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { api, type ChartBar } from "./api";
import { notaVelaParcial } from "./niveles";

/**
 * Gráfico de precio portado de trading v1 (lightweight-charts). Velas/línea/área + volumen,
 * con líneas de costo promedio, stop y objetivo cuando hay posición o veredicto.
 */
const COLORS = { green: "#22c55e", red: "#ef4444", greenFaded: "rgba(34,197,94,0.3)", redFaded: "rgba(239,68,68,0.3)", greenVolume: "rgba(34,197,94,0.25)", redVolume: "rgba(239,68,68,0.25)", text: "#8a8a8a", grid: "rgba(128,128,128,0.15)" };

/**
 * Indicadores del gráfico, en dos grupos.
 *
 * "Decisión" son los cuatro con los que la app decide, no adornos: la media de 200 es el filtro que
 * excluye candidatas, la de 50 separa "esperar confirmación" de comprable, la de 20 es el nivel de la
 * orden limitada cuando está estirada, y el stop es la línea que anula la tesis. "Contexto" son los que
 * ayudan a mirar pero NO entran en ninguna regla, y por eso van separados: si estuvieran mezclados,
 * cualquiera supondría que el RSI también decide, y no decide nada.
 */
type Panel = "precio" | "rsi" | "volumen";
interface Indicador { k: IndicadorKey; label: string; color: string; panel: Panel; grupo: "Decisión" | "Contexto"; ayuda: string }
type IndicadorKey = "sma20" | "sma50" | "sma200" | "stop" | "rsi14" | "volumen";

const INDICADORES: Indicador[] = [
  { k: "sma20", label: "MM 20", color: "#3b82f6", panel: "precio", grupo: "Decisión", ayuda: "Media móvil de 20 ruedas. Si la acción está muy por encima, la app manda esperar a que vuelva acá antes de comprar." },
  { k: "sma50", label: "MM 50", color: "#a855f7", panel: "precio", grupo: "Decisión", ayuda: "Media móvil de 50 ruedas. Por debajo no se compra la caída: se espera que recupere el máximo de las últimas 10 ruedas." },
  { k: "sma200", label: "MM 200", color: "#f59e0b", panel: "precio", grupo: "Decisión", ayuda: "Media móvil de 200 ruedas. Cerrar por debajo excluye a la candidata: la tendencia de fondo es bajista." },
  { k: "stop", label: "Stop dinámico", color: "#ef4444", panel: "precio", grupo: "Decisión", ayuda: "Stop dinámico de 22 ruedas y 3 ATR, la línea punteada que acompaña al precio. Es el filtro del Radar (cerrar por debajo la excluye) y el stop de lo que ya tenés. El de una compra nueva es la línea horizontal «stop de compra», más abajo para que el ruido de un día no la ejecute." },
  { k: "volumen", label: "Volumen", color: "#8a8a8a", panel: "volumen", grupo: "Contexto", ayuda: "Acciones operadas por rueda. Contexto: la app no decide con esto." },
  { k: "rsi14", label: "RSI 14", color: "#14b8a6", panel: "rsi", grupo: "Contexto", ayuda: "Fuerza relativa de 14 ruedas, de 0 a 100. Arriba de 70 viene sobrecomprada, abajo de 30 sobrevendida. Contexto: la app no decide con esto." },
];
const GRUPOS = ["Decisión", "Contexto"] as const;
/** Gráfico limpio: solo lo que cambia la decisión de comprar hoy. Completo: todo. */
const PRESET_LIMPIO: IndicadorKey[] = ["sma50", "sma200"];
const PRESET_COMPLETO: IndicadorKey[] = INDICADORES.map((i) => i.k);
const CLAVE = "chart.indicadores";
const LEIDOS = (): IndicadorKey[] => {
  try {
    const v = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
    return Array.isArray(v) ? v.filter((x) => INDICADORES.some((i) => i.k === x)) : [...PRESET_LIMPIO, "volumen"];
  } catch {
    return [...PRESET_LIMPIO, "volumen"];
  }
};
const TIMEFRAMES = [
  { label: "1D", range: "1d", interval: "5m", periodDays: 0 },
  { label: "1S", range: "5d", interval: "15m", periodDays: 0 },
  { label: "1M", range: "3mo", interval: "1d", periodDays: 30 },
  { label: "3M", range: "3mo", interval: "1d", periodDays: 92 },
  { label: "1A", range: "1y", interval: "1d", periodDays: 0 },
  { label: "5A", range: "5y", interval: "1wk", periodDays: 0 },
] as const;
type ChartType = "candle" | "line" | "area";
export interface PeriodChange { label: string; change: number; changePercent: number }
/** `stopLabel`: nombre de la línea del stop. Sin posición es "stop de compra", que no es el dinámico punteado. */
export interface PriceLevels { avgCost?: number | null; stop?: number | null; target?: number | null; stopLabel?: string }
/** Alto del panel de precio y del panel del RSI, que va aparte para no pisar las velas. */
const ALTO_PRECIO = 380;
const ALTO_RSI = 90;

const isDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function PriceChart({ symbol, currentPrice, levels, onPeriodChange }: { symbol: string; currentPrice?: number | null; levels?: PriceLevels; onPeriodChange?: (p: PeriodChange | null) => void }) {
  const [tfIdx, setTfIdx] = useState(2);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [bars, setBars] = useState<ChartBar[] | null>(null);
  const [indicadores, setIndicadores] = useState<IndicadorKey[]>(LEIDOS);
  const guardar = (next: IndicadorKey[]) => {
    setIndicadores(next);
    try { localStorage.setItem(CLAVE, JSON.stringify(next)); } catch { /* sin almacenamiento: no pasa nada */ }
  };
  const [err, setErr] = useState<string | null>(null);
  const tf = TIMEFRAMES[tfIdx]!;
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    let alive = true;
    setBars(null);
    setErr(null);
    api.ticker.chart(symbol, tf.range, tf.interval).then((b) => { if (alive) setBars(b); }).catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [symbol, tf.range, tf.interval]);

  // Ventana: 1M y 3M piden 3mo y recortan por días; el resto dibuja todo lo que vino.
  const isIntraday = tf.interval.endsWith("m") || tf.interval.endsWith("h");
  const window_ = (() => {
    if (!bars) return [];
    const dedup = bars.filter((b, i) => i === 0 || b.time !== bars[i - 1]!.time).sort((a, b) => a.time - b.time);
    if (!tf.periodDays) return dedup;
    const from = Math.floor(Date.now() / 1000) - tf.periodDays * 86_400;
    const w = dedup.filter((b) => b.time >= from);
    return w.length >= 2 ? w : dedup;
  })();

  useEffect(() => {
    if (!onPeriodChange) return;
    if (!bars || window_.length < 2) { onPeriodChange(null); return; }
    const first = window_[0]!.open;
    const last = currentPrice ?? window_[window_.length - 1]!.close;
    onPeriodChange({ label: tf.label, change: last - first, changePercent: ((last - first) / first) * 100 });
  }, [bars, window_.length, currentPrice, tf.label, onPeriodChange]);

  useEffect(() => {
    if (!containerRef.current || window_.length === 0) return;
    chartRef.current?.remove();
    const dark = isDark();
    const conRsi = indicadores.includes("rsi14") && window_.some((b) => b.rsi14 !== null && b.rsi14 !== undefined);
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COLORS.text, attributionLogo: false, panes: { separatorColor: COLORS.grid } },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: isIntraday, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: ALTO_PRECIO + (conRsi ? ALTO_RSI : 0),
      crosshair: { mode: 0 },
    });
    // Intradiario: lightweight-charts dibuja en UTC; se corre 3 h para leer hora argentina.
    const shift = isIntraday ? -3 * 3600 : 0;
    const t = (b: ChartBar) => (b.time + shift) as UTCTimestamp;
    const up = window_[window_.length - 1]!.close >= window_[0]!.open;
    let main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
    if (chartType === "candle") {
      main = chart.addSeries(CandlestickSeries, { upColor: COLORS.green, downColor: COLORS.red, borderUpColor: COLORS.green, borderDownColor: COLORS.red, wickUpColor: COLORS.green, wickDownColor: COLORS.red });
      // La vela de la sesión en curso va apagada: todavía no cerró (ver `notaVelaParcial`).
      const apagada = (b: ChartBar) => {
        if (!b.partial) return {};
        const c = b.close >= b.open ? COLORS.greenFaded : COLORS.redFaded;
        return { color: c, borderColor: b.close >= b.open ? COLORS.green : COLORS.red, wickColor: c };
      };
      main.setData(window_.map((b) => ({ time: t(b), open: b.open, high: b.high, low: b.low, close: b.close, ...apagada(b) })));
    } else if (chartType === "line") {
      main = chart.addSeries(LineSeries, { color: up ? COLORS.green : COLORS.red, lineWidth: 2 });
      main.setData(window_.map((b) => ({ time: t(b), value: b.close })));
    } else {
      main = chart.addSeries(AreaSeries, { lineColor: up ? COLORS.green : COLORS.red, topColor: up ? COLORS.greenFaded : COLORS.redFaded, bottomColor: "transparent", lineWidth: 2 });
      main.setData(window_.map((b) => ({ time: t(b), value: b.close })));
    }
    if (indicadores.includes("volumen") && window_.some((b) => b.volume > 0)) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      // El volumen ocupa el 20% de abajo; el precio termina antes. Antes compartían ese espacio y la media de
      // 200 de APH (73, lejos del precio) se dibujaba adentro de las barras de volumen, como si fuera parte de él.
      main.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.25 } });
      vol.setData(window_.filter((b) => b.volume > 0).map((b) => ({ time: t(b), value: b.volume, color: b.close >= b.open ? COLORS.greenVolume : COLORS.redVolume })));
    }
    // Indicadores. Solo se dibuja el que tiene datos: en una ventana corta la media de 200 puede no existir.
    for (const ind of INDICADORES.filter((x) => x.panel === "precio")) {
      if (!indicadores.includes(ind.k)) continue;
      // Los del panel de precio son siempre campos de la barra; volumen y RSI se dibujan aparte.
      const campo = ind.k as "sma20" | "sma50" | "sma200" | "stop";
      const datos = window_.filter((b) => b[campo] !== null && b[campo] !== undefined).map((b) => ({ time: t(b), value: b[campo] as number }));
      if (datos.length < 2) continue;
      const serie = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...(ind.k === "stop" ? { lineStyle: 2 } : {}) });
      serie.setData(datos);
    }
    // RSI en su propio panel, abajo: escala 0 a 100. Antes iba en el mismo espacio que las velas y el volumen,
    // con otra escala superpuesta, y su línea cruzaba las barras de volumen.
    if (conRsi) {
      const datos = window_.filter((b) => b.rsi14 !== null && b.rsi14 !== undefined).map((b) => ({ time: t(b), value: b.rsi14 as number }));
      if (datos.length >= 2) {
        const r = chart.addSeries(LineSeries, { color: "#14b8a6", lineWidth: 1, priceLineVisible: false, lastValueVisible: true }, 1);
        chart.panes()[1]?.setHeight(ALTO_RSI);
        r.setData(datos);
        for (const nivel of [70, 30]) r.createPriceLine({ price: nivel, color: COLORS.grid, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: String(nivel) });
      }
    }
    // Niveles: costo promedio, stop y objetivo.
    const line = (price: number | null | undefined, color: string, title: string) => { if (price) main.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }); };
    // % de movimiento desde el precio actual hasta el nivel: lo que se pierde en el stop, lo que se gana en el objetivo.
    const rel = (p: number | null | undefined) => (p && currentPrice ? ` ${p >= currentPrice ? "+" : ""}${(((p - currentPrice) / currentPrice) * 100).toFixed(1)}%` : "");
    line(levels?.avgCost, dark ? "#7aa2f7" : "#2f4f9f", "costo");
    line(levels?.stop, COLORS.red, `${levels?.stopLabel ?? "stop"}${rel(levels?.stop)}`);
    line(levels?.target, COLORS.green, `objetivo${rel(levels?.target)}`);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    const onResize = () => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); chartRef.current = null; };
  }, [window_.length, tf.range, tf.interval, chartType, levels?.avgCost, levels?.stop, levels?.target, levels?.stopLabel, currentPrice, isIntraday, symbol, indicadores]);
  const conRsiVisible = indicadores.includes("rsi14") && window_.some((b) => b.rsi14 !== null && b.rsi14 !== undefined);
  const nota = isIntraday ? null : notaVelaParcial(window_);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="seg">{(["candle", "line", "area"] as ChartType[]).map((ct) => <button key={ct} className={chartType === ct ? "active" : ""} onClick={() => setChartType(ct)}>{{ candle: "Velas", line: "Línea", area: "Área" }[ct]}</button>)}</div>
        <div className="seg">{TIMEFRAMES.map((x, i) => <button key={x.label} className={i === tfIdx ? "active" : ""} onClick={() => setTfIdx(i)}>{x.label}</button>)}</div>
      </div>
      <div className="row" style={{ marginBottom: 8, gap: 14, flexWrap: "wrap", alignItems: "flex-start" }}>
        {GRUPOS.map((grupo) => (
          <div key={grupo} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>{grupo}</span>
            {INDICADORES.filter((x) => x.grupo === grupo).map((ind) => {
              const hay = ind.k === "volumen" ? (bars ?? []).some((b) => b.volume > 0) : (bars ?? []).some((b) => b[ind.k as "sma20"] !== null && b[ind.k as "sma20"] !== undefined);
              const on = indicadores.includes(ind.k);
              return (
                <label key={ind.k} title={hay ? ind.ayuda : `${ind.ayuda} Sin historia suficiente en esta ventana.`} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, cursor: hay ? "pointer" : "default", opacity: hay ? 1 : 0.4 }}>
                  <input type="checkbox" checked={on && hay} disabled={!hay} onChange={() => guardar(on ? indicadores.filter((x) => x !== ind.k) : [...indicadores, ind.k])} />
                  <span style={{ width: 10, height: 2, background: ind.color, display: "inline-block" }} />
                  {ind.label}
                </label>
              );
            })}
          </div>
        ))}
        <div style={{ flex: 1 }} />
        <div className="seg">
          <button onClick={() => guardar(PRESET_LIMPIO)} title="Solo lo que cambia la decisión de comprar hoy.">Limpio</button>
          <button onClick={() => guardar(PRESET_COMPLETO)} title="Todos los indicadores disponibles.">Completo</button>
        </div>
      </div>
      {isIntraday && <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>Las medias, el stop y el RSI se calculan sobre ruedas diarias: en 1D y 1S no se dibujan.</div>}
      {nota && <div className="muted" style={{ fontSize: 11, marginBottom: 8 }}>{nota}</div>}
      {err && <div className="err">{err}</div>}
      {bars === null && !err ? <div className="muted" style={{ height: 380 }}>Cargando gráfico…</div> : window_.length === 0 ? <div className="muted" style={{ height: 380 }}>Sin datos para este período.</div> : <div ref={containerRef} style={{ width: "100%", height: ALTO_PRECIO + (conRsiVisible ? ALTO_RSI : 0) }} />}
    </div>
  );
}
