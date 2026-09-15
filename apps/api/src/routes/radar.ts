import { Hono } from "hono";
import { todayLocal, AXES, AXIS_METRICS, assessRegime, groupMedians, summarizeRadar, topPicks, type CandidateRow, type Tags } from "@thesis/core";
import { TNX_SYMBOL, buildContributionPlan, candidateOverlap, measureRadar, rankRadar, refreshArgentina, refreshRadar, refreshWatchlist, replan, scanUniverse } from "@thesis/pipeline";
import type { Container } from "../container.js";
import { state } from "../container.js";

/** Rutas del Radar (spec etapa 2 §12). El barrido corre en segundo plano y se consulta por estado. */
export function radarRoutes(c: Container) {
  const app = new Hono();
  const deps = c.radarDeps;
  const store = deps.store;
  const today = (ctx: { req: { query: (k: string) => string | undefined } }) => ctx.req.query("today") ?? todayLocal();
  const portfolioUsd = async () => (await store.latestRisk())?.report.totalValue ?? null;
  /** Candidatos vigentes, o los de una corrida anterior con ?date=. */
  const candidatesAt = async (ctx: { req: { query: (k: string) => string | undefined } }) => { const d = ctx.req.query("date"); return d ? store.candidatesForDate(d) : store.latestCandidates(); };
  const withTags = async (rows: CandidateRow[]) => {
    const tags = await store.allTags();
    return rows.map((r) => ({ ...r, tags: tags[r.symbol] ?? null }));
  };

  app.get("/radar/candidates", async (ctx) => {
    const q = ctx.req.query();
    let rows = await withTags(await candidatesAt(ctx));
    if (q["kind"]) rows = rows.filter((r) => r.kind === q["kind"]);
    if (q["verdict"]) rows = rows.filter((r) => r.verdict === q["verdict"]);
    if (q["sector"]) rows = rows.filter((r) => r.tags?.sector === q["sector"]);
    if (q["theme"]) rows = rows.filter((r) => r.tags?.themes.includes(q["theme"]!));
    if (q["assetClass"]) rows = rows.filter((r) => r.tags?.assetClass === q["assetClass"]);
    return ctx.json(rows);
  });
  /** Los COMPRAR con más convicción: todos los factores en un número y en palabras. */
  app.get("/radar/top", async (ctx) => {
    const n = Math.max(1, Math.min(20, Number(ctx.req.query("n") ?? 5) || 5));
    const rows = await candidatesAt(ctx);
    const tags = await store.allTags();
    // Temas donde la cartera ya supera el umbral del panel de riesgo (40%): un candidato ahí suma menos.
    const d = ctx.req.query("date");
    const byTheme = (d ? await store.riskForDate(d) : await store.latestRisk())?.report.concentration.byTheme ?? {};
    const overweight = Object.fromEntries(Object.entries(byTheme).filter(([, pct]) => pct > 40));
    // Candidatos que se mueven como algo que ya tenés: mismo riesgo con otro nombre, suma menos.
    const overlap = await candidateOverlap(store, rows, deps.etfs.filter((e) => e.role === "nucleo").map((e) => e.symbol));
    // Régimen macro desde el 10 años guardado por el plan (sin volver a pedirlo a Yahoo).
    const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10);
    const regime = assessRegime(await store.candles(TNX_SYMBOL, since).catch(() => []));
    const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
    const picks = topPicks(rows, tags, overweight, n, overlap, regime).map((p) => {
      const r = bySymbol.get(p.symbol)!;
      return { ...p, close: r.close, entryHigh: r.entryHigh, stop: r.stop, target: r.target, sizeUsd: r.sizeUsd, sizeQty: r.sizeQty, riskScore: r.riskScore, score: r.score, rankInGroup: r.rankInGroup, groupSize: r.groupSize, summary: r.summary, mainRisk: r.mainRisk, tags: tags[p.symbol] ?? null };
    });
    return ctx.json({ date: rows[0]?.candidateDate ?? null, overweight, regime, picks });
  });
  /**
   * Argentina (etapa 3): macro del día y su serie; las empresas con ADR en Nueva York, en dólares contra el
   * SPY (lo que el dueño puede comprar); y aparte, lo que solo se compra en pesos (BYMA sin ADR y CEDEARs).
   */
  app.get("/radar/argentina", async (ctx) => {
    const d = ctx.req.query("date");
    const [macro, series, rows] = await Promise.all([d ? store.macroArForDate(d) : store.latestMacroAr(), store.macroArSeries(60), withTags(await candidatesAt(ctx))]);
    const config = c.argentinaDeps.config.acciones;
    // Los ADR que el Radar de acciones ya evalúa (con fundamentals contra pares) no tienen fila "adr": se
    // muestra la del Radar, que es la misma empresa medida con un motor más completo. Sin esto, PAM
    // desaparecía de la tabla de Argentina justo por estar en la otra.
    const adrDe = new Map(config.filter((a) => a.adr).map((a) => [a.adr!, a.symbol]));
    const propias = rows.filter((r) => r.kind === "adr");
    const conFila = new Set(propias.map((r) => r.symbol));
    const delRadar = rows.filter((r) => r.kind === "stock" && adrDe.has(r.symbol) && !conFila.has(r.symbol)).map((r) => ({ ...r, peerGroup: [adrDe.get(r.symbol)!] }));
    const sinAdr = new Set(config.filter((a) => !a.adr).map((a) => a.symbol));
    return ctx.json({
      macro, series,
      adrs: [...propias, ...delRadar],
      acciones: rows.filter((r) => r.kind === "ar" && sinAdr.has(r.symbol)),
      cedears: rows.filter((r) => r.kind === "cedear"),
    });
  });
  app.post("/radar/argentina", async (ctx) => {
    const r = await refreshArgentina(c.argentinaDeps, { today: today(ctx) });
    return ctx.json({ macro: r.macro, acciones: r.acciones, adrs: r.adrs, cedears: r.cedears, errors: r.errors });
  });
  /** Lista de seguimiento: tickers elegidos a mano con veredicto diario aunque el ranking no los elija. */
  const watchPayload = async (date?: string) => {
    const items = await store.watchlist();
    const set = new Set(items.map((i) => i.symbol));
    const rows = (await withTags(date ? await store.candidatesForDate(date) : await store.latestCandidates())).filter((r) => r.kind === "watch" && set.has(r.symbol));
    return { items, rows };
  };
  app.get("/radar/watchlist", async (ctx) => ctx.json(await watchPayload(ctx.req.query("date"))));
  app.post("/radar/watchlist", async (ctx) => {
    const body = await ctx.req.json<{ symbol?: string; note?: string }>().catch(() => ({}) as { symbol?: string; note?: string });
    const symbol = (body.symbol ?? "").trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return ctx.json({ error: "símbolo inválido" }, 400);
    // Foto del alta (ciclo de vida): precio vivo (o último cierre) y, si el Radar ya lo conoce, su stop, objetivo y tesis.
    const row = (await store.latestCandidates()).find((r) => r.symbol === symbol && r.kind !== "cedear");
    const live = (await c.pricesDeps.quotes([symbol]).catch(() => []))[0] ?? null;
    const entryPrice = live?.price ?? row?.close ?? (await store.candles(symbol, "2000-01-01")).at(-1)?.close ?? null;
    // Solo un COMPRAR tiene ticket válido (stop por debajo del precio); un OBSERVAR bajo el stop no lleva niveles: vive o expira.
    const ticket = row?.verdict === "COMPRAR" ? { targetPrice: row.target, stopLoss: row.stop } : { targetPrice: null, stopLoss: null };
    await store.addWatch(symbol, { note: body.note ?? null, entryPrice, entryAction: row?.verdict ?? "manual", ...ticket, thesis: row?.summary ?? null, horizonDays: 30 });
    const r = await refreshWatchlist(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() });
    await replan(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return ctx.json({ ...(await watchPayload()), refreshed: r });
  });
  app.delete("/radar/watchlist/:symbol", async (ctx) => {
    await store.removeWatch(ctx.req.param("symbol"));
    // Sin esto el plan seguía comprando como "seguimiento" algo que ya no seguías, hasta la corrida del día siguiente.
    await store.pruneCandidates(today(ctx), "watch", (await store.watchlist()).map((w) => w.symbol)).catch(() => 0);
    await replan(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return ctx.json(await watchPayload());
  });
  app.post("/radar/watchlist/refresh", async (ctx) => {
    const r = await refreshWatchlist(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() });
    await replan(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return ctx.json(r);
  });
  app.get("/radar/candidates/:symbol", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    const cand = (await store.latestCandidates()).find((r) => r.symbol === symbol);
    if (!cand) return ctx.json({ error: "no es candidato vigente" }, 404);
    const since = new Date(Date.parse(today(ctx)) - 90 * 86_400_000).toISOString().slice(0, 10);
    const [fundamentals, tags, profile, statements, events, analystActions, newsScannedTo] = await Promise.all([store.fundamentals(symbol), store.tags(symbol), store.profile(symbol), store.statements(symbol), store.eventsFor(symbol, since), store.analystActions(symbol, since), store.newsScannedTo(symbol)]);
    const keys = AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key));
    const peers: Array<{ symbol: string; metrics: Record<string, number | null> }> = [];
    for (const p of cand.peerGroup) {
      const f = await store.fundamentals(p);
      if (f) peers.push({ symbol: p, metrics: Object.fromEntries(keys.map((k) => [k, f.metrics[k] ?? null])) });
    }
    const verification = await store.verification(symbol).catch(() => null);
    // La mediana del grupo sale del mismo cálculo que el puntaje (propia incluida, mismas reglas), no se
    // recalcula en el navegador: ver `groupMedians`.
    const medians = fundamentals ? groupMedians([fundamentals, ...peers]) : null;
    return ctx.json({ candidate: cand, fundamentals, tags: tags as Tags | null, profile: profile?.profile ?? null, peers, medians, statements, events: events.filter((e) => e.severity !== "ruido"), analystActions, newsScannedTo, verification });
  });
  app.get("/radar/etfs", async (ctx) => ctx.json(await withTags((await candidatesAt(ctx)).filter((r) => r.kind === "etf"))));

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

  // Toda corrida que cambia las candidatas rearma el plan con el último monto: el plan es la única fuente de COMPRAR (14/9).
  app.post("/radar/rank", async (ctx) => {
    const r = await rankRadar(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() });
    await replan(deps, { today: today(ctx), portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return ctx.json(r);
  });
  app.post("/radar/refresh", async (ctx) => {
    const t = today(ctx);
    const r = await refreshRadar(deps, { today: t, portfolioUsd: await portfolioUsd() });
    const measured = await measureRadar(deps, { today: t });
    await replan(deps, { today: t, portfolioUsd: await portfolioUsd() }).catch((e: unknown) => { console.error("[plan] no se pudo rearmar", e); return null; });
    await c.controlar?.().catch(() => null);
    return ctx.json({ ...r, measured });
  });
  app.get("/radar/plan", async (ctx) => ctx.json(await store.latestPlan()));
  app.post("/radar/plan", async (ctx) => {
    const month = ctx.req.query("month") ?? new Date().toISOString().slice(0, 7);
    // ?amount=40000: plan para un monto líquido en vez del aporte mensual.
    const amount = Number(ctx.req.query("amount"));
    const plan = await buildContributionPlan(deps, { month, portfolioUsd: await portfolioUsd(), ...(amount > 0 ? { amountUsd: amount } : {}) });
    await c.controlar?.().catch(() => null);
    return ctx.json(plan);
  });
  app.get("/radar/measurement", async (ctx) => {
    const all = await store.allCandidates();
    return ctx.json({ total: all.length, ...summarizeRadar(all, today(ctx)) });
  });
  return app;
}
