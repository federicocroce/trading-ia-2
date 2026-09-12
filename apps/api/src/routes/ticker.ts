import { todayLocal } from "@thesis/core";
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

/** Yahoo en vivo no puede colgar el gráfico: pasado esto, 502 y el front avisa. */
const CHART_TIMEOUT_MS = 8_000;

export function tickerRoutes(c: Container) {
  const app = new Hono();
  const deps = c.tickerDeps;
  const today = (q: string | undefined) => q ?? todayLocal();

  app.get("/ticker/:symbol", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return ctx.json({ error: "símbolo inválido" }, 400);
    // ?live=0: modo rápido, solo lo guardado; lo que falta se completa atrás y la UI vuelve a pedir.
    const live = ctx.req.query("live") !== "0";
    return ctx.json(await buildTicker(deps, symbol, { today: today(ctx.req.query("today")), live }));
  });

  app.get("/ticker/:symbol/chart", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    const range = ctx.req.query("range") ?? "3mo";
    const interval = ctx.req.query("interval") ?? "1d";
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || !RANGES.has(range) || !INTERVALS.has(interval)) return ctx.json({ error: "range o interval inválido" }, 400);
    const t = today(ctx.req.query("today"));
    // Diario hasta 1 año: de la base si tiene suficiente historia. Lo demás, en vivo.
    if (interval === "1d" && RANGE_DAYS[range]! <= 366) {
      const from = new Date(Date.parse(t) - RANGE_DAYS[range]! * DAY).toISOString().slice(0, 10);
      const candles = await deps.store.candles(symbol, from);
      const enough = candles.length >= Math.min(200, Math.floor((RANGE_DAYS[range]! * 5) / 7) - 10);
      if (enough) {
        const bars: ChartBar[] = candles.map((x) => ({ time: Math.floor(Date.parse(x.date) / 1000), open: x.open, high: x.high, low: x.low, close: x.close, volume: x.volume }));
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
