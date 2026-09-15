import { chandelierSeries, rsiSeries, sessionBarFrom, smaSeries, todayLocal } from "@thesis/core";
import { Hono } from "hono";
import type { ChartBar } from "@thesis/core";
import { buildTicker, withTimeout } from "@thesis/pipeline";
import type { Container } from "../container.js";

/**
 * Página por ticker (etapa 2b). `GET /ticker/:symbol` sirve todo desde la base (completa lo que falte
 * con TTL); `GET /ticker/:symbol/chart` sirve velas diarias desde la base y, para intradiario o
 * rangos largos, pide a Yahoo en el momento.
 */
const RANGES = new Set(["1d", "5d", "1mo", "3mo", "6mo", "1y", "2y", "5y"]);
const INTERVALS = new Set(["5m", "15m", "1h", "1d", "1wk"]);
const RANGE_DAYS: Record<string, number> = { "1d": 1, "5d": 5, "1mo": 31, "3mo": 92, "6mo": 183, "1y": 366, "2y": 731, "5y": 1827 };
const DAY = 86_400_000;
/** Barras extra hacia atrás para que la media de 200 y el stop existan desde la primera barra visible. */
const CALENTAMIENTO_DIAS = 330;

/** Yahoo en vivo no puede colgar el gráfico: pasado esto, 502 y el front avisa. */
const CHART_TIMEOUT_MS = 8_000;
/** La vela de hoy es un agregado: si el intradiario tarda, el diario sale sin ella. */
const SESSION_TIMEOUT_MS = 3_000;

export function tickerRoutes(c: Container) {
  const app = new Hono();
  const deps = c.tickerDeps;
  const today = (q: string | undefined) => q ?? todayLocal();

  app.get("/ticker/:symbol", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return ctx.json({ error: "símbolo inválido" }, 400);
    // ?live=0: modo rápido, solo lo guardado; lo que falta se completa atrás y la UI vuelve a pedir.
    const live = ctx.req.query("live") !== "0";
    // El cuestionario vigente es el del verificador del Radar: una verificación de otro no se muestra como vigente (15/9).
    return ctx.json(await buildTicker(deps, symbol, { today: today(ctx.req.query("today")), live, verifierPromptVersion: c.radarDeps?.verifier?.promptVersion ?? null }));
  });

  app.get("/ticker/:symbol/chart", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    const range = ctx.req.query("range") ?? "3mo";
    const interval = ctx.req.query("interval") ?? "1d";
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !RANGES.has(range) || !INTERVALS.has(interval)) return ctx.json({ error: "range o interval inválido" }, 400);
    const t = today(ctx.req.query("today"));
    // Diario hasta 1 año: de la base si tiene suficiente historia. Lo demás, en vivo.
    if (interval === "1d" && RANGE_DAYS[range]! <= 366) {
      const desde = new Date(Date.parse(t) - RANGE_DAYS[range]! * DAY).toISOString().slice(0, 10);
      // Se piden CALENTAMIENTO_DIAS extra hacia atrás para poder calcular la media de 200 y el stop ya
      // desde la primera barra visible. Sin eso, una ventana de 3 meses mostraría la media de 200 recién
      // al final o directamente nunca, que es cuando más falta hace: es el filtro que excluye candidatas.
      const conCalentamiento = new Date(Date.parse(desde) - CALENTAMIENTO_DIAS * DAY).toISOString().slice(0, 10);
      const todas = await deps.store.candles(symbol, conCalentamiento);
      const visibles = todas.filter((x) => x.date >= desde);
      const enough = visibles.length >= Math.min(200, Math.floor((RANGE_DAYS[range]! * 5) / 7) - 10);
      if (enough) {
        const s20 = smaSeries(todas, 20);
        const s50 = smaSeries(todas, 50);
        const s200 = smaSeries(todas, 200);
        const stop = chandelierSeries(todas, 22, 3);
        const rsi = rsiSeries(todas, 14);
        const bars: ChartBar[] = todas.map((x, i) => ({
          time: Math.floor(Date.parse(x.date) / 1000), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume,
          sma20: s20[i] ?? null, sma50: s50[i] ?? null, sma200: s200[i] ?? null, stop: stop[i] ?? null, rsi14: rsi[i] ?? null,
        })).filter((b) => b.time >= Math.floor(Date.parse(desde) / 1000));
        // La sesión que la base todavía no tiene (la de hoy durante la rueda, o la del viernes hasta el lunes a la
        // mañana), armada con el intradiario. Sin ella, APH el 14/9 terminaba en 83,92 con el precio en 79.
        const ultima = todas.at(-1)?.date;
        if (ultima && ultima < t) {
          const intradiario = await withTimeout(deps.chart.bars(symbol, "1d", "5m"), SESSION_TIMEOUT_MS, "sesión de hoy").catch(() => []);
          const hoy = sessionBarFrom(intradiario, ultima);
          if (hoy) bars.push({ ...hoy, sma20: null, sma50: null, sma200: null, stop: null, rsi14: null });
        }
        return ctx.json(bars);
      }
    }
    try {
      return ctx.json(await withTimeout(deps.chart.bars(symbol, range, interval), CHART_TIMEOUT_MS, "gráfico"));
    } catch (e) {
      return ctx.json({ error: String(e).slice(0, 200) }, 502);
    }
  });
  return app;
}
