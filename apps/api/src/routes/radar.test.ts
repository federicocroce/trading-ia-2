import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { radarRoutes } from "./radar.js";
import { pricesRoutes } from "./prices.js";
import { taxonomyRoutes } from "./taxonomy.js";
import { state, type Container } from "../container.js";
import { seguimientoQuieto } from "../seguimiento.js";

const series = (n: number, from: number, to: number): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse("2025-09-01") + i * 86_400_000).toISOString().slice(0, 10), open: from, high: from * 1.01, low: from * 0.99, close: from + ((to - from) * i) / (n - 1), volume: 1_000_000 }));
const today = "2026-05-19";

/** `velas` reemplaza la fuente de velas del Radar: los tests del alta la usan para frenarla y contar los pedidos. */
function app(opts: { velas?: (symbol: string) => Promise<Candle[]> } = {}) {
  const store = new MemoryStore();
  const taxonomy = { sectors: ["Tecnología", "Otros"], themes: ["IA", "semiconductores"], industryToSector: { Semiconductors: "Tecnología" }, industryToThemes: { Semiconductors: ["semiconductores"] }, symbolToThemes: {}, symbolToAssetClass: {} };
  const radarDeps = {
    store,
    assets: { list: async () => [{ symbol: "AAA", name: "Aaa", exchange: "NASDAQ", tradable: true }], snapshots: async (s: string[]) => s.map((x) => ({ symbol: x, price: 100, iexVolume: 100_000 })) },
    fundamentals: { profile: async (s: string) => ({ symbol: s, name: s, country: "US", industry: "Semiconductors", marketCap: null, currency: "USD", shareOutstanding: 100 }), metrics: async () => ({ "3MonthAverageTradingVolume": 5 }), peers: async () => [], recommendation: async () => null, earningsSurprises: async () => null, insiders: async () => ({ buys: 0, sells: 0 }), nextEarnings: async () => null },
    history: { candles: opts.velas ?? (async () => series(260, 80, 100)) },
    cardWriter: null,
    taxonomy,
    etfs: [{ symbol: "VTI", name: "VTI", role: "nucleo" as const, exposure: "rv_us" as const, ter: 0.03, themes: [], coreWeight: 1 }],
    policy: { weights: { valuation: 0.35, quality: 0.3, growth: 0.25, balance: 0.1 }, quality: { minMcapUsd: 500e6, minDollarVolumeUsd: 5e6, minPrice: 5 }, prefilter: { minPrice: 5, minIexDollarVolume: 500_000 }, technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 }, contribution: { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50 } },
    filings: async () => [],
    filingsDeOferta: async () => [],
  };
  const argentinaDeps = {
    store,
    history: { candles: async (sym: string) => (sym === "^MERV" ? series(260, 1000, 1500) : sym === "GGAL.BA" ? series(260, 1000, 2000) : sym === "AAPL.BA" ? series(10, 25000, 25320) : sym === "SPY" ? series(260, 400, 440) : sym === "GGAL" ? series(260, 20, 44) : []) },
    macro: { dolares: async () => ({ oficial: 1530, mep: 1533.7, ccl: 1583.2, blue: 1545, mayorista: 1511.5 }), riesgoPais: async () => ({ value: 490, date: today }) },
    usPrices: async () => ({ AAPL: 319.8 }),
    config: { benchmark: "^MERV", acciones: [{ symbol: "GGAL.BA", name: "Galicia", adr: "GGAL", sector: "Financiero", themes: ["bancos"] }], cedears: [{ symbol: "AAPL.BA", us: "AAPL", ratio: 20 }] },
    policy: radarDeps.policy,
  };
  const pricesDeps = { quotes: async (symbols: string[]) => symbols.filter((x) => x !== "ZZZ").map((x) => ({ symbol: x, price: x === "AAA" ? 101 : 50, prevClose: x === "AAA" ? 100 : 55, asOf: new Date().toISOString() })) };
  const c = { store, radarDeps, argentinaDeps, pricesDeps, carteraDeps: { store } } as unknown as Container;
  const a = new Hono();
  a.route("/", radarRoutes(c));
  a.route("/", taxonomyRoutes(c));
  a.get("/runs/dates", async (ctx) => ctx.json(await store.runDates(90)));
  return { a, store, c };
}
const post = (a: Hono, path: string, body?: unknown) => a.request(path, { method: "POST", ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });

