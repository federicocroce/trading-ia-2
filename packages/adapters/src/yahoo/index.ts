import type { Candle, ChartBar, PriceHistory, SymbolDescription, LiveQuote } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

interface YahooQuote {
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}
interface YahooChartResp {
  chart: {
    result: Array<{ timestamp?: number[]; indicators: { quote: YahooQuote[]; adjclose?: Array<{ adjclose: Array<number | null> }> } }> | null;
    error: { code: string; description: string } | null;
  };
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Parser puro del chart API v8 de Yahoo. */
export function parseYahooChart(json: unknown): Candle[] {
  const d = json as YahooChartResp;
  if (d.chart?.error) throw new Error(`yahoo: ${d.chart.error.description}`);
  const r = d.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0]!;
  // `adjclose` incluye dividendos: sin él, un ETF de letras parece plano (ver Candle.adjClose).
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const out: Candle[] = [];
  r.timestamp.forEach((ts, i) => {
    const close = q.close[i];
    if (close === null || close === undefined) return;
    const a = adj?.[i];
    // Yahoo devuelve floats con ruido (44.36000061035156): se redondea a 4 decimales en la fuente.
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), adjClose: a != null && Number.isFinite(a) ? r4(a) : null, open: r4(q.open[i] ?? close), high: r4(q.high[i] ?? close), low: r4(q.low[i] ?? close), close: r4(close), volume: q.volume[i] ?? 0});
  });
  return out;
}

const rangeFor = (days: number) => (days <= 60 ? "3mo" : days <= 120 ? "6mo" : days <= 250 ? "1y" : "2y");

/** Velas diarias de Yahoo (API no oficial; gratis; cubre .BA para la etapa 3). */
export class YahooPriceHistory implements PriceHistory {
  constructor(private readonly http: HttpClient) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=${rangeFor(days)}&interval=1d`;
    return parseYahooChart(await this.http.getJson(url));
  }
}

// ---------- gráfico y perfil (página por ticker) ----------

interface YahooChartFull {
  chart: {
    result: Array<{
      meta?: { firstTradeDate?: number; fullExchangeName?: string; regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number; currency?: string };
      timestamp?: number[];
      indicators: { quote: YahooQuote[]; adjclose?: Array<{ adjclose: Array<number | null> }> };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

/** Barras con timestamp (intradiario o diario), escaladas por adjclose/close para corregir splits. */
export function parseYahooBars(json: unknown): ChartBar[] {
  const d = json as YahooChartFull;
  if (d.chart?.error) throw new Error(`yahoo: ${d.chart.error.description}`);
  const r = d.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0]!;
  const adj = r.indicators.adjclose?.[0]?.adjclose;
  const out: ChartBar[] = [];
  r.timestamp.forEach((ts, i) => {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (o == null || h == null || l == null || c == null) return;
    const a = adj?.[i];
    const f = a != null && Number.isFinite(a) && c > 0 ? a / c : 1;
    out.push({ time: ts, open: r4(o * f), high: r4(h * f), low: r4(l * f), close: r4(c * f), volume: q.volume[i] ?? 0 });
  });
  return out;
}

export type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y";
export type YahooInterval = "5m" | "15m" | "1h" | "1d" | "1wk";

/** Precio vivo desde la meta del chart: sirve para símbolos que Alpaca no cubre (los .BA, en pesos). */
export function parseYahooQuote(symbol: string, json: unknown): LiveQuote | null {
  const d = json as YahooChartFull;
  if (d.chart?.error) throw new Error(`yahoo: ${d.chart.error.description}`);
  const meta = d.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (price === undefined || !Number.isFinite(price)) return null;
  const prev = meta?.chartPreviousClose ?? meta?.previousClose ?? null;
  return { symbol: symbol.toUpperCase(), price, prevClose: prev, asOf: meta?.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null, currency: meta?.currency ?? null };
}

export class YahooChart {
  constructor(private readonly http: HttpClient) {}
  async bars(symbol: string, range: YahooRange, interval: YahooInterval): Promise<ChartBar[]> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=${range}&interval=${interval}`;
    return parseYahooBars(await this.http.getJson(url));
  }
  async quote(symbol: string): Promise<LiveQuote | null> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=5d&interval=1d`;
    return parseYahooQuote(symbol, await this.http.getJson(url));
  }
}

interface QuoteSummary {
  quoteSummary: {
    result: Array<{
      assetProfile?: { sector?: string; industry?: string; longBusinessSummary?: string; fullTimeEmployees?: number; country?: string; website?: string; companyName?: string };
      quoteType?: { longName?: string; exchange?: string };
    }> | null;
    error: { code: string; description: string } | null;
  };
}

const cleanWeb = (w: string | undefined | null) => (w ? w.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, "") || null : null);

/** Perfil desde quoteSummary (assetProfile + quoteType) y la meta del chart (primera rueda, nombre del mercado). Puro. */
export function parseYahooProfile(symbol: string, quoteSummary: unknown, chartMeta: unknown, updatedAt: string): SymbolDescription | null {
  const qs = quoteSummary as QuoteSummary;
  const r = qs?.quoteSummary?.result?.[0];
  if (!r) return null;
  const p = r.assetProfile ?? {};
  const t = r.quoteType ?? {};
  const meta = (chartMeta as YahooChartFull)?.chart?.result?.[0]?.meta;
  const ftd = meta?.firstTradeDate;
  return {
    symbol: symbol.toUpperCase(),
    longName: t.longName ?? p.companyName ?? null,
    summary: p.longBusinessSummary?.trim() || null,
    employees: typeof p.fullTimeEmployees === "number" && p.fullTimeEmployees > 0 ? p.fullTimeEmployees : null,
    website: cleanWeb(p.website),
    exchangeName: meta?.fullExchangeName ?? t.exchange ?? null,
    firstTradeDate: typeof ftd === "number" && ftd > 0 ? new Date(ftd * 1000).toISOString().slice(0, 10) : null,
    sector: p.sector ?? null,
    industry: p.industry ?? null,
    country: p.country ?? null,
    updatedAt,
  };
}

const YAHOO_UA = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" };

/**
 * Descripción de empresa desde Yahoo (quoteSummary exige cookie + crumb; portado de trading v1).
 * `fetch` y reloj inyectables. Fail-closed: cualquier problema → null, nunca un perfil inventado.
 */
export class YahooDescriptions {
  private crumb: { crumb: string; cookie: string; at: number } | null = null;
  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}
  private async ensureCrumb(): Promise<{ crumb: string; cookie: string } | null> {
    if (this.crumb && this.now() - this.crumb.at < 30 * 60_000) return this.crumb;
    try {
      const consent = await this.fetchFn("https://fc.yahoo.com", { headers: YAHOO_UA, redirect: "manual" });
      const cookie = consent.headers.get("set-cookie")?.split(";")[0] ?? "";
      if (!cookie) return null;
      const res = await this.fetchFn("https://query2.finance.yahoo.com/v1/test/getcrumb", { headers: { ...YAHOO_UA, Cookie: cookie } });
      if (!res.ok) return null;
      const crumb = await res.text();
      if (!crumb || crumb.includes("<")) return null;
      this.crumb = { crumb, cookie, at: this.now() };
      return this.crumb;
    } catch {
      return null;
    }
  }
  async description(symbol: string): Promise<SymbolDescription | null> {
    const sym = symbol.toUpperCase();
    const auth = await this.ensureCrumb();
    const modules = "assetProfile,quoteType";
    const attempt = async (base: string, headers: Record<string, string>, crumb: string | null) => {
      try {
        const res = await this.fetchFn(`${base}/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=${modules}${crumb ? `&crumb=${encodeURIComponent(crumb)}` : ""}`, { headers });
        return res.ok ? await res.json() : null;
      } catch {
        return null;
      }
    };
    let qs: unknown = auth ? await attempt("https://query2.finance.yahoo.com", { ...YAHOO_UA, Cookie: auth.cookie }, auth.crumb) : null;
    if (!qs) qs = await attempt("https://query1.finance.yahoo.com", YAHOO_UA, null);
    if (!qs) return null;
    let meta: unknown = null;
    try {
      const res = await this.fetchFn(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=1d&interval=1d`, { headers: YAHOO_UA });
      meta = res.ok ? await res.json() : null;
    } catch {
      meta = null;
    }
    return parseYahooProfile(sym, qs, meta ?? {}, new Date(this.now()).toISOString());
  }
}

