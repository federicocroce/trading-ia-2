import { useEffect, useRef, useState } from "react";
import { AreaSeries, CandlestickSeries, ColorType, HistogramSeries, LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";
import { api, type ChartBar } from "./api";

/**
 * Gráfico de precio portado de trading v1 (lightweight-charts). Velas/línea/área + volumen,
 * con líneas de costo promedio, stop y objetivo cuando hay posición o veredicto.
 */
const COLORS = { green: "#22c55e", red: "#ef4444", greenFaded: "rgba(34,197,94,0.3)", redFaded: "rgba(239,68,68,0.3)", greenVolume: "rgba(34,197,94,0.25)", redVolume: "rgba(239,68,68,0.25)", text: "#8a8a8a", grid: "rgba(128,128,128,0.15)" };
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
  }, [window_.length, tf.range, tf.interval, chartType, levels?.avgCost, levels?.stop, levels?.target, currentPrice, isIntraday, symbol]);

  return (
    <div>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
        <div className="seg">{(["candle", "line", "area"] as ChartType[]).map((ct) => <button key={ct} className={chartType === ct ? "active" : ""} onClick={() => setChartType(ct)}>{{ candle: "Velas", line: "Línea", area: "Área" }[ct]}</button>)}</div>
        <div className="seg">{TIMEFRAMES.map((x, i) => <button key={x.label} className={i === tfIdx ? "active" : ""} onClick={() => setTfIdx(i)}>{x.label}</button>)}</div>
      </div>
      {err && <div className="err">{err}</div>}
      {bars === null && !err ? <div className="muted" style={{ height: 380 }}>Cargando gráfico…</div> : window_.length === 0 ? <div className="muted" style={{ height: 380 }}>Sin datos para este período.</div> : <div ref={containerRef} style={{ width: "100%", height: 380 }} />}
    </div>
  );
}
