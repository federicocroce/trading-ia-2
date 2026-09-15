import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DefaultFilter, DefaultRiskEngine, type Broker, type MarketData, type Order, type OrderIntent, type RawEvent, type Reasoner } from "@thesis/core";
import { MemoryStore, buildSnapshot } from "@thesis/pipeline";
import { buildApp } from "./index.js";
import { state, type Container } from "../container.js";

const marketData: MarketData = {
  getQuote: async (t) => ({ ticker: t, price: 10, asOf: "", avgVolume30d: 1_000_000 }),
  getImpliedMove: async () => null,
  findOption: async () => null,
};
const broker: Broker & { n: number } = {
  paper: true, n: 0,
  async submit(i: OrderIntent): Promise<Order> { this.n++; return { ...i, id: randomUUID(), brokerOrderId: "b", status: "filled", filledQty: i.qty, avgFillPrice: i.limitPrice, submittedAt: "t", filledAt: "t" }; },
  async getOrder() { throw new Error("x"); },
  async cancel() {},
};
const event: RawEvent = { id: randomUUID(), ticker: "XXXX", eventType: "earnings", source: "manual", eventDate: "2026-09-25", sourceRef: "r", title: "Earnings", payload: {}, observedAt: "2026-09-04T00:00:00Z" };
const reasoner: Reasoner = {
  promptVersion: "v-test",
  propose: async (b) => ({ ticker: b.event.ticker, eventType: "earnings", eventDate: b.event.eventDate, direction: "long", pEstimate: 0.7, pMarket: 0.5, instrument: "stock", entryMax: 10.5, target: 11, invalidation: "Preanuncio negativo de guidance antes del reporte.", confidence: "med", reasoning: "Razonamiento de prueba suficientemente largo para pasar la validación mínima.", sources: ["s"] }),
};

let failRadar = false;
function container(): Container {
  const store = new MemoryStore();
  const account = async () => ({ equity: 100_000, lastEquity: 100_000 });
  return {
    cfg: {} as never,
    store,
    carteraDeps: { store, history: { candles: async () => [] }, profiles: { profile: async () => null }, narrator: null, spot: async () => null },
    radarDeps: { store, taxonomy: { sectors: [], themes: [], industryToSector: {}, industryToThemes: {}, symbolToThemes: {}, symbolToAssetClass: {} } } as never,
    tickerDeps: { store } as never,
    argentinaDeps: { store } as never,
    pricesDeps: { quotes: async () => [] },
    symbolSearch: { search: async () => [] },
    catchupRunners: Object.fromEntries(["scan", "cartera", "radar", "argentina", "plan", "tesis"].map((id) => [id, async () => { if (id === "radar" && failRadar) throw new Error("finnhub 429"); return `${id} corrido`; }])) as never,
    marketData,
    broker,
    risk: new DefaultRiskEngine(),
    runDeps: { store, ingestors: [{ source: "manual", fetch: async () => [event] }], filter: new DefaultFilter(marketData.getQuote), reasoner, documents: { documentsFor: async () => [] }, marketData, minEdge: 0.1, maxCandidates: 5 },
    snapshot: async () => buildSnapshot(store, await account(), state.killSwitch),
    account,
  };
}

