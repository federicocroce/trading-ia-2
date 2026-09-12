import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { api, type ChartBar } from "./api";

/**
 * Gráfico de precio portado de trading v1 (lightweight-charts). Velas/línea/área + volumen,
 * con líneas de costo promedio, stop y objetivo cuando hay posición o veredicto.
 */
const COLORS = { green: "#22c55e", red: "#ef4444", greenFaded: "rgba(34,197,94,0.3)", redFaded: "rgba(239,68,68,0.3)", greenVolume: "rgba(34,197,94,0.25)", redVolume: "rgba(239,68,68,0.25)", text: "#8a8a8a", grid: "rgba(128,128,128,0.15)" };

/**
 * Indicadores que dibuja el gráfico. Son los mismos que deciden el veredicto, no adornos: la media de 200
 * es el filtro de tendencia de fondo que excluye candidatas, la de 50 separa "esperar confirmación" de
 * comprable, la de 20 es el nivel de la orden limitada cuando está estirada, y el stop dinámico es la
 * línea que anula la tesis. Vienen calculados del servidor con las funciones del núcleo, así que el
 * dibujo y la decisión no pueden discrepar.
 */
const INDICADORES = [
  { k: "sma20" as const, label: "MM20", color: "#3b82f6", ayuda: "Media móvil de 20 ruedas. Si la acción está muy por encima, la app manda esperar a que vuelva acá." },
  { k: "sma50" as const, label: "MM50", color: "#a855f7", ayuda: "Media móvil de 50 ruedas. Por debajo, no se compra la caída: se espera que recupere el máximo de las últimas 10." },
  { k: "sma200" as const, label: "MM200", color: "#f59e0b", ayuda: "Media móvil de 200 ruedas. Cerrar por debajo excluye a la candidata: la tendencia de fondo es bajista." },
  { k: "stop" as const, label: "Stop", color: "#ef4444", ayuda: "Stop dinámico (22 ruedas, 3 ATR). Si cierra por debajo, la tesis se anuló." },
];
type IndicadorKey = (typeof INDICADORES)[number]["k"];
const LEIDOS = (): IndicadorKey[] => {
  try {
    const v = JSON.parse(localStorage.getItem("chart.indicadores") ?? "null");
    return Array.isArray(v) ? v.filter((x) => INDICADORES.some((i) => i.k === x)) : ["sma50", "sma200"];
  } catch {
    return ["sma50", "sma200"];
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
export interface PriceLevels { avgCost?: number | null; stop?: number | null; target?: number | null }

const isDark = () => window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;

export function PriceChart({ symbol, currentPrice, levels, onPeriodChange }: { symbol: string; currentPrice?: number | null; levels?: PriceLevels; onPeriodChange?: (p: PeriodChange | null) => void }) {
  const [tfIdx, setTfIdx] = useState(2);
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [bars, setBars] = useState<ChartBar[] | null>(null);
  const [indicadores, setIndicadores] = useState<IndicadorKey[]>(LEIDOS);
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
    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: isIntraday, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 380,
      crosshair: { mode: 0 },
    });
    // Intradiario: lightweight-charts dibuja en UTC; se corre 3 h para leer hora argentina.
    const shift = isIntraday ? -3 * 3600 : 0;
    const t = (b: ChartBar) => (b.time + shift) as UTCTimestamp;
    const up = window_[window_.length - 1]!.close >= window_[0]!.open;
    let main: ISeriesApi<"Candlestick"> | ISeriesApi<"Line"> | ISeriesApi<"Area">;
    if (chartType === "candle") {
      main = chart.addSeries(CandlestickSeries, { upColor: COLORS.green, downColor: COLORS.red, borderUpColor: COLORS.green, borderDownColor: COLORS.red, wickUpColor: COLORS.green, wickDownColor: COLORS.red });
      main.setData(window_.map((b) => ({ time: t(b), open: b.open, high: b.high, low: b.low, close: b.close })));
    } else if (chartType === "line") {
      main = chart.addSeries(LineSeries, { color: up ? COLORS.green : COLORS.red, lineWidth: 2 });
      main.setData(window_.map((b) => ({ time: t(b), value: b.close })));
    } else {
      main = chart.addSeries(AreaSeries, { lineColor: up ? COLORS.green : COLORS.red, topColor: up ? COLORS.greenFaded : COLORS.redFaded, bottomColor: "transparent", lineWidth: 2 });
      main.setData(window_.map((b) => ({ time: t(b), value: b.close })));
    }
    if (window_.some((b) => b.volume > 0)) {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceScaleId: "volume" });
      chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      vol.setData(window_.filter((b) => b.volume > 0).map((b) => ({ time: t(b), value: b.volume, color: b.close >= b.open ? COLORS.greenVolume : COLORS.redVolume })));
    }
    // Indicadores. Solo se dibuja el que tiene datos: en una ventana corta la media de 200 puede no existir.
    for (const ind of INDICADORES) {
      if (!indicadores.includes(ind.k)) continue;
      const datos = window_.filter((b) => b[ind.k] !== null && b[ind.k] !== undefined).map((b) => ({ time: t(b), value: b[ind.k] as number }));
      if (datos.length < 2) continue;
      const serie = chart.addSeries(LineSeries, { color: ind.color, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...(ind.k === "stop" ? { lineStyle: 2 } : {}) });
      serie.setData(datos);
    }
    // Niveles: costo promedio, stop y objetivo.
    const line = (price: number | null | undefined, color: string, title: string) => { if (price) main.createPriceLine({ price, color, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title }); };
    // % de movimiento desde el precio actual hasta el nivel: lo que se pierde en el stop, lo que se gana en el objetivo.
    const rel = (p: number | null | undefined) => (p && currentPrice ? ` ${p >= currentPrice ? "+" : ""}${(((p - currentPrice) / currentPrice) * 100).toFixed(1)}%` : "");
    line(levels?.avgCost, dark ? "#7aa2f7" : "#2f4f9f", "costo");
    line(levels?.stop, COLORS.red, `stop${rel(levels?.stop)}`);
    line(levels?.target, COLORS.green, `objetivo${rel(levels?.target)}`);
    chart.timeScale().fitContent();
    chartRef.current = chart;
    const onResize = () => { if (containerRef.current) chart.applyOptions({ width: containerRef.current.clientWidth }); };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); chartRef.current = null; };
  }, [window_.length, tf.range, tf.interval, chartType, levels?.avgCost, levels?.stop, levels?.target, currentPrice, isIntraday, symbol, indicadores]);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="seg">{(["candle", "line", "area"] as ChartType[]).map((ct) => <button key={ct} className={chartType === ct ? "active" : ""} onClick={() => setChartType(ct)}>{{ candle: "Velas", line: "Línea", area: "Área" }[ct]}</button>)}</div>
        <div className="seg">{TIMEFRAMES.map((x, i) => <button key={x.label} className={i === tfIdx ? "active" : ""} onClick={() => setTfIdx(i)}>{x.label}</button>)}</div>
      </div>
      <div className="row" style={{ marginBottom: 8, gap: 6 }}>
        <span className="muted" style={{ fontSize: 12 }}>Indicadores</span>
        {INDICADORES.map((ind) => {
          const on = indicadores.includes(ind.k);
          const hay = (bars ?? []).some((b) => b[ind.k] !== null && b[ind.k] !== undefined);
          return (
            <button
              key={ind.k}
              className="ghost"
              disabled={!hay}
              title={hay ? ind.ayuda : `${ind.ayuda} Sin historia suficiente en esta ventana.`}
              style={{ padding: "2px 9px", fontSize: 12, opacity: hay ? 1 : 0.4, borderColor: on ? ind.color : undefined, color: on ? ind.color : undefined }}
              onClick={() => {
                const next = on ? indicadores.filter((x) => x !== ind.k) : [...indicadores, ind.k];
                setIndicadores(next);
                try { localStorage.setItem("chart.indicadores", JSON.stringify(next)); } catch { /* sin almacenamiento: no pasa nada */ }
              }}
            >
              {ind.label}
            </button>
          );
        })}
        {isIntraday && <span className="muted" style={{ fontSize: 11 }}>Las medias y el stop son de ruedas diarias: en 1D y 1S no se dibujan.</span>}
      </div>
      {err && <div className="err">{err}</div>}
      {bars === null && !err ? <div className="muted" style={{ height: 380 }}>Cargando gráfico…</div> : window_.length === 0 ? <div className="muted" style={{ height: 380 }}>Sin datos para este período.</div> : <div ref={containerRef} style={{ width: "100%", height: 380 }} />}
    </div>
  );
}
