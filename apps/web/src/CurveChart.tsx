import { useEffect, useRef } from "react";
import { ColorType, LineSeries, createChart } from "lightweight-charts";
import type { CurvePoint } from "./api";

/** Dos líneas en base 100: la cartera (TWR encadenado) y comprar SPY el primer día. Mismo motor que la ficha. */
const COLORS = { up: "#22c55e", down: "#ef4444", spy: "#8a8a8a", text: "#8a8a8a", grid: "rgba(128,128,128,0.15)" };

export function CurveChart({ points }: { points: CurvePoint[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || points.length < 2) return;
    const el = ref.current;
    const chart = createChart(el, {
      layout: { background: { type: ColorType.Solid, color: "transparent" }, textColor: COLORS.text, attributionLogo: false },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      rightPriceScale: { borderColor: COLORS.grid },
      timeScale: { borderColor: COLORS.grid, timeVisible: false },
      width: el.clientWidth,
      height: 260,
      crosshair: { mode: 0 },
    });
    // Verde o rojo según si GANASTE plata (el índice arranca en 100), no según si le ganaste al SPY. Hasta
    // el 13/9 se pintaba comparando contra el SPY: una cartera que perdió 15% mientras el SPY perdía 20%
    // salía verde, y una que ganó 8% mientras el SPY ganaba 12% salía roja. El color decía lo contrario de
    // lo que el usuario lee en un color. Ganarle o no al SPY ya está dicho, con números, en la tabla de
    // arriba y en la línea gris del propio gráfico.
    const last = points[points.length - 1]!;
    const base = points[0]!.index;
    const mine = chart.addSeries(LineSeries, { color: last.index >= base ? COLORS.up : COLORS.down, lineWidth: 2, title: "cartera" });
    mine.setData(points.map((p) => ({ time: p.date, value: p.index })));
    const spy = chart.addSeries(LineSeries, { color: COLORS.spy, lineWidth: 1, title: "SPY" });
    spy.setData(points.map((p) => ({ time: p.date, value: p.spyIndex })));
    chart.timeScale().fitContent();
    const onResize = () => chart.applyOptions({ width: el.clientWidth });
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); chart.remove(); };
  }, [points]);
  if (points.length < 2) return null;
  return <div ref={ref} style={{ width: "100%", height: 260, marginTop: 8 }} />;
}
