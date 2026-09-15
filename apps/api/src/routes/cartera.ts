import { Hono } from "hono";
import { z } from "zod";
import { fechaDeCierre, todayLocal, summarizeMeasurement, type RiskReport, type VerdictRow } from "@thesis/core";
import { carteraCurve, liveQuotes, measureVerdicts, replan, runCartera, type CurveResponse } from "@thesis/pipeline";
import { randomUUID } from "node:crypto";
import type { Container } from "../container.js";

/** Rutas de la cartera real (spec etapa 1 §8). `/portfolio` sigue siendo el paper de tesis. */
const PositionBody = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  quantity: z.number().positive(),
  avgCost: z.number().positive(),
  currency: z.string().default("USD"),
  market: z.enum(["us", "adr", "ar"]),
  layer: z.enum(["riesgo", "nucleo", "cobertura"]).default("riesgo"),
  notes: z.string().nullable().default(null),
});
const TxBody = z.object({
  symbol: z.string().min(1).transform((s) => s.toUpperCase()),
  type: z.enum(["BUY", "SELL", "DIVIDEND", "TRANSFER"]),
  quantity: z.number().positive(),
  price: z.number().nonnegative(),
  fees: z.number().nonnegative().default(0),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.string().default("USD"),
  platform: z.string().nullable().default(null),
  externalId: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

/** La curva se calcula desde lo guardado; se cachea 5 min y se invalida al tocar posiciones u operaciones o al correr. */
const CURVE_TTL_MS = 5 * 60_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

export function carteraRoutes(c: Container) {
  const app = new Hono();
  const store = c.carteraDeps.store;
  let curveCache: { at: number; value: CurveResponse } | null = null;
  const bustCurve = () => { curveCache = null; };

  /**
   * De qué vela sale el cierre de cada veredicto (15/9). La corrida de las 07:49 del 15/9 usó el cierre del 14/9 y
   * la pantalla decía "cierre del 15/9". Las corridas nuevas lo guardan en el informe de riesgo de ESA fecha; para
   * las anteriores se busca la vela con el mismo cierre, sin pasarse de la fecha de la corrida.
   */
  async function fechasDeCierre(date: string, verdicts: VerdictRow[], report: RiskReport | null): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const w of report?.weights ?? []) if (w.closeDate) out[w.symbol] = w.closeDate;
    for (const v of verdicts) {
      if (out[v.symbol] !== undefined || v.verdictDate !== date) continue;
      const velas = await c.store.candles(v.symbol, addDays(date, -15)).catch(() => []);
      out[v.symbol] = fechaDeCierre(velas, v.close, date);
    }
    return out;
  }
  /** El informe de riesgo de esa corrida exacta (no uno anterior), con la fecha de la vela completada si faltaba. */
  async function riesgoConFecha(r: { date: string; report: RiskReport } | null): Promise<{ date: string; report: RiskReport } | null> {
    if (!r || r.report.asOf) return r;
    const fechas = await fechasDeCierre(r.date, await store.verdictsForDate(r.date), r.report);
    const conocidas = Object.values(fechas).filter((d): d is string => d !== null).sort();
    return { ...r, report: { ...r.report, asOf: conocidas.at(-1) ?? null, weights: r.report.weights.map((w) => ({ ...w, closeDate: w.closeDate ?? fechas[w.symbol] ?? null })) } };
  }
  async function veredictosConFecha(list: VerdictRow[]) {
    const date = list[0]?.verdictDate;
    if (!date) return [];
    const r = await store.riskForDate(date);
    const fechas = await fechasDeCierre(date, list, r && r.date === date ? r.report : null);
    return list.map((v) => ({ ...v, closeDate: fechas[v.symbol] ?? null }));
  }

  app.get("/cartera/positions", async (ctx) => ctx.json(await store.positions()));
  app.post("/cartera/positions", async (ctx) => {
    const p = PositionBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    await store.upsertPosition(p.data);
    bustCurve();
    return ctx.json({ ok: true });
  });
  app.delete("/cartera/positions/:symbol", async (ctx) => {
    await store.deletePosition(ctx.req.param("symbol"));
    bustCurve();
    return ctx.json({ ok: true });
  });

  /** Precio vivo de cada posición con variación diaria, para la tabla. Una fuente caída da null, no error. */
  app.get("/cartera/quotes", async (ctx) => {
    const symbols = (await store.positions()).map((p) => p.symbol);
    const quotes = await liveQuotes(c.tickerDeps.quote, symbols, { log: (m) => console.warn(m) });
    return ctx.json({ asOf: new Date().toISOString(), quotes });
  });

  app.get("/cartera/transactions", async (ctx) => ctx.json(await store.transactions()));
  app.post("/cartera/transactions", async (ctx) => {
    const p = TxBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    const inserted = await store.insertTransactions([{ id: randomUUID(), ...p.data }]);
    bustCurve();
    return ctx.json({ inserted });
  });

  app.post("/cartera/run", async (ctx) => {
    const today = ctx.req.query("today") ?? todayLocal();
    const s = await runCartera(c.carteraDeps, { today });
    const measured = await measureVerdicts(c.carteraDeps, { today });
    // Un SUMAR de Cartera cambia lo que el plan suma: se rearma para que las dos pantallas digan lo mismo (14/9).
    await replan(c.radarDeps, { today, portfolioUsd: (await c.store.latestRisk())?.report.totalValue ?? null }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    bustCurve();
    return ctx.json({ ...s, measured });
  });
  /** Curva de la cartera real desde las operaciones: TWR, XIRR, volatilidad y drawdown contra SPY. `?fresh=1` saltea la caché. */
  app.get("/cartera/curve", async (ctx) => {
    if (curveCache && !ctx.req.query("fresh") && Date.now() - curveCache.at < CURVE_TTL_MS) return ctx.json(curveCache.value);
    const value = await carteraCurve(c.store);
    curveCache = { at: Date.now(), value };
    return ctx.json(value);
  });
  // ?date=YYYY-MM-DD: histórico, tal como quedó esa corrida. Cada veredicto lleva `closeDate` y el riesgo `asOf`.
  app.get("/cartera/verdicts", async (ctx) => { const d = ctx.req.query("date"); return ctx.json(await veredictosConFecha(d ? await store.verdictsForDate(d) : await store.latestVerdicts())); });
  app.get("/cartera/risk", async (ctx) => { const d = ctx.req.query("date"); return ctx.json(await riesgoConFecha(d ? await store.riskForDate(d) : await store.latestRisk())); });
  app.get("/cartera/measurement", async (ctx) => {
    const all = await store.allVerdicts();
    return ctx.json({ total: all.length, ...summarizeMeasurement(all) });
  });
  return app;
}
