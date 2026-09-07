import { describe, expect, it } from "vitest";
import { FinnhubFundamentals, RateLimiter, YahooChart, YahooDescriptions, fixtureHttpClient, parseYahooBars, parseYahooProfile } from "../src/index.js";

const chart = { chart: { result: [{ meta: { firstTradeDate: 946684800, fullExchangeName: "NasdaqGS", regularMarketPrice: 44.36 }, timestamp: [1756684800, 1756685100], indicators: { quote: [{ open: [10, 11], high: [12, 12], low: [9, 10], close: [11, 11.5], volume: [100, 50] }], adjclose: [{ adjclose: [5.5, 5.75] }] } }], error: null } };

describe("parseYahooBars", () => {
  it("mantiene timestamps y ajusta la vela por adjclose/close (splits)", () => {
    const bars = parseYahooBars(chart);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toEqual({ time: 1756684800, open: 5, high: 6, low: 4.5, close: 5.5, volume: 100 });
  });
  it("descarta velas con nulos", () => {
    const j = { chart: { result: [{ meta: {}, timestamp: [1, 2], indicators: { quote: [{ open: [1, null], high: [1, 1], low: [1, 1], close: [1, 1], volume: [1, 1] }] } }], error: null } };
    expect(parseYahooBars(j)).toHaveLength(1);
  });
});

describe("YahooChart", () => {
  it("pide range/interval y devuelve barras", async () => {
    const http = fixtureHttpClient({ "https://query2.finance.yahoo.com/v8/finance/chart/GGAL?range=1d&interval=5m": chart });
    expect((await new YahooChart(http).bars("ggal", "1d", "5m")).length).toBe(2);
  });
});

describe("parseYahooProfile", () => {
  it("arma la descripción desde quoteSummary + meta del chart", () => {
    const qs = { quoteSummary: { result: [{ assetProfile: { sector: "Financial Services", industry: "Banks—Regional", longBusinessSummary: "Grupo Financiero Galicia…", fullTimeEmployees: 9000, country: "Argentina", website: "https://www.gfgsa.com/" }, quoteType: { longName: "Grupo Financiero Galicia S.A.", exchange: "NMS" } }], error: null } };
    const d = parseYahooProfile("GGAL", qs, chart, "2026-09-07T00:00:00Z");
    expect(d).toEqual({ symbol: "GGAL", longName: "Grupo Financiero Galicia S.A.", summary: "Grupo Financiero Galicia…", employees: 9000, website: "gfgsa.com", exchangeName: "NasdaqGS", firstTradeDate: "2000-01-01", sector: "Financial Services", industry: "Banks—Regional", country: "Argentina", updatedAt: "2026-09-07T00:00:00Z" });
  });
  it("sin resultado → null; 0 empleados → null", () => {
    expect(parseYahooProfile("X", { quoteSummary: { result: null, error: { code: "x", description: "no" } } }, chart, "t")).toBeNull();
    const qs = { quoteSummary: { result: [{ assetProfile: { fullTimeEmployees: 0 }, quoteType: {} }], error: null } };
    expect(parseYahooProfile("X", qs, chart, "t")?.employees).toBeNull();
  });
});

describe("YahooDescriptions", () => {
  it("consigue cookie + crumb y pide quoteSummary con ambos; cae a la URL sin crumb si falla", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push({ url, headers: (init?.headers as Record<string, string>) ?? {} });
      if (url.startsWith("https://fc.yahoo.com")) return new Response("", { status: 404, headers: { "set-cookie": "A3=abc; Path=/" } });
      if (url.includes("getcrumb")) return new Response("CRUMB123", { status: 200 });
      if (url.includes("quoteSummary")) return new Response(JSON.stringify({ quoteSummary: { result: [{ assetProfile: { longBusinessSummary: "hace cosas" }, quoteType: { longName: "X Inc" } }], error: null } }), { status: 200 });
      if (url.includes("/v8/finance/chart/")) return new Response(JSON.stringify(chart), { status: 200 });
      return new Response("", { status: 500 });
    }) as unknown as typeof fetch;
    const d = await new YahooDescriptions(fetchFn, () => 0).description("X");
    expect(d?.summary).toBe("hace cosas");
    const qs = calls.find((c) => c.url.includes("quoteSummary"))!;
    expect(qs.url).toContain("crumb=CRUMB123");
    expect(qs.headers["Cookie"]).toBe("A3=abc");
  });
});

describe("Finnhub company news", () => {
  it("mapea noticias con fecha, fuente, url y resumen", async () => {
    const http = fixtureHttpClient({ "https://finnhub.io/api/v1/company-news?symbol=GGAL&from=2026-08-08&to=2026-09-07": [{ datetime: 1757000000, headline: "Galicia sube", source: "Reuters", url: "https://x/1", summary: "…" }, { datetime: 1756000000, headline: "Otra", source: "", url: "https://x/2", summary: "" }] });
    const n = await new FinnhubFundamentals(http, "t", new RateLimiter(1000)).companyNews("GGAL", "2026-08-08", "2026-09-07");
    expect(n[0]).toEqual({ symbol: "GGAL", date: "2025-09-04", headline: "Galicia sube", source: "Reuters", url: "https://x/1", summary: "…" });
    expect(n[1]!.source).toBeNull();
  });
});