describe("API routes", () => {
  it("run → theses → approve → portfolio → close → calibration", { timeout: 30_000 }, async () => {
    const app = buildApp(container());
    expect((await app.request("/health")).status).toBe(200);

    const run = await (await app.request("/run", { method: "POST" })).json();
    expect(run.proposed).toHaveLength(1);
    const id = run.proposed[0].id;

    const list = await (await app.request("/theses?status=proposed")).json();
    expect(list).toHaveLength(1);

    const detail = await (await app.request(`/theses/${id}`)).json();
    expect(detail.event.title).toBe("Earnings");

    const approve = await app.request(`/theses/${id}/approve`, { method: "POST" });
    expect(approve.status).toBe(200);
    expect((await approve.json()).order.qty).toBe(1000);

    const pf = await (await app.request("/portfolio")).json();
    expect(pf.snapshot.openByEventType.earnings).toBe(10_000);

    const bad = await app.request(`/theses/${id}/close`, { method: "POST", body: JSON.stringify({ closeReason: "nope" }), headers: { "Content-Type": "application/json" } });
    expect(bad.status).toBe(400);

    const close = await app.request(`/theses/${id}/close`, { method: "POST", body: JSON.stringify({ predictedOutcomeHappened: false, closeReason: "invalidation" }), headers: { "Content-Type": "application/json" } });
    expect(close.status).toBe(200);

    const cal = await (await app.request("/calibration")).json();
    expect(cal.closed).toBe(1);
    expect(cal.hitRate).toBe(0);
    expect(cal.criteria.readyForRealMoney).toBe(false);
  });

  it("kill switch bloquea aprobaciones", async () => {
    const app = buildApp(container());
    await app.request("/kill-switch", { method: "POST", body: JSON.stringify({ on: true }), headers: { "Content-Type": "application/json" } });
    const run = await (await app.request("/run", { method: "POST" })).json();
    const res = await app.request(`/theses/${run.proposed[0].id}/approve`, { method: "POST" });
    expect(res.status).toBe(422);
    expect((await res.json()).reason).toBe("kill_switch");
    await app.request("/kill-switch", { method: "POST", body: JSON.stringify({ on: false }), headers: { "Content-Type": "application/json" } });
  });
});

/**
 * 15/9: el 6-K de Vista tenía cinco tesis propuestas vivas con objetivos de 82 a 88, y el Historial cortaba en 200 de
 * 249 sin decirlo. Propuestas muestra una sola por evento (la última lectura) aunque la corrida todavía no haya
 * retirado las viejas; el Historial las muestra como reemplazadas y dice cuántas hay en total.
 */
