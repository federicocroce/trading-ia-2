import { Hono } from "hono";
import { cors } from "hono/cors";
import { CloseReason } from "@thesis/core";
import { approveAndExecute, calibrationReport, closeThesis, dailyRun, rejectByHuman, syncOrders, buildNovedades, withUsageStep, STEPS, type StepId } from "@thesis/pipeline";
import { summarizeUsage } from "@thesis/core";
import { z } from "zod";
import type { Container } from "../container.js";
import { state } from "../container.js";
import { catchUpStatus, localDate, runCatchUp, runStep } from "../catchup.js";
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
  /** Uso de fuentes externas del día: por fuente contra su límite, Gemini por modelo y clave, y por paso. ?date=YYYY-MM-DD (local). */
  app.get("/usage", async (ctx) => {
    const date = ctx.req.query("date") ?? localDate(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return ctx.json({ error: "fecha inválida" }, 400);
    const from = new Date(`${date}T00:00:00`);
    const to = new Date(from.getTime() + 86_400_000);
    await c.usage?.flush();
    const calls = await c.store.callsBetween(from.toISOString(), to.toISOString());
    return ctx.json(summarizeUsage(calls, { date }));
  });
  /** Ponerse al día: qué pasos quedaron sin correr y correrlos (solo esos). */
  app.get("/catchup", async (ctx) => ctx.json(await catchUpStatus(c)));
  /** Novedades del día: qué cambió contra la corrida anterior (lo que se lee a la mañana). */
  app.get("/novedades", async (ctx) => ctx.json(await buildNovedades(c.store, { today: ctx.req.query("today") ?? new Date().toISOString().slice(0, 10), at: ctx.req.query("date") ?? null })));
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
    const today = new Date().toISOString().slice(0, 10);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
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