describe("/taxonomy", () => {
  it("opciones, lectura y edición manual", async () => {
    const { a } = app();
    const opts = await (await a.request("/taxonomy/options")).json();
    expect(opts.themes).toContain("IA");
    expect((await a.request("/taxonomy/AAA")).status).toBe(404);
    const put = await a.request("/taxonomy/aaa", { method: "PUT", body: JSON.stringify({ assetClass: "accion_us", sector: "Tecnología", themes: ["IA", "inventado"] }), headers: { "content-type": "application/json" } });
    expect(put.status).toBe(200);
    const t = await (await a.request("/taxonomy/AAA")).json();
    expect(t.themes).toEqual(["IA"]);
    expect(t.themesSource).toBe("manual");
    expect((await a.request("/taxonomy/AAA", { method: "PUT", body: JSON.stringify({ assetClass: "nave" }), headers: { "content-type": "application/json" } })).status).toBe(400);
  });
});

describe("/taxonomy/apply", () => {
  it("etiqueta por regla las posiciones (o los símbolos pedidos) a partir del perfil guardado", async () => {
    const { a, store } = app();
    await store.upsertPosition({ symbol: "GGAL", quantity: 1, avgCost: 1, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    await store.saveProfile({ symbol: "GGAL", name: "Galicia", country: "AR", industry: "Banking", marketCap: null });
    const r = await (await post(a, "/taxonomy/apply")).json();
    expect(r.tagged).toBe(1);
    const t = await (await a.request("/taxonomy/GGAL")).json();
    expect(t.assetClass).toBe("adr");
    expect(t.sector).toBe("Otros"); // Banking no está en la taxonomía del test
  });
});

describe("/radar", () => {
  it("scan en segundo plano con estado; 409 si ya corre; rank, refresh, plan, candidates con filtro, measurement", async () => {
    const { a } = app();
    state.scan = { running: false, stopRequested: false, startedAt: null, progress: null, last: null };
    expect((await post(a, "/radar/scan")).status).toBe(202);
    for (let i = 0; i < 50 && state.scan.running; i++) await new Promise((r) => setTimeout(r, 10));
    const st = await (await a.request("/radar/scan-status")).json();
    expect(st.running).toBe(false);
    expect(st.last.fundamentalsOk).toBe(1);
    state.scan.running = true;
    expect((await post(a, "/radar/scan")).status).toBe(409);
    state.scan.running = false;

    const rank = await (await post(a, `/radar/rank?today=${today}`)).json();
    expect(rank.candidates.some((c: { symbol: string }) => c.symbol === "VTI")).toBe(true);
    const list = await (await a.request("/radar/candidates?kind=etf")).json();
    expect(list.map((c: { symbol: string }) => c.symbol)).toEqual(["VTI"]);
    expect((await (await a.request("/radar/candidates?theme=IA")).json()).length).toBe(0);
    expect((await (await a.request("/radar/etfs")).json()).length).toBe(1);
    expect((await (await post(a, `/radar/refresh?today=${today}`)).json()).refreshed).toBe(1);
    const plan = await (await post(a, "/radar/plan?month=2026-05")).json();
    expect(plan.month).toBe("2026-05");
    expect((await (await a.request("/radar/plan")).json()).month).toBe("2026-05");
    const m = await (await a.request("/radar/measurement")).json();
    expect(m.byVerdict.NUCLEO.h7.n).toBe(0);
    expect((await a.request("/radar/candidates/VTI")).status).toBe(200);
    expect((await a.request("/radar/candidates/ZZZ")).status).toBe(404);
  });
});

describe("/radar/top", () => {
  it("devuelve los COMPRAR con más convicción, con razones, salvedades y los temas donde la cartera ya está cargada", async () => {
    const { a, store } = app();
    const base = { candidateDate: today, kind: "stock" as const, verdict: "COMPRAR" as const, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20, close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 116, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, nthAppearance: 1, summary: "hace cosas", whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([
      { ...base, symbol: "TOP", score: 1.3, flags: ["consenso_compra"] },
      { ...base, symbol: "ARG", score: 1.6, flags: [] },
      { ...base, symbol: "OBS", score: 2, verdict: "OBSERVAR", flags: [] },
    ]);
    await store.saveTags("ARG", { assetClass: "adr", sector: "Financiero", industry: "Banking", themes: ["argentina"], themesSource: "regla" });
    await store.saveRisk(today, { totalValue: 100, weights: [], concentration: { byCountry: {}, byIndustry: {}, bySector: {}, byTheme: { argentina: 75.6, IA: 7 }, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, risk: { portfolioVolPct: null, spyVolPct: null, r2VsSpy: null, worstDayPct: null, sessions: 0 }, liquidity: [], notes: [] });
    const top = await (await a.request("/radar/top?n=5")).json();
    expect(top.overweight).toEqual({ argentina: 75.6 });
    expect(top.picks.map((p: { symbol: string }) => p.symbol)).toEqual(["TOP", "ARG"]);
    expect(top.picks[0].allAligned).toBe(true);
    expect(top.picks[0].summary).toBe("hace cosas");
    expect(top.picks[0].tags).toBeNull();
    expect(top.picks[1].cautions).toEqual(["ya tenés 75.6% de la cartera en argentina"]);
  });
});

describe("/radar/argentina", () => {
  /**
   * 13/9/2026: el dueño compra en dólares. Una acción con ADR (GGAL.BA → GGAL) se muestra por su ADR, en
   * dólares contra el SPY; la lista en pesos queda solo para las que NO tienen versión en Nueva York.
   */
  it("refresca y devuelve el macro, los ADR en dólares, lo que solo se compra en pesos y los CEDEARs", async () => {
    const { a } = app();
    const r = await (await post(a, `/radar/argentina?today=${today}`)).json();
    expect(r.acciones).toBe(1);
    expect(r.adrs).toBe(1);
    expect(r.cedears).toBe(1);
    expect(r.errors).toEqual([]);
    const g = await (await a.request("/radar/argentina")).json();
    expect(g.macro.ccl).toBe(1583.2);
    expect(g.macro.riesgoPais).toBe(490);
    expect(g.series).toHaveLength(1);
    expect(g.adrs).toHaveLength(1);
    expect(g.adrs[0]).toMatchObject({ symbol: "GGAL", kind: "adr", close: 44, peerGroup: ["GGAL.BA"] });
    // GGAL.BA tiene ADR: no va en la lista de "solo en pesos".
    expect(g.acciones).toEqual([]);
    expect(g.cedears[0].symbol).toBe("AAPL.BA");
    expect(g.cedears[0].flags).toEqual(["en_linea"]);
    // Las filas argentinas, en pesos o en dólares, no se mezclan con las de acciones US en el top de convicción.
    const top = await (await a.request("/radar/top")).json();
    expect(top.picks.some((p: { symbol: string }) => p.symbol.endsWith(".BA") || p.symbol === "GGAL")).toBe(false);
  });
});

describe("/radar/watchlist", () => {
  it("alta, refresco con veredicto técnico, listado y baja", async () => {
    const { a, c } = app();
    expect((await post(a, "/radar/watchlist", { symbol: "bad symbol" })).status).toBe(400);
    const added = await (await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" })).json();
    expect(added.items.map((i: { symbol: string }) => i.symbol)).toEqual(["AAA"]);
    // Foto del alta: precio vivo y estado del ciclo de vida.
    expect(added.items[0]).toMatchObject({ entryPrice: 101, entryAction: "manual", status: "live", horizonDays: 30 });
    // La fila llega sola cuando termina el refresco, que corre después de responder (18/9).
    await seguimientoQuieto(c);
    const list = await (await a.request("/radar/watchlist")).json();
    expect(list.rows).toHaveLength(1);
    expect(list.rows[0].kind).toBe("watch");
    expect(["COMPRAR", "OBSERVAR"]).toContain(list.rows[0].verdict);
    // No aparece entre las acciones candidatas ni en el top de convicción.
    expect((await (await a.request("/radar/candidates?kind=stock")).json()).some((c: { symbol: string }) => c.symbol === "AAA")).toBe(false);
    expect((await (await a.request("/radar/top")).json()).picks.some((p: { symbol: string }) => p.symbol === "AAA")).toBe(false);
    const removed = await (await a.request("/radar/watchlist/AAA", { method: "DELETE" })).json();
    expect(removed.items).toEqual([]);
    expect(removed.rows).toEqual([]);
  });
});

describe("/radar/candidates/:symbol: los mismos comparables que la ficha (auditoría del 15/9)", () => {
  it("NBN: el detalle del Radar arma los pares con su industria y marca el crecimiento que el ranking no usa en bancos", async () => {
    // La ficha ya lo hacía con `comparables()`; el detalle del Radar armaba los pares sin la industria y pintaba en verde
    // un crecimiento de 123,9% que el ranking descarta en bancos: dos tablas distintas para el mismo símbolo.
    const { a, store } = app();
    const fund = (symbol: string, ttm: number) => ({ symbol, asOf: today, metrics: { revenueGrowthTTMYoy: ttm, peTTM: 10 }, peers: [], industry: "Banking", mcapUsd: 1e9, dollarVolumeUsd: 1e7, priceUsd: 50, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
    await store.saveFundamentals(fund("NBN", 123.9));
    await store.saveFundamentals(fund("HFWA", 30.9));
    await store.upsertCandidates([{ candidateDate: today, symbol: "NBN", kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: ["HFWA"], rankInGroup: 1, groupSize: 2, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 1000, sizeQty: 10, riskScore: 3, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null }]);
    const d = await (await a.request("/radar/candidates/NBN")).json();
    expect(d.ownExcluded).toContain("revenueGrowthTTMYoy");
    expect(d.peers[0].excluded).toContain("revenueGrowthTTMYoy");
    expect(d.medians.revenueGrowthTTMYoy).toBeNull();
    // Sin verificador no se puede decir si la verificación es del cuestionario vigente.
    expect(d.verificationCurrent).toBeNull();
  });
});

/**
 * El alta tardaba unos 10 minutos (18/9): rehacía los 19 símbolos de la lista en serie (velas, noticias, clasificador
 * de eventos con Gemini en 503, ofertas de la SEC), después el plan y los controles, y recién ahí respondía; dos altas
 * seguidas corrían dos refrescos completos a la vez. Ahora responde apenas guarda el alta, refresca solo el símbolo
 * nuevo y nunca hay dos refrescos de seguimiento corriendo juntos.
 */
describe("/radar/watchlist: el alta no espera ni rehace la lista (18/9)", () => {
  /** Velas con freno: cada pedido queda esperando hasta `soltar()`. Cuenta qué se pidió y cuántos pedidos hubo a la vez. */
  const velasConFreno = () => {
    const pedidas: string[] = [];
    const st = { enVuelo: 0, maxEnVuelo: 0, libre: false };
    const esperando: Array<() => void> = [];
    const velas = async (symbol: string) => {
      pedidas.push(symbol);
      st.maxEnVuelo = Math.max(st.maxEnVuelo, ++st.enVuelo);
      if (!st.libre) await new Promise<void>((r) => esperando.push(r));
      st.enVuelo--;
      return series(260, 80, 100);
    };
    return { velas, pedidas, st, soltar: () => { st.libre = true; esperando.splice(0).forEach((r) => r()); } };
  };
  const simbolos = (xs: Array<{ symbol: string }>) => xs.map((x) => x.symbol).sort();

  it("responde con el alta guardada sin esperar el refresco, y avisa qué se está analizando", async () => {
    const f = velasConFreno();
    const { a, c } = app({ velas: f.velas });
    const r = await Promise.race([post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" }), new Promise<"colgado">((ok) => setTimeout(() => ok("colgado"), 1000))]);
    if (r === "colgado") throw new Error("el alta se quedó esperando el refresco");
    const added = await r.json();
    expect(simbolos(added.items)).toEqual(["AAA"]);
    expect(added.rows).toEqual([]);
    expect(added.refreshing).toEqual(["AAA"]);
    f.soltar();
    await seguimientoQuieto(c);
    const list = await (await a.request("/radar/watchlist")).json();
    expect(simbolos(list.rows)).toEqual(["AAA"]);
    expect(list.refreshing).toEqual([]);
  });

  it("refresca solo el símbolo nuevo: lo que ya se refrescó hoy no se vuelve a pedir y conserva su fila", async () => {
    const f = velasConFreno();
    f.soltar();
    const { a, c } = app({ velas: f.velas });
    await post(a, `/radar/watchlist?today=${today}`, { symbol: "bbb" });
    await seguimientoQuieto(c);
    f.pedidas.length = 0;
    await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" });
    await seguimientoQuieto(c);
    expect(f.pedidas).toContain("AAA");
    expect(f.pedidas).not.toContain("BBB");
    expect(simbolos((await (await a.request("/radar/watchlist")).json()).rows)).toEqual(["AAA", "BBB"]);
  });

  it("si la lista todavía no se refrescó hoy, el alta la refresca entera: una sola fila de hoy dejaría a las demás fuera de lo vigente", async () => {
    const { a, c } = app();
    await post(a, "/radar/watchlist?today=2026-05-18", { symbol: "bbb" });
    await seguimientoQuieto(c);
    await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" });
    await seguimientoQuieto(c);
    const list = await (await a.request("/radar/watchlist")).json();
    expect(list.rows.map((r: { symbol: string; candidateDate: string }) => `${r.symbol} ${r.candidateDate}`).sort()).toEqual([`AAA ${today}`, `BBB ${today}`]);
  });

  it("dos altas seguidas: las dos responden enseguida y nunca corren dos refrescos a la vez", async () => {
    const f = velasConFreno();
    const { a, c } = app({ velas: f.velas });
    const uno = await (await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" })).json();
    const dos = await (await post(a, `/radar/watchlist?today=${today}`, { symbol: "bbb" })).json();
    expect(uno.refreshing).toEqual(["AAA"]);
    expect(dos.refreshing).toEqual(["AAA", "BBB"]);
    f.soltar();
    await seguimientoQuieto(c);
    // Cada refresco pide las velas de a una: dos pedidos a la vez son dos refrescos a la vez.
    expect(f.st.maxEnVuelo).toBe(1);
    const list = await (await a.request("/radar/watchlist")).json();
    expect(simbolos(list.rows)).toEqual(["AAA", "BBB"]);
    expect(list.refreshing).toEqual([]);
  });

  it("si lo sacás mientras se analiza, no le queda una fila de seguimiento que el plan pueda comprar", async () => {
    const f = velasConFreno();
    const { a, c, store } = app({ velas: f.velas });
    // El refresco de AAA ya leyó la lista y está frenado pidiendo velas cuando llega la baja.
    await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" });
    await a.request(`/radar/watchlist/AAA?today=${today}`, { method: "DELETE" });
    f.soltar();
    await seguimientoQuieto(c);
    expect((await store.latestCandidates()).filter((r) => r.kind === "watch").map((r) => r.symbol)).toEqual([]);
  });

  it("el refresco a mano espera su turno detrás de un alta en curso", async () => {
    const f = velasConFreno();
    const { a, c } = app({ velas: f.velas });
    await post(a, `/radar/watchlist?today=${today}`, { symbol: "aaa" });
    const aMano = post(a, `/radar/watchlist/refresh?today=${today}`);
    f.soltar();
    expect(await (await aMano).json()).toMatchObject({ symbols: 1, rows: 1, errors: [] });
    await seguimientoQuieto(c);
    expect(f.st.maxEnVuelo).toBe(1);
  });
});

describe("/radar/watchlist: lo que seguís y ya está en el ranking (auditoría del 15/9)", () => {
  it("APH y TSM seguidos y rankeados: la lista trae su fila del ranking, no 'sin datos todavía'", async () => {
    // Desde el 14/9 el seguimiento no pisa la fila del ranking, así que APH no tiene fila "watch": la barra la mostraba sin
    // veredicto y la pestaña decía "sin datos todavía" de un símbolo que el Radar tenía completo.
    const { a, store } = app();
    const fila = (symbol: string, kind: "stock" | "watch") => ({ candidateDate: today, symbol, kind, verdict: "COMPRAR" as const, score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 10, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 1000, sizeQty: 10, riskScore: 3, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });
    await store.upsertCandidates([fila("APH", "stock"), fila("MP", "watch")]);
    await store.addWatch("APH", {});
    await store.addWatch("MP", {});
    await store.addWatch("ZZZ", {});
    const list = await (await a.request("/radar/watchlist")).json();
    expect(list.rows.map((r: { symbol: string; kind: string }) => `${r.symbol}:${r.kind}`).sort()).toEqual(["APH:stock", "MP:watch"]);
  });
});

describe("/prices", () => {
  it("cotizaciones por lote con variación y marca de precio viejo; la cinta trae los que más se movieron entre lo que la app sigue", async () => {
    const { a, store } = app();
    const pricesApp = new Hono();
    pricesApp.route("/", pricesRoutes({ store, pricesDeps: { quotes: async (symbols: string[]) => symbols.map((x) => ({ symbol: x, price: x === "UP" ? 110 : x === "DN" ? 90 : 100, prevClose: 100, asOf: x === "OLD" ? "2020-01-01T00:00:00Z" : new Date().toISOString() })) } } as unknown as Container));
    const rows = await (await pricesApp.request("/prices?symbols=up,dn,old")).json();
    expect(rows.map((r: { symbol: string; changePct: number; stale: boolean }) => [r.symbol, r.changePct, r.stale])).toEqual([["DN", -10, false], ["OLD", 0, true], ["UP", 10, false]]);
    await store.upsertPosition({ symbol: "UP", quantity: 1, avgCost: 1, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.addWatch("DN");
    await store.addWatch("OLD");
    const tape = await (await pricesApp.request("/prices/tape")).json();
    expect(tape.gainers.map((r: { symbol: string }) => r.symbol)).toEqual(["UP"]);
    expect(tape.losers.map((r: { symbol: string }) => r.symbol)).toEqual(["DN"]); // OLD queda afuera: precio viejo
    void a;
  });
  it("con hub: /prices/all devuelve la foto, /prices/stream la manda al conectar y /prices sirve lo seguido sin cotizar de nuevo", async () => {
    const { PriceHub } = await import("../prices-hub.js");
    const store = new MemoryStore();
    await store.addWatch("VST");
    let asked = 0;
    const cc = { store, pricesDeps: { quotes: async (symbols: string[]) => { asked++; return symbols.map((x) => ({ symbol: x, price: 150, prevClose: 100, asOf: new Date().toISOString() })); } } } as unknown as Container;
    cc.priceHub = new PriceHub(cc);
    await cc.priceHub.tick();
    const app3 = new Hono();
    app3.route("/", pricesRoutes(cc));
    const all = await (await app3.request("/prices/all")).json();
    expect(all.rows.map((r: { symbol: string; changePct: number }) => [r.symbol, r.changePct])).toEqual([["VST", 50]]);
    const res = await app3.request("/prices/stream");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: snapshot");
    expect(first).toContain("\"VST\"");
    await reader.cancel();
    const before = asked;
    expect((await (await app3.request("/prices?symbols=vst")).json())[0].symbol).toBe("VST");
    expect(asked).toBe(before); // servido de la foto del hub
  });
  it("buscador de símbolos: pasa la consulta y cachea", async () => {
    const calls: string[] = [];
    const app2 = new Hono();
    app2.route("/", pricesRoutes({ store: new MemoryStore(), pricesDeps: { quotes: async () => [] }, symbolSearch: { search: async (q: string) => { calls.push(q); return [{ symbol: "MELI", name: "MercadoLibre", exchange: "NASDAQ", type: "accion_us", flag: "🇺🇸" }]; } } } as unknown as Container));
    expect((await (await app2.request("/symbols/search?q=meli")).json())[0].symbol).toBe("MELI");
    await app2.request("/symbols/search?q=MELI");
    expect(calls).toEqual(["meli"]);
    expect(await (await app2.request("/symbols/search?q=")).json()).toEqual([]);
  });
});

describe("histórico por fecha", () => {
  it("?date= devuelve candidatos y macro tal como quedaron ese día; /runs/dates lista las corridas", async () => {
    const { a, store } = app();
    const base = { kind: "stock" as const, verdict: "COMPRAR" as const, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 5, close: 10, entryLow: 10, entryHigh: 10.2, stop: 9, target: 12, sizeUsd: 1000, sizeQty: 100, riskScore: 3, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([{ ...base, candidateDate: "2026-09-07", symbol: "OLD", score: 1 }, { ...base, candidateDate: "2026-09-08", symbol: "NEW", score: 2 }]);
    await store.saveMacroAr({ date: "2026-09-07", oficial: 1, mep: 1, ccl: 1500, blue: 1, mayorista: 1, brechaPct: 0, riesgoPais: 500, merval: 1, mervalUsd: 1 });
    await store.saveMacroAr({ date: "2026-09-08", oficial: 1, mep: 1, ccl: 1583, blue: 1, mayorista: 1, brechaPct: 0, riesgoPais: 490, merval: 1, mervalUsd: 1 });
    expect((await (await a.request("/radar/candidates")).json()).map((c: { symbol: string }) => c.symbol)).toEqual(["NEW"]);
    expect((await (await a.request("/radar/candidates?date=2026-09-07")).json()).map((c: { symbol: string }) => c.symbol)).toEqual(["OLD"]);
    expect((await (await a.request("/radar/argentina?date=2026-09-07")).json()).macro.ccl).toBe(1500);
    expect((await (await a.request("/radar/top?date=2026-09-07")).json()).picks.map((p: { symbol: string }) => p.symbol)).toEqual(["OLD"]);
    expect(await (await a.request("/runs/dates")).json()).toEqual(["2026-09-08", "2026-09-07"]);
  });
});
