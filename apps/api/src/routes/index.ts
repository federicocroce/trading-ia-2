import { Hono } from "hono";
import { cors } from "hono/cors";
import { CloseReason } from "@thesis/core";
import { approveAndExecute, calibrationReport, closeThesis, dailyRun, rejectByHuman, syncOrders, buildNovedades } from "@thesis/pipeline";
import { z } from "zod";
import type { Container } from "../container.js";
import { state } from "../container.js";
import { catchUpStatus, runCatchUp } from "../catchup.js";
import { carteraRoutes } from "./cartera.js";
import { radarRoutes } from "./radar.js";
import { taxonomyRoutes } from "./taxonomy.js";
import { tickerRoutes } from "./ticker.js";
import { pricesRoutes } from "./prices.js";

export function buildApp(c: Container) {
  const app = new Hono();
  app.use("*", cors());

  app.get("/health", async (ctx) => ctx.json({ ok: true, paper: true, killSwitch: state.killSwitch, lastRun: state.lastRun }));
  /** Ponerse al día: qué pasos quedaron sin correr y correrlos (solo esos). */
  app.get("/catchup", async (ctx) => ctx.json(await catchUpStatus(c)));
  /** Novedades del día: qué cambió contra la corrida anterior (lo que se lee a la mañana). */
  app.get("/novedades", async (ctx) => ctx.json(await buildNovedades(c.store, { today: ctx.req.query("today") ?? new Date().toISOString().slice(0, 10) })));
  app.post("/catchup", async (ctx) => ctx.json(await runCatchUp(c)));

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
