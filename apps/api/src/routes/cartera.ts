import { Hono } from "hono";
import { z } from "zod";
import { summarizeMeasurement } from "@thesis/core";
import { liveQuotes, measureVerdicts, runCartera } from "@thesis/pipeline";
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

export function carteraRoutes(c: Container) {
  const app = new Hono();
  const store = c.carteraDeps.store;

  app.get("/cartera/positions", async (ctx) => ctx.json(await store.positions()));
  app.post("/cartera/positions", async (ctx) => {
    const p = PositionBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    await store.upsertPosition(p.data);
    return ctx.json({ ok: true });
  });
  app.delete("/cartera/positions/:symbol", async (ctx) => {
    await store.deletePosition(ctx.req.param("symbol"));
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
    return ctx.json({ inserted: await store.insertTransactions([{ id: randomUUID(), ...p.data }]) });
  });

  app.post("/cartera/run", async (ctx) => {
    const today = ctx.req.query("today") ?? new Date().toISOString().slice(0, 10);
    const s = await runCartera(c.carteraDeps, { today });
    const measured = await measureVerdicts(c.carteraDeps, { today });
    return ctx.json({ ...s, measured });
  });
  app.get("/cartera/verdicts", async (ctx) => ctx.json(await store.latestVerdicts()));
  app.get("/cartera/risk", async (ctx) => ctx.json(await store.latestRisk()));
  app.get("/cartera/measurement", async (ctx) => {
    const all = await store.allVerdicts();
    return ctx.json({ total: all.length, ...summarizeMeasurement(all) });
  });
  return app;
}
