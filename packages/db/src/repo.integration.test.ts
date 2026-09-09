import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { Repo, createDb, schema } from "./index.js";

const url = process.env["DATABASE_URL"];
const d = url ? describe : describe.skip;

d("Repo (Postgres real)", () => {
  // Sin DATABASE_URL el describe está en skip, pero vitest igual evalúa el cuerpo: no abrir conexión.
  const db = (url ? createDb(url) : null) as ReturnType<typeof createDb>;
  const repo = new Repo(db);
  const ticker = `T${randomUUID().slice(0, 4).toUpperCase()}`;

  // Corre contra la DB que apunte DATABASE_URL (puede ser la de desarrollo): no dejar residuos,
  // o aparecen en calibración y como comparables del razonador.
  afterAll(async () => {
    const tsym = `T${ticker}`;
    await db.delete(schema.candlesDaily).where(eq(schema.candlesDaily.symbol, tsym));
    await db.delete(schema.news).where(eq(schema.news.symbol, tsym));
    await db.delete(schema.symbolMeta).where(eq(schema.symbolMeta.symbol, tsym));
    const rsym = `R${ticker}`;
    await db.delete(schema.radarCandidates).where(eq(schema.radarCandidates.symbol, rsym));
    await db.delete(schema.universeScan).where(eq(schema.universeScan.symbol, rsym));
    await db.delete(schema.fundamentals).where(eq(schema.fundamentals.symbol, rsym));
    await db.delete(schema.statements).where(eq(schema.statements.symbol, rsym));
    await db.delete(schema.symbolMeta).where(eq(schema.symbolMeta.symbol, rsym));
    await db.delete(schema.contributionPlans).where(eq(schema.contributionPlans.planMonth, "2099-01"));
    const csym = `C${ticker}`;
    await db.delete(schema.portfolioVerdicts).where(eq(schema.portfolioVerdicts.symbol, csym));
    await db.delete(schema.symbolMeta).where(eq(schema.symbolMeta.symbol, csym));
    await db.delete(schema.transactions).where(eq(schema.transactions.symbol, csym));
    await db.delete(schema.positions).where(eq(schema.positions.symbol, csym));
    await db.delete(schema.portfolioRisk).where(eq(schema.portfolioRisk.snapshotDate, "2099-01-01"));
    const mine = db.select({ id: schema.theses.id }).from(schema.theses).where(eq(schema.theses.ticker, ticker));
    await db.delete(schema.outcomes).where(inArray(schema.outcomes.thesisId, mine));
    await db.delete(schema.orders).where(eq(schema.orders.ticker, ticker));
    await db.delete(schema.theses).where(eq(schema.theses.ticker, ticker));
    await db.delete(schema.rawEvents).where(eq(schema.rawEvents.ticker, ticker));
    await db.delete(schema.promptVersions).where(eq(schema.promptVersions.version, "v-test"));
  });

  it("raw_events: inserta, dedupea y marca filtro", async () => {
    const ev = { id: randomUUID(), ticker, eventType: "earnings" as const, source: "manual" as const, eventDate: "2026-10-01", sourceRef: "ref1", title: "t", payload: { a: 1 }, observedAt: new Date().toISOString() };
    expect(await repo.insertRawEvents([ev])).toHaveLength(1);
    expect(await repo.insertRawEvents([{ ...ev, id: randomUUID() }])).toHaveLength(0);
    const pending = await repo.unfilteredEvents();
    expect(pending.some((e) => e.id === ev.id)).toBe(true);
    await repo.markFilter([{ id: ev.id, passed: true, reason: null }]);
    expect((await repo.unfilteredEvents()).some((e) => e.id === ev.id)).toBe(false);
  });

  it("theses/orders/outcomes: ciclo completo con numéricos correctos", async () => {
    const ev = { id: randomUUID(), ticker, eventType: "fda" as const, source: "manual" as const, eventDate: "2026-11-20", sourceRef: `ref-${randomUUID()}`, title: "pdufa", payload: {}, observedAt: new Date().toISOString() };
    await repo.insertRawEvents([ev]);
    await repo.ensurePromptVersion("v-test", "content");
    const t = await repo.insertThesis(ev.id, {
      ticker, eventType: "fda", eventDate: "2026-11-20", direction: "long", pEstimate: 0.7123, pMarket: 0.5, instrument: "call", entryMax: 1.25, target: 15,
      invalidation: "CRL anunciado antes de la fecha PDUFA por la FDA.", confidence: "high", reasoning: "Razonamiento de prueba con más de cincuenta caracteres para validar.", sources: ["x"],
    }, "v-test", 0.1);
    expect(t.status).toBe("proposed");
    expect(t.edge).toBeCloseTo(0.2123, 4);
    expect(typeof t.pEstimate).toBe("number");

    await repo.setThesisStatus(t.id, "approved", { humanDecision: "approve" });
    await repo.insertOrder({ id: randomUUID(), thesisId: t.id, ticker, instrument: "call", symbol: `${ticker}261120C00015000`, side: "buy", qty: 10, limitPrice: 1.2, notionalUsd: 1200, brokerOrderId: "b1", status: "submitted", filledQty: 0, avgFillPrice: null, submittedAt: new Date().toISOString(), filledAt: null });
    await repo.setThesisStatus(t.id, "open");
    const open = await repo.openOrders();
    const mine = open.find((o) => o.thesisId === t.id)!;
    expect(mine.notionalUsd).toBe(1200);
    await repo.updateOrder({ ...mine, status: "filled", filledQty: 10, avgFillPrice: 1.15, filledAt: new Date().toISOString() });
    expect((await repo.ordersForThesis(t.id))[0]?.avgFillPrice).toBe(1.15);

    await repo.insertOutcome({ thesisId: t.id, predictedOutcomeHappened: true, pnlUsd: 800, pnlPct: 69.5652, closeReason: "event_resolved", closedAt: new Date().toISOString(), notes: "" });
    await repo.setThesisStatus(t.id, "closed");
    const comps = await repo.comparables("fda");
    expect(comps.some((c) => c.thesis.id === t.id && c.outcome.pnlUsd === 800)).toBe(true);
    expect((await repo.thesesByStatus("closed")).some((x) => x.id === t.id)).toBe(true);
  });

  it("cartera: posiciones, operaciones, perfil, veredictos, medición y riesgo", async () => {
    const sym = `C${ticker}`;
    await repo.upsertPosition({ symbol: sym, quantity: 10, avgCost: 5, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await repo.upsertPosition({ symbol: sym, quantity: 12, avgCost: 5.5, currency: "USD", market: "us", layer: "riesgo", notes: "x" });
    expect((await repo.positions()).find((p) => p.symbol === sym)?.quantity).toBe(12);

    const tx = { id: randomUUID(), symbol: sym, type: "BUY" as const, quantity: 1, price: 2, fees: 0, date: "2026-01-02", currency: "USD", platform: "Nexo", externalId: `ext-${sym}`, notes: null };
    expect(await repo.insertTransactions([tx, { ...tx, id: randomUUID() }])).toBe(1);
    expect((await repo.transactions()).some((t) => t.symbol === sym && t.externalId === `ext-${sym}`)).toBe(true);

    await repo.saveProfile({ symbol: sym, name: "N", country: "US", industry: "I", marketCap: 1 });
    expect((await repo.profile(sym))?.profile.country).toBe("US");
    expect(await repo.recentFilingTitles(sym, 5)).toEqual([]);

    const row = { verdictDate: "2099-01-01", symbol: sym, verb: "MANTENER" as const, reason: "r", narrative: null, warning: null, close: 10, spot: 10, stop: 9, target: 12, gainPct: 100, weightPct: 50, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null };
    await repo.upsertVerdicts([row]);
    await repo.upsertVerdicts([{ ...row, reason: "r2" }]);
    expect((await repo.latestVerdicts()).find((v) => v.symbol === sym)?.reason).toBe("r2");
    expect((await repo.verdictsToMeasure("2099-01-08", 7)).some((v) => v.symbol === sym)).toBe(true);
    await repo.setMeasurement("2099-01-01", sym, { close7d: 11, spy7d: 505, alpha7dPct: 9 });
    expect((await repo.verdictsToMeasure("2099-01-08", 7)).some((v) => v.symbol === sym)).toBe(false);
    expect((await repo.allVerdicts()).find((v) => v.symbol === sym)?.alpha7dPct).toBe(9);

    const report = { totalValue: 1, weights: [], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] };
    await repo.saveRisk("2099-01-01", report);
    await repo.saveRisk("2099-01-01", { ...report, totalValue: 2 });
    expect((await repo.latestRisk())?.report.totalValue).toBe(2);
  });

  it("radar: etiquetas, fundamentals, barrido, candidatos y planes", async () => {
    const sym = `R${ticker}`;
    await repo.saveTags(sym, { assetClass: "accion_us", sector: "Tecnología", industry: "Semiconductors", themes: ["IA"], themesSource: "regla" });
    await repo.saveTags(sym, { assetClass: "accion_us", sector: "Tecnología", industry: "Semiconductors", themes: ["IA", "semiconductores"], themesSource: "manual" });
    expect((await repo.tags(sym))?.themesSource).toBe("manual");
    expect((await repo.allTags())[sym]?.themes).toEqual(["IA", "semiconductores"]);

    const fund = { symbol: sym, asOf: "2099-01-01", metrics: { peTTM: 20 }, peers: ["AAA"], industry: "Semiconductors", mcapUsd: 1e9, dollarVolumeUsd: 2e7, priceUsd: 10, nextEarnings: null, insiderBuys90d: 1, insiderSells90d: 0, analyst: null, earningsSurprises: null };
    await repo.saveFundamentals(fund);
    await repo.saveFundamentals({ ...fund, metrics: { peTTM: 21 } });
    expect((await repo.fundamentals(sym))?.metrics["peTTM"]).toBe(21);
    expect((await repo.freshFundamentals(7, "2099-01-05")).some((f) => f.symbol === sym)).toBe(true);
    expect((await repo.freshFundamentals(7, "2099-02-05")).some((f) => f.symbol === sym)).toBe(false);

    await repo.scanUpsert([{ scanDate: "2099-01-01", symbol: sym, stage: "alpaca_ok", reason: null }]);
    expect(await repo.scanPending("2099-01-01")).toContain(sym);
    await repo.scanUpsert([{ scanDate: "2099-01-01", symbol: sym, stage: "finnhub_ok", reason: null }]);
    expect(await repo.scanPending("2099-01-01")).not.toContain(sym);
    expect((await repo.scanStatus("2099-01-01")).finnhub_ok).toBeGreaterThanOrEqual(1);
    expect(await repo.latestScanDate()).toBe("2099-01-01");

    const cand = { candidateDate: "2099-01-01", symbol: sym, kind: "stock" as const, verdict: "COMPRAR" as const, score: 1.2, axes: { valuation: 1 }, peerGroup: ["AAA"], rankInGroup: 1, groupSize: 5, close: 10, entryLow: 10, entryHigh: 10.2, stop: 9, target: 12, sizeUsd: 1000, sizeQty: 98, riskScore: 3, flags: ["dividendo"], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: 500, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await repo.upsertCandidates([cand]);
    await repo.upsertCandidates([{ ...cand, score: 1.5 }]);
    expect((await repo.latestCandidates()).find((c) => c.symbol === sym)?.score).toBe(1.5);
    // Última fecha por familia: una fila argentina más nueva no esconde el último ranking US.
    await repo.upsertCandidates([{ ...cand, candidateDate: "2099-01-02", kind: "ar", verdict: "OBSERVAR", score: null }]);
    const latest = (await repo.latestCandidates()).filter((c) => c.symbol === sym);
    expect(latest.map((c) => `${c.kind}:${c.candidateDate}`).sort()).toEqual(["ar:2099-01-02", "stock:2099-01-01"]);
    await db.delete(schema.radarCandidates).where(and(eq(schema.radarCandidates.symbol, sym), eq(schema.radarCandidates.candidateDate, "2099-01-02")));
    expect((await repo.candidateHistory(sym, 4)).length).toBe(1);
    expect((await repo.candidatesToMeasure("2099-01-08", 7)).some((c) => c.symbol === sym)).toBe(true);
    await repo.setCandidateMeasurement("2099-01-01", sym, { close7d: 11, spy7d: 505, alpha7dPct: 9 });
    expect((await repo.candidatesToMeasure("2099-01-08", 7)).some((c) => c.symbol === sym)).toBe(false);
    expect((await repo.allCandidates()).find((c) => c.symbol === sym)?.alpha7dPct).toBe(9);

    const plan = { month: "2099-01", totalUsd: 6500, lines: [{ symbol: sym, kind: "comprar" as const, amountUsd: 6500, rationale: "r", close: 10, spyClose: 500, alpha30dPct: null, alpha90dPct: null }], notes: [] };
    await repo.savePlan(plan);
    await repo.savePlan({ ...plan, totalUsd: 6600 });
    expect((await repo.latestPlan())?.totalUsd).toBe(6600);
    expect((await repo.plansToMeasure("2099-03-01")).some((p) => p.month === "2099-01")).toBe(true);
    await repo.updatePlanLines("2099-01", [{ ...plan.lines[0]!, alpha30dPct: 2, alpha90dPct: 3 }]);
    expect((await repo.plansToMeasure("2099-05-01")).some((p) => p.month === "2099-01")).toBe(false);
  });

  it("statements: upsert y lectura", async () => {
    const rsym = `R${ticker}`;
    await repo.saveStatements({ symbol: rsym, cik: "1", asOf: "2026-09-09", quarters: [], core: null });
    await repo.saveStatements({ symbol: rsym, cik: "2", asOf: "2026-09-10", quarters: [], core: null });
    expect((await repo.statements(rsym))?.cik).toBe("2");
  });

  it("fundamentals: metricsRaw y statementsAsOf van y vienen; la clave se omite (no null) cuando nunca se guardó o se guardó null", async () => {
    const sym = `R${ticker}`;
    const base = { symbol: sym, asOf: "2026-09-09", metrics: { peTTM: 20 }, peers: [] as string[], industry: "Semiconductors", mcapUsd: 1e9, dollarVolumeUsd: 2e7, priceUsd: 10, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null };

    await repo.saveFundamentals(base);
    let f = await repo.fundamentals(sym);
    expect(f && "statementsAsOf" in f).toBe(false);
    expect(f?.metricsRaw ?? null).toBeNull();

    await repo.saveFundamentals({ ...base, metricsRaw: { peTTM: 12.8 }, statementsAsOf: "2026-06-30" });
    f = await repo.fundamentals(sym);
    expect(f?.metricsRaw?.["peTTM"]).toBe(12.8);
    expect(f?.statementsAsOf).toBe("2026-06-30");

    // La columna no distingue "nunca se intentó" de "se intentó y no hay": guardar statementsAsOf null también
    // vuelve a omitir la clave al leer. La señal autorizada de "se intentó" es la fila de `statements` (quarters: [], core: null), no este campo.
    await repo.saveFundamentals({ ...base, metricsRaw: { peTTM: 12.8 }, statementsAsOf: null });
    f = await repo.fundamentals(sym);
    expect(f && "statementsAsOf" in f).toBe(false);
  });

  it("ticker: descripción, velas diarias y noticias", async () => {
    const sym = `T${ticker}`;
    await repo.saveDescription({ symbol: sym, longName: "Test Inc", summary: "hace cosas", employees: 10, website: "test.com", exchangeName: "NYSE", firstTradeDate: "2000-01-01", sector: "Tech", industry: "Soft", country: "US", updatedAt: "2099-01-01T00:00:00.000Z" });
    expect((await repo.description(sym))?.summary).toBe("hace cosas");
    await repo.upsertCandles(sym, [{ date: "2099-01-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }, { date: "2099-01-02", open: 1.5, high: 2, low: 1, close: 1.8, volume: 20 }]);
    await repo.upsertCandles(sym, [{ date: "2099-01-02", open: 1.5, high: 2.2, low: 1, close: 1.9, volume: 25 }]);
    const c = await repo.candles(sym, "2099-01-01");
    expect(c.map((x) => x.close)).toEqual([1.5, 1.9]);
    expect(await repo.candles(sym, "2099-01-02")).toHaveLength(1);
    const n = { symbol: sym, date: "2099-01-01", headline: "h", source: "s", url: `https://x/${sym}`, summary: null };
    expect(await repo.upsertNews([n, { ...n, headline: "h2" }])).toBe(1);
    expect((await repo.news(sym, 10))[0]?.headline).toBe("h");
  });
});
