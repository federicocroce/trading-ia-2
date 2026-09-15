import { Hono } from "hono";
import { cors } from "hono/cors";
import { todayLocal, CloseReason } from "@thesis/core";
import { approveAndExecute, calibrationReport, closeThesis, dailyRun, tesisSince, rejectByHuman, syncOrders, buildNovedades, withUsageStep, STEPS, type StepId } from "@thesis/pipeline";
import { REGISTRO_USO_DESDE, dailyUsage, geminiQuotaResetWithin, summarizeUsage } from "@thesis/core";
import { z } from "zod";
import type { Container } from "../container.js";
import { state } from "../container.js";
import { USAGE_RETENTION_DAYS, catchUpStatus, localDate, runCatchUp, runStep } from "../catchup.js";
import { carteraRoutes } from "./cartera.js";
import { radarRoutes } from "./radar.js";
import { taxonomyRoutes } from "./taxonomy.js";
import { tickerRoutes } from "./ticker.js";
import { pricesRoutes } from "./prices.js";

export function buildApp(c: Container) {
  const app = new Hono();
  app.use("*", cors());
  // Todo pedido saliente hecho desde una ruta queda atribuido a "api" en el registro de uso (los pasos anidan el suyo).
  app.use("*", (_ctx, next) => withUsageStep({ step: "api" }, () => next()));

  app.get("/health", async (ctx) => ctx.json({ ok: true, paper: true, killSwitch: state.killSwitch, lastRun: state.lastRun }));
  /**
   * Desde cuándo hay registro de uso: la primera fila de la tabla (14/9, 00:33) o lo que dejó la retención de 90 días,
   * lo más nuevo. Antes de eso un día no tuvo cero llamadas: no tiene datos, y la pantalla lo tiene que decir (15/9).
   */
  const registroDesde = () => {
    const retencion = new Date(Date.now() - USAGE_RETENTION_DAYS * 86_400_000).toISOString();
    return retencion > REGISTRO_USO_DESDE ? retencion : REGISTRO_USO_DESDE;
  };
  /** Uso de fuentes externas del día: por fuente contra su límite, Gemini por modelo y clave, y por paso. ?date=YYYY-MM-DD (local). */
  app.get("/usage", async (ctx) => {
    const date = ctx.req.query("date") ?? localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ctx.json({ error: "fecha inválida" }, 400);
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    await c.usage?.flush();
    const calls = await c.store.callsBetween(from.toISOString(), to.toISOString());
    // El día de la pantalla va de medianoche a medianoche de acá; la cuota de Gemini se reinicia a las 04:00 (15/9).
    return ctx.json(summarizeUsage(calls, { date, dayFrom: from.toISOString(), dayTo: to.toISOString(), registroDesde: registroDesde(), quotaResetAt: geminiQuotaResetWithin(from.toISOString(), to.toISOString()) }));
  });
  /** Serie diaria del uso (últimos N días, día local): para el gráfico de la pestaña Uso. */
  app.get("/usage/daily", async (ctx) => {
    const days = Math.min(90, Math.max(1, Math.floor(Number(ctx.req.query("days") ?? 14) || 14)));
    const end = ctx.req.query("date") ?? localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return ctx.json({ error: "fecha inválida" }, 400);
    const to = new Date(`${end}T00:00:00`);
    to.setDate(to.getDate() + 1);
    const dates: string[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(`${end}T00:00:00`);
      d.setDate(d.getDate() - i);
      dates.push(localDate(d));
    }
    const from = new Date(`${dates[0]}T00:00:00`);
    await c.usage?.flush();
    const calls = await c.store.callsBetween(from.toISOString(), to.toISOString());
    return ctx.json(dailyUsage(calls, dates, (iso) => localDate(new Date(iso)), { registroDesde: registroDesde() }));
  });
  /** Llamadas de un día con filtros (fuente, paso, resultado, símbolo), las más recientes primero. */
  app.get("/usage/calls", async (ctx) => {
    const date = ctx.req.query("date") ?? localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ctx.json({ error: "fecha inválida" }, 400);
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    const limit = Math.min(1000, Math.max(1, Math.floor(Number(ctx.req.query("limit") ?? 200) || 200)));
    const q = { source: ctx.req.query("source"), step: ctx.req.query("step"), result: ctx.req.query("result"), symbol: ctx.req.query("symbol")?.toUpperCase() };
    await c.usage?.flush();
    const calls = (await c.store.callsBetween(from.toISOString(), to.toISOString()))
      .filter((x) => (!q.source || x.source === q.source) && (!q.step || x.step === q.step) && (!q.result || x.result === q.result) && (!q.symbol || x.symbol === q.symbol))
      .reverse();
    return ctx.json({ date, total: calls.length, calls: calls.slice(0, limit) });
  });
  /** Ponerse al día: qué pasos quedaron sin correr y correrlos (solo esos). */
  app.get("/catchup", async (ctx) => ctx.json(await catchUpStatus(c)));
  /** Novedades del día: qué cambió contra la corrida anterior (lo que se lee a la mañana). */
  app.get("/novedades", async (ctx) => ctx.json(await buildNovedades(c.store, { today: ctx.req.query("today") ?? todayLocal(), at: ctx.req.query("date") ?? null })));
  /** Fechas con corrida guardada, para el selector de histórico. */
  app.get("/runs/dates", async (ctx) => ctx.json(await c.store.runDates(90)));
  app.post("/catchup", async (ctx) => ctx.json(await runCatchUp(c)));
  app.post("/catchup/run/:step", async (ctx) => {
    const id = ctx.req.param("step");
    if (!STEPS.some((s) => s.id === id)) return ctx.json({ error: "paso desconocido" }, 400);
    return ctx.json(await runStep(c, id as StepId));
  });

  // ---- tesis ----
  app.get("/theses", async (ctx) => {
    const status = ctx.req.query("status") ?? "proposed";
    const list = await c.store.thesesByStatus(status.split(",") as never);
    return ctx.json(list);
  });
  app.get("/theses/:id", async (ctx) => {
    const t = await c.store.thesis(ctx.req.param("id"));
    if (!t) return ctx.json({ error: "not found" }, 404);
    const [event, orders] = await Promise.all([c.store.rawEvent(t.rawEventId), c.store.ordersForThesis(t.id)]);
    return ctx.json({ thesis: t, event, orders });
  });
  app.post("/theses/:id/approve", async (ctx) => {
    const res = await approveAndExecute(ctx.req.param("id"), { store: c.store, risk: c.risk, marketData: c.marketData, broker: c.broker, snapshot: c.snapshot });
    return ctx.json(res, res.ok ? 200 : 422);
  });
  app.post("/theses/:id/reject", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    const ok = await rejectByHuman(ctx.req.param("id"), c.store, typeof body.note === "string" ? body.note : "");
    return ctx.json({ ok }, ok ? 200 : 422);
  });
  const CloseBody = z.object({ predictedOutcomeHappened: z.boolean(), closeReason: CloseReason, notes: z.string().optional() });
  app.post("/theses/:id/close", async (ctx) => {
    const parsed = CloseBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!parsed.success) return ctx.json({ error: parsed.error.flatten() }, 400);
    try {
      const out = await closeThesis({ thesisId: ctx.req.param("id"), ...parsed.data }, { store: c.store, broker: c.broker, marketData: c.marketData });
      return ctx.json(out);
    } catch (e) {
      return ctx.json({ error: String(e) }, 422);
    }
  });

  // ---- portfolio / riesgo ----
  app.get("/portfolio", async (ctx) => ctx.json({ snapshot: await c.snapshot(), account: await c.account(), openOrders: await c.store.openOrders() }));
  app.post("/kill-switch", async (ctx) => {
    const body = await ctx.req.json().catch(() => ({}));
    state.killSwitch = body.on !== false;
    return ctx.json({ killSwitch: state.killSwitch });
  });

  // ---- pipeline ----
  app.post("/run", async (ctx) => {
    const today = todayLocal();
    const since = tesisSince();
    const summary = await dailyRun(c.runDeps, { since, today });
    state.lastRun = { at: new Date().toISOString(), summary: { ...summary, proposed: summary.proposed.length, rejected: summary.rejected.length } };
    return ctx.json(summary);
  });
  app.post("/sync", async (ctx) => ctx.json({ synced: await syncOrders(c.store, c.broker) }));

  // ---- cartera real ----
  app.route("/", carteraRoutes(c));
  app.route("/", radarRoutes(c));
  app.route("/", taxonomyRoutes(c));
  app.route("/", tickerRoutes(c));
  app.route("/", pricesRoutes(c));

  // ---- calibración ----
  app.get("/calibration", async (ctx) => {
    const rows = await c.store.allOutcomesWithTheses();
    const humanRejected = (await c.store.thesesByStatus("rejected", 1000)).filter((t) => t.rejectionReason === "human").length;
    return ctx.json(calibrationReport(rows, (await c.account()).equity, humanRejected));
  });

  return app;
}
