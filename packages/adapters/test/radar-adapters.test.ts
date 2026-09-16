import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { AlpacaAssets, FinnhubFundamentals, RateLimiter, SecStatements, fixtureHttpClient } from "../src/index.js";

const cfg = { keyId: "k", secretKey: "s", paper: true as const };

describe("RateLimiter", () => {
  it("deja pasar 55 por minuto y hace esperar la 56.ª hasta que venza la ventana", async () => {
    let now = 0;
    const waits: number[] = [];
    const rl = new RateLimiter(55, () => now, async (ms) => { waits.push(ms); now += ms; });
    for (let i = 0; i < 55; i++) await rl.acquire();
    expect(waits).toEqual([]);
    await rl.acquire();
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(0);
  });
});

describe("AlpacaAssets", () => {
  it("lista activos y pide snapshots en lotes de 100", async () => {
    const symbols = Array.from({ length: 250 }, (_, i) => `S${i}`);
    const snaps = Object.fromEntries(symbols.map((s) => [s, { latestTrade: { p: 10 }, dailyBar: { c: 10, v: 1000 } }]));
    const http = fixtureHttpClient({
      "https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity": [{ symbol: "AAPL", name: "Apple", exchange: "NASDAQ", tradable: true, status: "active" }, { symbol: "XYZ", name: "Xyz", exchange: "OTC", tradable: false, status: "active" }],
      "https://data.alpaca.markets/v2/stocks/snapshots?symbols=": snaps,
    });
    const a = new AlpacaAssets(http, cfg);
    expect(await a.list()).toEqual([{ symbol: "AAPL", name: "Apple", exchange: "NASDAQ", tradable: true }, { symbol: "XYZ", name: "Xyz", exchange: "OTC", tradable: false }]);
    const out = await a.snapshots(symbols);
    expect(out).toHaveLength(250);
    expect(out[0]).toEqual({ symbol: "S0", price: 10, iexVolume: 1000 });
  });
  it("quote: último precio, cierre previo y hora", async () => {
    const http = fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/snapshots?symbols=GGAL": { GGAL: { latestTrade: { p: 44.32, t: "2026-09-08T19:59:00Z" }, dailyBar: { c: 44.36, v: 1000 }, prevDailyBar: { c: 43.9, v: 900 } } } });
    expect(await new AlpacaAssets(http, cfg).quote("ggal")).toEqual({ symbol: "GGAL", price: 44.32, prevClose: 43.9, asOf: "2026-09-08T19:59:00Z" });
    expect(await new AlpacaAssets(fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/snapshots?symbols=ZZZ": {} }), cfg).quote("ZZZ")).toBeNull();
    // Por lote: precio, cierre anterior y hora del último trade; los que no vienen quedan afuera.
    const many = fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/snapshots?symbols=GGAL,ZZZ": { GGAL: { latestTrade: { p: 44.32, t: "2026-09-08T19:59:00Z" }, dailyBar: { c: 44.36, v: 1000 }, prevDailyBar: { c: 43.9, v: 900 } } } });
    expect(await new AlpacaAssets(many, cfg).quotes(["ggal", "ZZZ"])).toEqual([{ symbol: "GGAL", price: 44.32, prevClose: 43.9, asOf: "2026-09-08T19:59:00Z" }]);
  });
  it("snapshot sin datos → price/volumen null", async () => {
    const http = fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/snapshots?symbols=": { A: {} } });
    expect(await new AlpacaAssets(http, cfg).snapshots(["A"])).toEqual([{ symbol: "A", price: null, iexVolume: null }]);
  });
});

describe("FinnhubFundamentals", () => {
  const today = "2026-09-07";
  const http = fixtureHttpClient({
    "https://finnhub.io/api/v1/stock/profile2?symbol=TSM": { name: "TSMC", country: "TW", finnhubIndustry: "Semiconductors", marketCapitalization: 61978364, currency: "TWD", shareOutstanding: 25930 },
    "https://finnhub.io/api/v1/stock/metric?symbol=TSM": { metric: { peTTM: 27.35, roeTTM: 39.86, "3MonthAverageTradingVolume": 36.5 }, series: {} },
    "https://finnhub.io/api/v1/stock/metric?symbol=NONE": { metric: {}, series: {} },
    "https://finnhub.io/api/v1/stock/peers?symbol=TSM": ["TSM", "2330.TW", "NVDA", "AMD"],
    "https://finnhub.io/api/v1/stock/recommendation?symbol=TSM": [{ symbol: "TSM", period: "2026-09-01", strongBuy: 12, buy: 29, hold: 2, sell: 0, strongSell: 0 }, { symbol: "TSM", period: "2026-08-01", strongBuy: 10, buy: 30, hold: 3, sell: 0, strongSell: 0 }],
    "https://finnhub.io/api/v1/stock/earnings?symbol=TSM": [{ period: "2026-06-30", actual: 2.44, estimate: 2.2, surprisePercent: 10.92 }, { period: "2026-03-31", actual: 2.12, estimate: 2.03, surprisePercent: 4.44 }, { period: "2025-12-31", surprisePercent: null }, { period: "2025-09-30", actual: 1.01, estimate: 1, surprisePercent: 1 }, { period: "2025-06-30", surprisePercent: 2 }],
    "https://finnhub.io/api/v1/stock/insider-transactions?symbol=TSM": { data: [{ transactionCode: "P", transactionDate: "2026-08-03", change: 1000 }, { transactionCode: "S", transactionDate: "2026-07-01", change: -500 }, { transactionCode: "P", transactionDate: "2026-01-01", change: 100 }, { transactionCode: "A", transactionDate: "2026-08-20", change: 5000 }] },
    "https://finnhub.io/api/v1/calendar/earnings?from=2026-09-07&to=2027-01-05&symbol=TSM": { earningsCalendar: [{ date: "2026-10-16", symbol: "TSM" }, { date: "2027-01-15", symbol: "TSM" }] },
    "https://finnhub.io/api/v1/calendar/earnings?from=2026-09-07&to=2027-01-05&symbol=NONE": { earningsCalendar: [] },
  });
  const f = new FinnhubFundamentals(http, "tok", new RateLimiter(1000));
  it("perfil con moneda y acciones en circulación", async () => {
    expect(await f.profile("TSM")).toEqual({ symbol: "TSM", name: "TSMC", country: "TW", industry: "Semiconductors", marketCap: 61_978_364_000_000, currency: "TWD", shareOutstanding: 25930 });
  });
  it("métricas: objeto plano; vacío → null", async () => {
    expect((await f.metrics("TSM"))!["peTTM"]).toBe(27.35);
    expect(await f.metrics("NONE")).toBeNull();
  });
  it("pares sin el propio símbolo", async () => expect(await f.peers("TSM")).toEqual(["2330.TW", "NVDA", "AMD"]));
  it("consenso: el período más reciente", async () => expect((await f.recommendation("TSM"))!.period).toBe("2026-09-01"));
  it("sorpresas: últimas 4", async () => expect((await f.earningsSurprises("TSM"))!.map((s) => s.period)).toEqual(["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30"]));
  /**
   * 16/9: la app guardaba sólo el porcentaje, así que "el último resultado decepcionó" no se podía contrastar con
   * nada. SPNT marcaba −10,85% y en el comunicado había superado (0,67 operativa contra 0,65 de consenso); la cuenta
   * (0,58 contable − 0,65) / 0,65 = −10,77% dice que el proveedor compara la contable contra un consenso operativo.
   * Con los dos números guardados, la pantalla muestra contra qué se está midiendo.
   */
  it("sorpresas: guarda con qué números se calculó el porcentaje", async () => {
    const s = (await f.earningsSurprises("TSM"))!;
    expect(s[0]).toEqual({ period: "2026-06-30", actual: 2.44, estimate: 2.2, surprisePercent: 10.92 });
    expect(s[2]).toEqual({ period: "2025-12-31", actual: null, estimate: null, surprisePercent: null });
  });
  it("insiders: solo P y S dentro de la ventana", async () => expect(await f.insiders("TSM", 90, today)).toEqual({ buys: 1, sells: 1 }));
  it("próximos resultados: primera fecha ≥ hoy; null si no hay", async () => {
    expect(await f.nextEarnings("TSM", today)).toBe("2026-10-16");
    expect(await f.nextEarnings("NONE", today)).toBeNull();
  });
});

describe("SecStatements", () => {
  const facts = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8"));
  const http = fixtureHttpClient({
    "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1434647, ticker: "ZVRA", title: "Zevra Therapeutics, Inc." } },
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0001434647.json": facts,
  });
  it("resuelve el CIK, baja companyfacts y devuelve trimestres con núcleo", async () => {
    const s = await new SecStatements(http).quarters("zvra", "2026-09-09");
    expect(s?.symbol).toBe("ZVRA");
    expect(s?.cik).toBe("1434647");
    expect(s?.asOf).toBe("2026-09-09");
    expect(s?.quarters.length).toBeGreaterThanOrEqual(6);
    expect(s?.core?.asOf).toBe("2026-06-30");
  });
  it("símbolo sin CIK → null (IFRS, extranjero)", async () => {
    expect(await new SecStatements(http).quarters("VIST", "2026-09-09")).toBeNull();
  });
  it("CIK resuelto pero companyfacts sin trimestres → null", async () => {
    const empty = { cik: 1, facts: {} };
    const http2 = fixtureHttpClient({
      "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1, ticker: "EMPTY", title: "Empty Corp" } },
      "https://data.sec.gov/api/xbrl/companyfacts/CIK0000000001.json": empty,
    });
    expect(await new SecStatements(http2).quarters("EMPTY", "2026-09-09")).toBeNull();
  });
});
