import { useEffect, useRef } from "react";
import { ColorType, HistogramSeries, LineSeries, createChart } from "lightweight-charts";
import type { CurvePoint } from "./api";

/**
 * Los dos gráficos de la pantalla "Día a día", separados a propósito: uno es un acumulado en dólares y el otro
 * el movimiento de cada día. En una sola escala, las barras diarias (decenas de dólares) desaparecerían contra
 * el acumulado (miles) y parecería que nunca pasó nada.
 */
const COLORS = { up: "#22c55e", down: "#ef4444", text: "#8a8a8a", grid: "rgba(128,128,128,0.15)", peak: "#8a8a8a" };

function useChart(alto: number, dibujar: (chart: ReturnType<typeof createChart>) => void, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: false },
      width: el.clientWidth,
      height: alto,
      crosshair: { mode: 0 },
    });
    dibujar(chart);
    chart.timeScale().fitContent();
    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/**
 * Ganancia acumulada en dólares (valor menos aportado), día por día, con una línea en el máximo. No es el valor
 * de la cartera: un aporte mueve el valor y no mueve esta línea.
 */
export function GananciaAcumuladaChart({ points }: { points: CurvePoint[] }) {
  const datos = points.map((p) => ({ time: p.date, value: Math.round((p.value - p.investedUsd) * 100) / 100 }));
  const ref = useChart(220, (chart) => {
    const ultimo = datos[datos.length - 1]!.value;
    const serie = chart.addSeries(LineSeries, { color: ultimo >= 0 ? COLORS.up : COLORS.down, lineWidth: 2, title: "ganancia acumulada" });
    serie.setData(datos);
    const maximo = datos.reduce((a, b) => (b.value > a.value ? b : a));
    serie.createPriceLine({ price: maximo.value, color: COLORS.peak, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `máx. ${maximo.time}` });
    serie.createPriceLine({ price: 0, color: COLORS.grid, lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });
  }, [points]);
  if (points.length < 2) return null;
  return <div ref={ref} style={{ width: "100%", height: 220, marginTop: 8 }} />;
}

/** Lo que ganaste o perdiste CADA día, en dólares y sin los aportes: una barra por rueda. */
export function GananciaDiariaChart({ points }: { points: CurvePoint[] }) {
  const ref = useChart(140, (chart) => {
    const serie = chart.addSeries(HistogramSeries, { title: "ganancia del día" });
    serie.setData(points.map((p) => ({ time: p.date, value: p.gainUsd, color: p.gainUsd >= 0 ? COLORS.up : COLORS.down })));
  }, [points]);
  if (points.length < 2) return null;
  return <div ref={ref} style={{ width: "100%", height: 140, marginTop: 8 }} />;
}