/**
 * Buscador de símbolos para el alta a la watchlist (portado de trading v1): Yahoo search, sin key ni crumb.
 * Solo mercados que la app puede cotizar: bolsas de EE.UU. (Alpaca) y Buenos Aires (Yahoo .BA). Cripto queda marcado aparte.
 */
export interface SymbolHit {
  symbol: string;
  name: string;
  exchange: string;
  type: "accion_us" | "accion_ar" | "cedear" | "etf" | "cripto";
  flag: string;
}
interface YahooSearchResp {
  quotes?: Array<{ symbol?: string; shortname?: string; longname?: string; exchange?: string; exchDisp?: string; quoteType?: string; isYahooFinance?: boolean }>;
}
const US_EXCHANGES = new Set(["NMS", "NYQ", "NGM", "NCM", "ASE", "PCX", "BTS", "NAS", "NYS"]);

export function parseYahooSearch(json: unknown): SymbolHit[] {
  const quotes = (json as YahooSearchResp)?.quotes ?? [];
  const out: SymbolHit[] = [];
  for (const q of quotes) {
    if (!q.symbol || q.isYahooFinance === false) continue;
    const name = q.longname ?? q.shortname ?? q.symbol;
    const exchange = q.exchDisp ?? q.exchange ?? "";
    const short = (q.shortname ?? "").toUpperCase();
    let hit: SymbolHit | null = null;
    if (q.quoteType === "CRYPTOCURRENCY") hit = { symbol: q.symbol, name, exchange, type: "cripto", flag: "₿" };
    else if (q.exchange === "BUE" || q.symbol.endsWith(".BA")) hit = { symbol: q.symbol, name, exchange, type: short.includes("CEDEAR") ? "cedear" : "accion_ar", flag: "🇦🇷" };
    else if (q.quoteType === "ETF" && US_EXCHANGES.has(q.exchange ?? "")) hit = { symbol: q.symbol, name, exchange, type: "etf", flag: "📦" };
    else if (q.quoteType === "EQUITY" && US_EXCHANGES.has(q.exchange ?? "")) hit = { symbol: q.symbol, name, exchange, type: "accion_us", flag: "🇺🇸" };
    if (hit) out.push(hit);
  }
  return out;
}

export class YahooSearch {
  constructor(private readonly http: HttpClient) {}
  async search(query: string): Promise<SymbolHit[]> {
    const q = query.trim();
    if (!q) return [];
    return parseYahooSearch(await this.http.getJson(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0&listsCount=0`));
  }
}
