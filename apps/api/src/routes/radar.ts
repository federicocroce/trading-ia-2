import { Hono } from "hono";
import { AXES, AXIS_METRICS, summarizeRadar, type CandidateRow, type Tags } from "@thesis/core";
import { buildContributionPlan, measureRadar, rankRadar, refreshRadar, scanUniverse } from "@thesis/pipeline";
import type { Container } from "../container.js";
import { state } from "../container.js";

/** Rutas del Radar (spec etapa 2 §12). El barrido corre en segundo plano y se consulta por estado. */
export function radarRoutes(c: Container) {
  const app = new Hono();
  const deps = c.radarDeps;
  const store = deps.store;
  const today = (ctx: { req: { query: (k: string) => string | undefined } }) => ctx.req.query("today") ?? new Date().toISOString().slice(0, 10);
  const portfolioUsd = async () => (await store.latestRisk())?.report.totalValue ?? null;
  const withTags = async (rows: CandidateRow[]) => {
    const tags = await store.allTags();
    return rows.map((r) => ({ ...r, tags: tags[r.symbol] ?? null }));
  };

  app.get("/radar/candidates", async (ctx) => {
    const q = ctx.req.query();
    let rows = await withTags(await store.latestCandidates());
    if (q["kind"]) rows = rows.filter((r) => r.kind === q["kind"]);
    if (q["verdict"]) rows = rows.filter((r) => r.verdict === q["verdict"]);
    if (q["sector"]) rows = rows.filter((r) => r.tags?.sector === q["sector"]);
    if (q["theme"]) rows = rows.filter((r) => r.tags?.themes.includes(q["theme"]!));
    if (q["assetClass"]) rows = rows.filter((r) => r.tags?.assetClass === q["assetClass"]);
    return ctx.json(rows);
  });
  app.get("/radar/candidates/:symbol", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    const cand = (await store.latestCandidates()).find((r) => r.symbol === symbol);
    if (!cand) return ctx.json({ error: "no es candidato vigente" }, 404);
    const [fundamentals, tags, profile] = await Promise.all([store.fundamentals(symbol), store.tags(symbol), store.profile(symbol)]);
    const keys = AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key));
    const peers: Array<{ symbol: string; metrics: Record<string, number | null> }> = [];
    for (const p of cand.peerGroup) {
      const f = await store.fundamentals(p);
      if (f) peers.push({ symbol: p, metrics: Object.fromEntries(keys.map((k) => [k, f.metrics[k] ?? null])) });
    }
    return ctx.json({ candidate: cand, fundamentals, tags: tags as Tags | null, profile: profile?.profile ?? null, peers });
  });
  app.get("/radar/etfs", async (ctx) => ctx.json(await withTags((await store.latestCandidates()).filter((r) => r.kind === "etf"))));

  app.post("/radar/scan", async (ctx) => {
    if (c.cfg && !c.cfg.finnhubToken) return ctx.json({ error: "FINNHUB_API_KEY requerida para barrer el universo" }, 400);
    if (state.scan.running) return ctx.json({ error: "ya hay un barrido corriendo" }, 409);
    const scanDate = ctx.req.query("scanDate") ?? today(ctx);
    const t = today(ctx);
    state.scan = { running: true, stopRequested: false, startedAt: new Date().toISOString(), progress: null, last: null };
    void scanUniverse(deps, { scanDate, today: t })
      .then((s) => { state.scan.last = s; })
      .catch((e) => { console.error("[radar] scan failed", e); })
      .finally(() => { state.scan.running = false; });
    return ctx.json({ started: true, scanDate }, 202);
  });
  app.post("/radar/scan/stop", (ctx) => {
    state.scan.stopRequested = true;
    return ctx.json({ stopRequested: true });
  });
  app.get("/radar/scan-status", async (ctx) => {
    const scanDate = ctx.req.query("scanDate") ?? (await store.latestScanDate());
    return ctx.json({ ...state.scan, scanDate, status: scanDate ? await store.scanStatus(scanDate) : null });
  });

  app.post("/radar/rank", async (ctx) => ctx.json(await rankRadar(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() })));
  app.post("/radar/refresh", async (ctx) => {
    const t = today(ctx);
    const r = await refreshRadar(deps, { today: t, portfolioUsd: await portfolioUsd() });
    const measured = await measureRadar(deps, { today: t });
    return ctx.json({ ...r, measured });
  });
  app.get("/radar/plan", async (ctx) => ctx.json(await store.latestPlan()));
  app.post("/radar/plan", async (ctx) => {
    const month = ctx.req.query("month") ?? new Date().toISOString().slice(0, 7);
    return ctx.json(await buildContributionPlan(deps, { month, portfolioUsd: await portfolioUsd() }));
  });
  app.get("/radar/measurement", async (ctx) => {
    const all = await store.allCandidates();
    return ctx.json({ total: all.length, ...summarizeRadar(all) });
  });
  return app;
}
