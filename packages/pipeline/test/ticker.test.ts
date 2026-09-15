import { describe, expect, it } from "vitest";
import type { Candle, Fundamentals, SymbolDescription } from "@thesis/core";
import { atr, groupMedians, rankStocks } from "@thesis/core";
import { MemoryStore, buildTicker, closeAnterior, comparables, liveQuotes, type TickerDeps } from "../src/index.js";

const series = (closes: number[], start = "2026-06-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1_000_000 }));
const today = "2026-09-08";
const desc = (sym: string): SymbolDescription => ({ symbol: sym, longName: `${sym} Inc`, summary: "hace cosas", employees: 100, website: "x.com", exchangeName: "NYSE", firstTradeDate: "2000-01-01", sector: "Tech", industry: "Soft", country: "US", updatedAt: "2026-09-08T00:00:00.000Z" });

function setup() {
  const store = new MemoryStore();
  const calls: string[] = [];
  const deps: TickerDeps = {
    store,
    history: { candles: async (s) => { calls.push(`history:${s}`); return series(Array(99).fill(s === "SPY" ? 500 : 40)); } },
    descriptions: { description: async (s) => { calls.push(`desc:${s}`); return desc(s); } },
    news: { companyNews: async (s) => { calls.push(`news:${s}`); return [{ symbol: s, date: "2026-09-07", headline: "Noticia", source: "R", url: `https://n/${s}`, summary: null }]; } },
    quote: async (s) => ({ symbol: s, price: 41, prevClose: 40, asOf: "2026-09-08T14:00:00Z" }),
    newsFetchedAt: new Map(),
  };
  return { store, deps, calls };
}

describe("buildTicker", () => {
  it("arma la página con todo lo guardado y completa descripción, velas y noticias si faltan (y las persiste)", async () => {
    const { store, deps, calls } = setup();
    await store.upsertPosition({ symbol: "GGAL", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    await store.insertTransactions([
      { id: "t1", symbol: "GGAL", type: "BUY", quantity: 100, price: 30, fees: 0, date: "2026-01-02", currency: "USD", platform: "Buenbit", externalId: "e1", notes: null },
      // Mover la tenencia de plataforma no es invertir: no suma al total invertido.
      { id: "t2", symbol: "GGAL", type: "TRANSFER", quantity: 100, price: 49, fees: 0, date: "2026-04-18", currency: "USD", platform: "Nexo", externalId: "e2", notes: null },
    ]);
    await store.saveTags("GGAL", { assetClass: "adr", sector: "Financiero", industry: "Banking", themes: ["argentina", "bancos"], themesSource: "regla" });
    await store.upsertVerdicts([{ verdictDate: today, symbol: "GGAL", verb: "MANTENER", reason: "r", narrative: "n", warning: null, close: 40, spot: 41, stop: 38, target: 44, gainPct: 33, weightPct: 26, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    const t = await buildTicker(deps, "ggal", { today });
    expect(t.symbol).toBe("GGAL");
    expect(t.description?.summary).toBe("hace cosas");
    expect(t.quote?.price).toBe(41);
    expect(t.quote?.changePct).toBeCloseTo(2.5, 4);
    expect(t.position?.quantity).toBe(100);
    expect(t.position?.valueUsd).toBe(4100);
    expect(t.position?.pnlUsd).toBe(1100);
    expect(t.verdict?.verb).toBe("MANTENER");
    expect(t.tags?.themes).toEqual(["argentina", "bancos"]);
    expect(t.transactions).toHaveLength(2);
    expect(t.transactionSummary).toEqual({ buys: { count: 1, total: 3000 }, sells: { count: 0, total: 0 }, dividends: { count: 0, total: 0 }, dividendShares: 0, invested: 3000 });
    expect(t.candles.length).toBe(99);
    expect(t.news[0]?.headline).toBe("Noticia");
    expect(t.candidate).toBeNull();
    // persistido: segunda llamada no vuelve a pedir descripción, velas ni noticias
    calls.length = 0;
    const t2 = await buildTicker(deps, "GGAL", { today });
    expect(t2.candles.length).toBe(99);
    expect(calls).toEqual([]);
    expect((await store.description("GGAL"))?.longName).toBe("GGAL Inc");
  });
  it("símbolo desconocido: sin posición ni veredicto, pero con descripción y velas", async () => {
    const { deps } = setup();
    const t = await buildTicker(deps, "NVDA", { today });
    expect(t.position).toBeNull();
    expect(t.verdict).toBeNull();
    expect(t.description?.longName).toBe("NVDA Inc");
    expect(t.candles.length).toBe(99);
  });
  it("una fuente colgada no bloquea la página: corta al timeout, avisa y las cuatro fuentes corren en paralelo", async () => {
    const { deps } = setup();
    const never = () => new Promise<never>(() => {});
    const slow = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 40));
    const hung: TickerDeps = { ...deps, descriptions: { description: never }, news: { companyNews: never }, quote: never, history: { candles: never } };
    const t0 = Date.now();
    const t = await buildTicker(hung, "NVDA", { today, timeoutMs: 30 });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(t.description).toBeNull();
    expect(t.candles).toEqual([]);
    expect(t.news).toEqual([]);
    expect(t.quote).toBeNull();
    expect(t.errors).toHaveLength(4);
    expect(t.errors.every((e) => e.includes("tardó más de 30 ms"))).toBe(true);
    // En paralelo: cuatro fuentes de 40 ms no suman 160 ms.
    const par: TickerDeps = { ...deps, descriptions: { description: (s) => slow(desc(s)) }, news: { companyNews: (s) => slow([{ symbol: s, date: "2026-09-07", headline: "N", source: null, url: `https://n/${s}`, summary: null }]) }, quote: (s) => slow({ symbol: s, price: 1, prevClose: 1, asOf: null }), history: { candles: () => slow(series([1, 2, 3])) } };
    const t1 = Date.now();
    const p = await buildTicker(par, "NVDA", { today, timeoutMs: 1000 });
    expect(Date.now() - t1).toBeLessThan(120);
    expect(p.errors).toEqual([]);
    expect(p.candles.length).toBe(3);
  });
  it("descripción, velas y noticias viejas se sirven ya y se refrescan en segundo plano", async () => {
    const { store, deps, calls } = setup();
    await store.saveDescription({ ...desc("GGAL"), longName: "Vieja", updatedAt: "2026-06-01T00:00:00.000Z" });
    await store.upsertCandles("GGAL", series([30, 31], "2026-08-20"));
    await store.upsertNews([{ symbol: "GGAL", date: "2026-08-01", headline: "Vieja noticia", source: null, url: "https://n/old", summary: null }]);
    deps.newsFetchedAt!.set("GGAL", Date.now() - 48 * 3_600_000);
    const t = await buildTicker(deps, "GGAL", { today });
    // Lo guardado sale sin esperar a la red.
    expect(t.description?.longName).toBe("Vieja");
    expect(t.candles.length).toBe(2);
    expect(t.news.map((n) => n.headline)).toEqual(["Vieja noticia"]);
    expect(t.errors).toEqual([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.sort()).toEqual(["desc:GGAL", "history:GGAL", "news:GGAL"]);
    expect((await store.description("GGAL"))?.longName).toBe("GGAL Inc");
    expect((await store.candles("GGAL", "2020-01-01")).length).toBe(99);
    expect((await store.news("GGAL", 20)).length).toBe(2);
    // Una segunda llamada inmediata no vuelve a disparar el refresco de noticias.
    calls.length = 0;
    await buildTicker(deps, "GGAL", { today });
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toEqual([]);
  });
  it("modo rápido (live: false): no espera a la red, dispara lo que falta en segundo plano y lo marca pendiente", async () => {
    const { store, deps, calls } = setup();
    // Las fuentes no responden hasta que el test las libera: si el modo rápido esperara, el test se colgaría.
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const slow = <T,>(v: T) => gate.then(() => v);
    const lento: TickerDeps = { ...deps, descriptions: { description: (s) => { calls.push(`desc:${s}`); return slow(desc(s)); } }, history: { candles: (s) => { calls.push(`history:${s}`); return slow(series([1, 2, 3])); } }, news: { companyNews: (s) => { calls.push(`news:${s}`); return slow([]); } }, quote: () => slow({ symbol: "NVDA", price: 1, prevClose: 1, asOf: null }) };
    const t = await buildTicker(lento, "NVDA", { today, live: false });
    expect(t.description).toBeNull();
    expect(t.candles).toEqual([]);
    expect(t.quote).toBeNull();
    expect(t.errors).toEqual([]);
    expect(t.pending.sort()).toEqual(["descripción", "noticias", "precio", "velas"]);
    expect(Object.keys(t.timings)).toContain("total");
    // Lo que faltaba se completó atrás: la próxima llamada lo sirve desde la base.
    release();
    await new Promise((r) => setTimeout(r, 20));
    expect((await store.description("NVDA"))?.longName).toBe("NVDA Inc");
    const t2 = await buildTicker(lento, "NVDA", { today, live: false });
    expect(t2.description?.longName).toBe("NVDA Inc");
    expect(t2.candles.length).toBe(3);
    expect(t2.pending).toEqual(["precio"]);
  });
  it("un .BA toma las noticias de su ADR (Finnhub no cubre BYMA) y sin ADR no pide nada", async () => {
    const { store, deps, calls } = setup();
    const base = { candidateDate: today, kind: "ar" as const, verdict: "OBSERVAR" as const, score: null, axes: {}, rankInGroup: null, groupSize: null, close: 6935, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([{ ...base, symbol: "GGAL.BA", peerGroup: ["GGAL"] }, { ...base, symbol: "ALUA.BA", peerGroup: [] }]);
    const t = await buildTicker(deps, "GGAL.BA", { today });
    expect(calls.filter((c) => c.startsWith("news:"))).toEqual(["news:GGAL"]);
    expect(t.news.map((n) => n.symbol)).toEqual(["GGAL.BA"]);
    expect(t.errors).toEqual([]);
    const a = await buildTicker(deps, "ALUA.BA", { today });
    expect(calls.filter((c) => c.startsWith("news:"))).toEqual(["news:GGAL"]);
    expect(a.news).toEqual([]);
    expect(a.errors).toEqual([]);
  });
  it("si Yahoo o Finnhub fallan, la página sale igual con lo que hay", async () => {
    const { deps } = setup();
    const bad: TickerDeps = { ...deps, descriptions: { description: async () => { throw new Error("yahoo"); } }, news: { companyNews: async () => { throw new Error("finnhub"); } }, quote: async () => null };
    const t = await buildTicker(bad, "NVDA", { today });
    expect(t.description).toBeNull();
    expect(t.news).toEqual([]);
    expect(t.quote).toBeNull();
    expect(t.errors.length).toBe(2);
  });
});

describe("comparables (C4, 15/9)", () => {
  // NBN y sus diez pares del 15/9, todos bancos, con el crecimiento de ingresos que da Finnhub (TTM, trimestral).
  const pares: Array<[string, number | null, number | null]> = [["HFWA", 30.89696, 20.22091], ["AMTB", 77.86044, 56.36941], ["MCB", 50.46917, 64.02435], ["FSBC", null, null], ["UVSP", 53.22302, 45.20089], ["CFFN", null, null], ["MBWM", 59.29094, 47.8381], ["EQBK", 34.29414, 33.96844], ["BFST", null, null], ["TFC", 58.19041, 42.57267]];
  const fund = (symbol: string, ttm: number | null, q: number | null, pe: number): Fundamentals => ({ symbol, asOf: "2026-09-13", metrics: { revenueGrowthTTMYoy: ttm, revenueGrowthQuarterlyYoy: q, peTTM: pe, roeTTM: 10 }, peers: [], industry: "Banking", mcapUsd: 1e9, dollarVolumeUsd: 1e7, priceUsd: 50, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
  it("NBN: la tabla mostraba una mediana de crecimiento de 53,2% y pintaba en verde su 123,9%, cuando el ranking no usa ese dato en bancos; los pares van con su industria y la mediana es la del puntaje", async () => {
    const store = new MemoryStore();
    const nbn = fund("NBN", 123.8872, 133.3867, 10.5761);
    await store.saveFundamentals(nbn);
    for (const [s, ttm, q] of pares) await store.saveFundamentals(fund(s, ttm, q, 12));
    const c = await comparables(store, nbn, pares.map(([s]) => s));
    expect(c.medians?.["revenueGrowthTTMYoy"]).toBeNull();
    expect(c.medians?.["revenueGrowthQuarterlyYoy"]).toBeNull();
    // La misma mediana que calcula el ranking con las fundamentales completas.
    const all = new Map([nbn, ...(await Promise.all(pares.map(([s]) => store.fundamentals(s))))].map((f) => [f!.symbol, f!]));
    const ranked = rankStocks(all, { valuation: 1, quality: 1, growth: 1, balance: 1 }).ranked.find((r) => r.symbol === "NBN");
    expect(c.medians).toEqual(groupMedians([nbn, ...pares.map(([s]) => all.get(s)!)]));
    if (ranked) expect(c.medians?.["revenueGrowthTTMYoy"]).toBe(ranked.medians["revenueGrowthTTMYoy"]);
    // Cada fila dice qué métricas el puntaje no usa para esa empresa.
    expect(c.ownExcluded).toEqual(["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"]);
    expect(c.peers.find((p) => p.symbol === "UVSP")?.excluded).toEqual(["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"]);
    expect(c.peers.find((p) => p.symbol === "FSBC")?.excluded).toEqual([]);
  });
  it("la ficha usa esa misma función: un banco en el Radar ya no muestra la mediana de crecimiento", async () => {
    const { store, deps } = setup();
    const nbn = fund("NBN", 123.8872, 133.3867, 10.5761);
    await store.saveFundamentals(nbn);
    for (const [s, ttm, q] of pares) await store.saveFundamentals(fund(s, ttm, q, 12));
    const base = { candidateDate: today, kind: "stock" as const, verdict: "COMPRAR" as const, score: 1, axes: {}, rankInGroup: 3, groupSize: 11, close: 132.23, entryLow: 132.23, entryHigh: 134.87, stop: 123.85, target: 156.91, sizeUsd: null, sizeQty: null, riskScore: null, flags: [], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null };
    await store.upsertCandidates([{ ...base, symbol: "NBN", peerGroup: pares.map(([s]) => s) }]);
    const t = await buildTicker(deps, "NBN", { today });
    expect(t.medians?.["revenueGrowthTTMYoy"]).toBeNull();
    expect(t.ownExcluded).toEqual(["revenueGrowthTTMYoy", "revenueGrowthQuarterlyYoy"]);
    expect(t.peers).toHaveLength(10);
  });
});

describe("cierre anterior guardado (C6, 15/9)", () => {
  // TSM: la base (Yahoo, el mismo cierre que usan las velas, el Radar y Cartera) tiene 433,24 el 11/9 y 418,01 el 14/9.
  // Alpaca IEX decía que el cierre de ayer era 418,60: dos "cierres de ayer" en la misma pantalla.
  const vela = (date: string, close: number): Candle => ({ date, open: close, high: close, low: close, close, volume: 1 });
  const tsm = [vela("2026-09-10", 428.03), vela("2026-09-11", 433.24), vela("2026-09-14", 418.01)];
  it("el cambio del día se mide contra el cierre guardado de la sesión anterior, y dice de qué fecha es", () => {
    expect(closeAnterior(tsm, "2026-09-15T19:40:59.858Z")).toEqual({ close: 418.01, date: "2026-09-14" });
    // El lunes, la sesión anterior es el viernes.
    expect(closeAnterior(tsm.slice(0, 2), "2026-09-14T15:00:00Z")).toEqual({ close: 433.24, date: "2026-09-11" });
    // Una vela de hoy a medio armar no es el cierre anterior.
    expect(closeAnterior([...tsm, vela("2026-09-15", 414.66)], "2026-09-15T19:40:59.858Z")).toEqual({ close: 418.01, date: "2026-09-14" });
  });
  it("C2: la página trae el ATR de 14 ruedas de las velas guardadas (con el de core), para medir la distancia al stop en ATR", async () => {
    const { store, deps } = setup();
    const velas = Array.from({ length: 20 }, (_, i) => ({ date: new Date(Date.parse("2026-08-20") + i * 86_400_000).toISOString().slice(0, 10), open: 400, high: 405 + (i % 3), low: 395, close: 400 + i, volume: 1 }));
    await store.upsertCandles("TSM", velas);
    const t = await buildTicker(deps, "TSM", { today: "2026-09-15" });
    expect(t.atr14).toBeCloseTo(atr(velas, 14)!, 10);
    expect((await buildTicker(deps, "NADA", { today: "2026-09-15", live: false })).atr14).toBeNull();
  });
  it("si falta la sesión anterior en la base no se usa una más vieja: queda el cierre de la fuente", () => {
    expect(closeAnterior(tsm.slice(0, 2), "2026-09-15T19:40:59.858Z")).toBeNull();
    expect(closeAnterior([], "2026-09-15T19:40:59.858Z")).toBeNull();
  });
  it("la ficha: TSM a 414,66 contra 418,01 guardado (−0,80%), no contra los 418,60 de IEX (−0,94%)", async () => {
    const { store, deps } = setup();
    await store.upsertCandles("TSM", tsm);
    const d: TickerDeps = { ...deps, quote: async (s) => ({ symbol: s, price: 414.66, prevClose: 418.6, asOf: "2026-09-15T19:40:59.858Z" }) };
    const t = await buildTicker(d, "TSM", { today: "2026-09-15" });
    expect(t.quote).toMatchObject({ price: 414.66, prevClose: 418.01, prevCloseDate: "2026-09-14", change: -3.35, changePct: -0.8 });
  });
});

describe("liveQuotes", () => {
  it("pide todos los precios en paralelo con variación diaria; un error o un timeout dan null sin frenar al resto", async () => {
    const started: string[] = [];
    const quote = async (s: string) => {
      started.push(s);
      if (s === "CAIDO") throw new Error("fuente caída");
      if (s === "LENTO") return new Promise<never>(() => {});
      return { symbol: s, price: 41, prevClose: 40, asOf: "2026-09-08T14:00:00Z" };
    };
    const q = await liveQuotes(quote, ["ggal", "CAIDO", "LENTO"], { timeoutMs: 20 });
    expect(started).toEqual(["GGAL", "CAIDO", "LENTO"]);
    expect(q["GGAL"]).toEqual({ price: 41, prevClose: 40, change: 1, changePct: 2.5, asOf: "2026-09-08T14:00:00Z", currency: null });
    expect(q["CAIDO"]).toBeNull();
    expect(q["LENTO"]).toBeNull();
  });
  it("sin cierre previo no hay variación; la moneda viaja con el precio", async () => {
    const q = await liveQuotes(async (s) => ({ symbol: s, price: 10, prevClose: null, asOf: null, currency: "ARS" }), ["GGAL.BA"]);
    expect(q["GGAL.BA"]).toEqual({ price: 10, prevClose: null, change: null, changePct: null, asOf: null, currency: "ARS" });
  });
});

describe("buildTicker: verificación", () => {
  it("devuelve estados, eventos (sin ruido) y acciones de analistas guardados", async () => {
    const store = new MemoryStore();
    const d: TickerDeps = { store, history: { candles: async () => [] }, descriptions: { description: async () => null }, news: { companyNews: async () => [] }, quote: async () => null };
    await store.saveStatements({ symbol: "ZVRA", cik: "1434647", asOf: "2026-09-09", quarters: [], core: null });
    await store.upsertEvents([
      { symbol: "ZVRA", date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: "EMA", url: "https://n/1", source: null, why: "x", detectedAt: "2026-09-09T00:00:00Z", promptVersion: null },
      { symbol: "ZVRA", date: "2026-07-24", kind: "otro", severity: "ruido", headline: "resumen", url: "https://n/2", source: null, why: null, detectedAt: "2026-09-09T00:00:00Z", promptVersion: null },
    ]);
    await store.upsertAnalystActions([{ symbol: "ZVRA", date: "2026-07-27", firm: "BTIG", action: "mantiene", rating: "Buy", target: 24, url: "https://n/3" }]);
    const page = await buildTicker(d, "zvra", { today: "2026-09-09", timeoutMs: 1000 });
    expect(page.statements?.cik).toBe("1434647");
    expect(page.events.map((e) => e.headline)).toEqual(["EMA"]);
    expect(page.analystActions[0]?.target).toBe(24);
  });
  it("C5 (15/9): NBN estaba APTA con el cuestionario anterior y la ficha la pintaba en verde; la página dice si la verificación es del cuestionario vigente", async () => {
    const store = new MemoryStore();
    const d: TickerDeps = { store, history: { candles: async () => [] }, descriptions: { description: async () => null }, news: { companyNews: async () => [] }, quote: async () => null };
    await store.saveVerification({ symbol: "NBN", date: "2026-09-14", verdict: "apto", reason: "r", lastQuarter: null, analysts: [], consensusTarget: null, events: [], valuation: null, nextEarnings: null, sources: [{ title: "a", url: "https://a" }], researchText: "", promptVersion: "v1-c12a96012ca5-gemini", model: "gemini-2.5-flash", detectedAt: "2026-09-14T11:07:13.886Z" });
    const vieja = await buildTicker(d, "NBN", { today: "2026-09-15", timeoutMs: 1000, verifierPromptVersion: "v1-07c33234178c-gemini" });
    expect(vieja.verificationCurrent).toBe(false);
    expect((await buildTicker(d, "NBN", { today: "2026-09-15", timeoutMs: 1000, verifierPromptVersion: "v1-c12a96012ca5-gemini" })).verificationCurrent).toBe(true);
    // Sin verificador configurado no se afirma nada.
    expect((await buildTicker(d, "NBN", { today: "2026-09-15", timeoutMs: 1000 })).verificationCurrent).toBeNull();
  });
});