describe("/theses: una tesis viva por evento y el total del historial", () => {
  const VIST = "cb3536a7-112c-4ee5-b520-7da6f7784e6b";
  const t = (id: number, createdAt: string, o: Record<string, unknown> = {}) => ({
    id: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`, rawEventId: VIST, ticker: "VIST", eventType: "operational" as const, eventDate: null, direction: "long" as const, pEstimate: 0.65, pMarket: 0.5, edge: 0.15,
    instrument: "stock" as const, entryMax: 80, target: 88, invalidation: "Si el precio cierra por debajo del mínimo de la semana.", confidence: "med" as const,
    reasoning: "Razonamiento de prueba suficientemente largo para pasar la validación mínima de caracteres.", sources: ["s"], status: "proposed" as const, rejectionReason: null,
    promptVersion: "v-test", createdAt, updatedAt: createdAt, ...o,
  });

  it("Propuestas: de las cinco de VIST queda la última; Historial: las otras cuatro, reemplazadas por esa", async () => {
    const c = container();
    const store = c.store as MemoryStore;
    const vist = [t(1, "2026-09-08T15:34:36.425Z", { target: 82.6 }), t(2, "2026-09-09T13:50:45.492Z", { target: 85.5 }), t(3, "2026-09-09T14:18:30.334Z", { target: 84 }), t(4, "2026-09-09T14:36:07.517Z", { target: 82 }), t(5, "2026-09-11T10:40:08.657Z", { target: 88 })];
    for (const x of vist) store.theses.set(x.id, x);
    const app = buildApp(c);
    const vivas = await (await app.request("/theses?status=proposed")).json();
    expect(vivas.map((x: { target: number }) => x.target)).toEqual([88]);
    const historial = await (await app.request("/theses?status=closed,rejected")).json();
    expect(historial).toHaveLength(4);
    for (const x of historial) expect(x.reemplazadaPor).toMatchObject({ id: vist[4]!.id, createdAt: "2026-09-11T10:40:08.657Z" });
    expect(await (await app.request("/theses/total?status=closed,rejected")).json()).toEqual({ total: 4, limit: 200 });
  });

  it("el historial dice cuántas hay aunque muestre solo las 200 más nuevas (el 15/9: 200 de 249)", async () => {
    const c = container();
    const store = c.store as MemoryStore;
    for (let i = 0; i < 249; i++) {
      const x = t(1000 + i, new Date(Date.parse("2026-09-01T10:00:00Z") + i * 60_000).toISOString(), { rawEventId: `00000000-0000-4000-9000-${String(i).padStart(12, "0")}`, status: "rejected", rejectionReason: "edge_below_threshold" });
      store.theses.set(x.id, x);
    }
    const app = buildApp(c);
    const lista = await (await app.request("/theses?status=closed,rejected")).json();
    expect(lista).toHaveLength(200);
    expect(lista[0].createdAt > lista[199].createdAt).toBe(true);
    expect(await (await app.request("/theses/total?status=closed,rejected")).json()).toEqual({ total: 249, limit: 200 });
  });
});

describe("/catchup: estado por paso y corrida individual", () => {
  it("un paso que falla queda registrado con su error y sigue pendiente; se puede correr solo desde su botón", async () => {
    const c = container();
    const app = buildApp(c);
    state.lastRun = null;
    state.catchup = { running: false, last: null, current: null };
    failRadar = true;
    const run = await (await app.request("/catchup", { method: "POST" })).json();
    expect(run.ran.find((r: { id: string }) => r.id === "radar")).toMatchObject({ ok: false, detail: "finnhub 429" });
    const st = await (await app.request("/catchup")).json();
    const radar = st.steps.find((s: { id: string }) => s.id === "radar");
    expect(radar).toMatchObject({ label: expect.any(String), due: true, lastError: "finnhub 429" });
    expect(radar.lastErrorAt).toBeTruthy();
    expect(st.steps.find((s: { id: string }) => s.id === "cartera")).toMatchObject({ due: false, lastError: null });
    expect(st.lastRunAt).toBeTruthy();
    // Corrida individual: solo ese paso, aunque no esté pendiente; el error se limpia al salir bien.
    failRadar = false;
    const one = await (await app.request("/catchup/run/radar", { method: "POST" })).json();
    expect(one.ran.map((r: { id: string; ok: boolean }) => [r.id, r.ok])).toEqual([["radar", true]]);
    const after = await (await app.request("/catchup")).json();
    expect(after.steps.find((s: { id: string }) => s.id === "radar")).toMatchObject({ due: false, lastError: null });
    expect((await app.request("/catchup/run/nada", { method: "POST" })).status).toBe(400);
  });
});

describe("/catchup: de dónde sale cada hora (C8, 15/9)", () => {
  it("con job_runs viejo, 5 de 6 pasos mostraban \"—\": un paso fechado por la base dice que la hora no se conoce, el plan usa la hora en que se armó y la hora del botón dice de qué paso es", async () => {
    const c = container();
    const app = buildApp(c);
    state.lastRun = null;
    state.catchup = { running: false, last: null, current: null };
    // Como el 15/9: el registro de corridas marca el 11/9 para Cartera, pero la base ya tiene los veredictos del 15/9.
    await c.store.markJobRun("cartera", "2026-09-11", "8 veredictos, 0 errores");
    await c.store.upsertVerdicts([{ verdictDate: "2026-09-15", symbol: "TSM", verb: "SUMAR", reason: "r", narrative: null, warning: null, close: 418.01, spot: 418.6, stop: 412.81, target: 533.92, gainPct: 11, weightPct: 7.02, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    await c.store.savePlan({ month: "2026-09", totalUsd: 40_000, lines: [], notes: [] } as never);
    await c.store.markJobRun("tesis", "2026-09-15", "0 propuestas, 7 rechazadas, 0 errores");
    const st = await (await app.request("/catchup")).json();
    const paso = (id: string) => st.steps.find((s: { id: string }) => s.id === id);
    expect(paso("cartera")).toMatchObject({ lastDate: "2026-09-15", ranAt: null, ranAtSource: "base" });
    expect(paso("plan")).toMatchObject({ ranAt: (await c.store.latestPlan())!.builtAt, ranAtSource: "base" });
    expect(paso("tesis").ranAtSource).toBe("registro");
    expect(paso("scan")).toMatchObject({ lastDate: null, ranAt: null, ranAtSource: null });
    // La hora del botón es la de un paso concreto, y la respuesta dice cuál.
    expect(paso(st.lastRunStep).ranAt).toBe(st.lastRunAt);
  });
});

describe("/catchup", () => {
  it("lista lo pendiente, corre solo eso, lo registra y no lo repite", async () => {
    const c = container();
    const app = buildApp(c);
    const store = c.store;
    // Estado compartido del proceso: que no dependa de lo que hicieron otros tests.
    state.lastRun = null;
    state.catchup = { running: false, last: null, current: null };
    const before = await (await app.request("/catchup")).json();
    expect(before.due.map((d: { id: string }) => d.id)).toEqual(["scan", "cartera", "radar", "argentina", "plan", "tesis"]);
    const run = await (await app.request("/catchup", { method: "POST" })).json();
    expect(run.ran.map((r: { id: string; ok: boolean }) => `${r.id}:${r.ok}`)).toEqual(["scan:true", "cartera:true", "radar:true", "argentina:true", "plan:true", "tesis:true"]);
    const jobs = await store.jobRuns();
    // El barrido se registra cuando termina en segundo plano; los demás quedan registrados ya.
    expect(Object.keys(jobs).sort()).toEqual(["argentina", "cartera", "plan", "radar", "tesis"]);
    const after = await (await app.request("/catchup")).json();
    expect(after.due.map((d: { id: string }) => d.id)).toEqual(["scan"]);
    expect(after.lastResult.ran).toHaveLength(6);
    const again = await (await app.request("/catchup", { method: "POST" })).json();
    expect(again.ran.map((r: { id: string }) => r.id)).toEqual(["scan"]);
  });
});

describe("/usage: registro de uso de fuentes externas", () => {
  it("resume el día pedido por fuente, Gemini por modelo y clave, y por paso; fecha inválida da 400", async () => {
    const c = container();
    const app = buildApp(c);
    const row = (o: Record<string, unknown>) => ({ id: String(Math.random()), at: "2099-03-04T15:00:00.000Z", source: "finnhub", step: "radar", purpose: null, symbol: null, endpoint: "finnhub.io/api/v1/quote", model: null, keyIndex: null, status: 200, result: "ok", tokensIn: null, tokensOut: null, tokensThink: null, ms: 8, ...o });
    await c.store.insertCalls([
      row({}),
      row({ result: "rpm", status: 429 }),
      row({ source: "gemini", endpoint: "gemini-2.5-flash", model: "gemini-2.5-flash", keyIndex: 2, purpose: "ficha", symbol: "NVDA", tokensIn: 5000, tokensOut: 100, tokensThink: 400 }),
      row({ at: "2099-03-05T15:00:00.000Z" }), // otro día: no entra
    ] as never);
    const s = await (await app.request("/usage?date=2099-03-04")).json();
    expect(s.date).toBe("2099-03-04");
    expect(s.total.calls).toBe(3);
    expect(s.bySource.map((r: { source: string; calls: number }) => [r.source, r.calls])).toEqual([["finnhub", 2], ["gemini", 1]]);
    expect(s.gemini.rows[0]).toMatchObject({ model: "gemini-2.5-flash", keyIndex: 2, calls: 1, ok: 1, tokensIn: 5000 });
    expect(s.gemini.costUsd).toBeGreaterThan(0);
    expect(s.byStep[0]).toMatchObject({ step: "radar", source: "finnhub", calls: 2, errors: 1 });
    expect((await app.request("/usage?date=ayer")).status).toBe(400);
    expect((await app.request("/usage")).status).toBe(200);
  });
  it("serie diaria con ceros y lista de llamadas filtrable, las más recientes primero", async () => {
    const c = container();
    const app = buildApp(c);
    const row = (o: Record<string, unknown>) => ({ id: String(Math.random()), at: "2099-03-04T15:00:00.000Z", source: "finnhub", step: "radar", purpose: null, symbol: null, endpoint: "e", model: null, keyIndex: null, status: 200, result: "ok", tokensIn: null, tokensOut: null, tokensThink: null, ms: 8, ...o });
    await c.store.insertCalls([row({ at: "2099-03-02T15:00:00.000Z" }), row({ at: "2099-03-04T15:00:00.000Z", symbol: "NVDA" }), row({ at: "2099-03-04T16:00:00.000Z", source: "gemini", model: "gemini-2.5-flash", endpoint: "gemini-2.5-flash", result: "rpm", status: 429, step: "scan" })] as never);
    const daily = await (await app.request("/usage/daily?days=3&date=2099-03-04")).json();
    expect(daily.map((d: { date: string; calls: number }) => [d.date, d.calls])).toEqual([["2099-03-02", 1], ["2099-03-03", 0], ["2099-03-04", 2]]);
    expect(daily[2].bySource).toEqual({ finnhub: 1, gemini: 1 });
    expect(daily[2].errors).toBe(1);
    const all = await (await app.request("/usage/calls?date=2099-03-04")).json();
    expect(all.total).toBe(2);
    expect(all.calls.map((x: { source: string }) => x.source)).toEqual(["gemini", "finnhub"]);
    const f = await (await app.request("/usage/calls?date=2099-03-04&source=finnhub&symbol=nvda")).json();
    expect(f.calls).toHaveLength(1);
    expect((await (await app.request("/usage/calls?date=2099-03-04&result=rpm&step=scan")).json()).calls).toHaveLength(1);
    expect((await (await app.request("/usage/calls?date=2099-03-04&step=cartera")).json()).calls).toHaveLength(0);
    expect((await app.request("/usage/daily?date=x")).status).toBe(400);
  });
  it("C7 (15/9): del 10 al 13/9 no hay registro y la pestaña dibujaba ceros; el día dice desde cuándo hay datos y cuándo se reinicia la cuota", async () => {
    const c = container();
    const app = buildApp(c);
    const row = (at: string) => ({ id: String(Math.random()), at, source: "finnhub", step: "radar", purpose: null, symbol: null, endpoint: "e", model: null, keyIndex: null, status: 200, result: "ok", tokensIn: null, tokensOut: null, tokensThink: null, ms: 8 });
    await c.store.insertCalls([row("2026-09-14T03:33:52.384Z"), row("2026-09-15T15:00:00.000Z")] as never);
    const daily = await (await app.request("/usage/daily?days=4&date=2026-09-15")).json();
    expect(daily.map((d: { date: string; coverage: string }) => [d.date, d.coverage])).toEqual([["2026-09-12", "sin_registro"], ["2026-09-13", "sin_registro"], ["2026-09-14", "parcial"], ["2026-09-15", "completo"]]);
    const s13 = await (await app.request("/usage?date=2026-09-13")).json();
    expect(s13.coverage.state).toBe("sin_registro");
    const s15 = await (await app.request("/usage?date=2026-09-15")).json();
    expect(s15.coverage.state).toBe("completo");
    // La cuota gratis de Gemini se reinicia a la medianoche de California: 04:00 de Buenos Aires en septiembre.
    expect(s15.quotaResetAt).toBe("2026-09-15T07:00:00.000Z");
  });
  it("C7 (15/9, 17:15): la tabla se vació y quedó con filas desde esa hora; la pantalla lo dice en vez de mostrar ceros a la mañana", async () => {
    const c = container();
    const app = buildApp(c);
    const row = (at: string) => ({ id: String(Math.random()), at, source: "alpaca", step: "precios", purpose: null, symbol: null, endpoint: "e", model: null, keyIndex: null, status: 200, result: "ok", tokensIn: null, tokensOut: null, tokensThink: null, ms: 8 });
    await c.store.insertCalls([row("2026-09-15T20:15:26.357Z"), row("2026-09-15T20:16:12.000Z")] as never);
    const s15 = await (await app.request("/usage?date=2026-09-15")).json();
    expect(s15.coverage).toEqual({ state: "parcial", from: "2026-09-15T20:15:26.357Z" });
    const daily = await (await app.request("/usage/daily?days=2&date=2026-09-15")).json();
    expect(daily.map((d: { date: string; coverage: string }) => [d.date, d.coverage])).toEqual([["2026-09-14", "sin_registro"], ["2026-09-15", "parcial"]]);
  });
});
