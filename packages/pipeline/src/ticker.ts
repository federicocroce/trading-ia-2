import type { Candle, CandidateRow, Fundamentals, LiveQuote, NewsItem, Position, PriceHistory, SymbolDescription, Tags, Thesis, Transaction, VerdictRow } from "@thesis/core";
import { AXES, AXIS_METRICS } from "@thesis/core";
import type { CarteraStore, RadarStore, Store, TickerStore } from "./store.js";

/**
 * Página por ticker (etapa 2b): todo lo que el sistema sabe de un símbolo, servido desde la base.
 * Lo que cambia poco (descripción, velas diarias, noticias) se completa bajo demanda con TTL y se persiste;
 * solo el precio vivo se pide en el momento. Ninguna fuente externa bloquea la página.
 */
export interface TickerDeps {
  store: Store & CarteraStore & RadarStore & TickerStore;
  history: PriceHistory;
  descriptions: { description(symbol: string): Promise<SymbolDescription | null> };
  news: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> };
  quote: (symbol: string) => Promise<LiveQuote | null>;
  /** Última vez que se pidieron noticias por símbolo (epoch ms). El container comparte un Map; sin él no hay TTL. */
  newsFetchedAt?: Map<string, number>;
}
export interface TickerPage {
  symbol: string;
  description: SymbolDescription | null;
  quote: { price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null } | null;
  position: (Position & { valueUsd: number; pnlUsd: number; pnlPct: number; weightPct: number | null }) | null;
  verdict: VerdictRow | null;
  tags: Tags | null;
  fundamentals: Fundamentals | null;
  candidate: CandidateRow | null;
  peers: Array<{ symbol: string; metrics: Record<string, number | null> }>;
  theses: Thesis[];
  transactions: Transaction[];
  transactionSummary: { buys: { count: number; total: number }; sells: { count: number; total: number }; dividends: { count: number; total: number }; invested: number };
  candles: Candle[];
  news: NewsItem[];
  filings: string[];
  arNews: string[];
  errors: string[];
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const DESCRIPTION_TTL_DAYS = 30;
const NEWS_TTL_HOURS = 24;
const CANDLE_DAYS = 400;

export async function buildTicker(deps: TickerDeps, symbolRaw: string, opts: { today: string }): Promise<TickerPage> {
  const symbol = symbolRaw.toUpperCase();
  const { store } = deps;
  const errors: string[] = [];

  // Descripción (Yahoo), cache 30 días.
  let description = await store.description(symbol);
  if (!description || (Date.parse(opts.today) - Date.parse(description.updatedAt)) / DAY > DESCRIPTION_TTL_DAYS) {
    try {
      const fresh = await deps.descriptions.description(symbol);
      if (fresh) {
        await store.saveDescription(fresh);
        description = fresh;
      }
    } catch (e) {
      errors.push(`descripción: ${String(e).slice(0, 120)}`);
    }
  }

  // Velas diarias: de la base; si faltan, se traen y se persisten.
  let candles = await store.candles(symbol, addDays(opts.today, -CANDLE_DAYS));
  const last = candles[candles.length - 1]?.date;
  if (!candles.length || !last || (Date.parse(opts.today) - Date.parse(last)) / DAY > 4) {
    try {
      const fresh = await deps.history.candles(symbol, 260);
      if (fresh.length) {
        await store.upsertCandles(symbol, fresh);
        candles = await store.candles(symbol, addDays(opts.today, -CANDLE_DAYS));
      }
    } catch (e) {
      errors.push(`velas: ${String(e).slice(0, 120)}`);
    }
  }

  // Noticias (Finnhub), refresco cada 24 h por proceso.
  const lastFetch = deps.newsFetchedAt?.get(symbol) ?? 0;
  if (Date.now() - lastFetch > NEWS_TTL_HOURS * 3_600_000) {
    try {
      const items = await deps.news.companyNews(symbol, addDays(opts.today, -30), opts.today);
      await store.upsertNews(items);
      deps.newsFetchedAt?.set(symbol, Date.now());
    } catch (e) {
      errors.push(`noticias: ${String(e).slice(0, 120)}`);
    }
  }

  let quote: TickerPage["quote"] = null;
  try {
    const q = await deps.quote(symbol);
    if (q) {
      const change = q.prevClose ? round2(q.price - q.prevClose) : null;
      quote = { price: q.price, prevClose: q.prevClose, change, changePct: q.prevClose ? round2(((q.price - q.prevClose) / q.prevClose) * 100) : null, asOf: q.asOf };
    }
  } catch (e) {
    errors.push(`precio: ${String(e).slice(0, 120)}`);
  }

  const [positions, verdicts, tags, fundamentals, candidates, theses, txs, news, filings, risk] = await Promise.all([
    store.positions(),
    store.latestVerdicts(),
    store.tags(symbol),
    store.fundamentals(symbol),
    store.latestCandidates(),
    store.thesesForTicker(symbol, 20),
    store.transactions(),
    store.news(symbol, 20),
    store.recentFilingTitles(symbol, 10),
    store.latestRisk(),
  ]);
  const pos = positions.find((p) => p.symbol === symbol) ?? null;
  const price = quote?.price ?? candles[candles.length - 1]?.close ?? null;
  const position = pos && price !== null
    ? { ...pos, valueUsd: round2(pos.quantity * price), pnlUsd: round2((price - pos.avgCost) * pos.quantity), pnlPct: round2(((price - pos.avgCost) / pos.avgCost) * 100), weightPct: risk?.report.weights.find((w) => w.symbol === symbol)?.weightPct ?? null }
    : null;
  const candidate = candidates.find((c) => c.symbol === symbol) ?? null;
  const keys = AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key));
  const peers: TickerPage["peers"] = [];
  for (const p of candidate?.peerGroup ?? []) {
    const f = await store.fundamentals(p);
    if (f) peers.push({ symbol: p, metrics: Object.fromEntries(keys.map((k) => [k, f.metrics[k] ?? null])) });
  }
  const mine = txs.filter((t) => t.symbol === symbol).sort((a, b) => b.date.localeCompare(a.date));
  const sum = (type: Transaction["type"]) => {
    const rows = mine.filter((t) => t.type === type);
    return { count: rows.length, total: round2(rows.reduce((s, t) => s + t.quantity * t.price, 0)) };
  };
  const buys = sum("BUY");
  const sells = sum("SELL");
  const dividends = sum("DIVIDEND");
  const transfers = sum("TRANSFER");
  const arNews = description?.longName ? await store.recentNewsTitles(description.longName.split(" ")[0] ?? symbol, 5) : [];

  return {
    symbol,
    description,
    quote,
    position,
    verdict: verdicts.find((v) => v.symbol === symbol) ?? null,
    tags,
    fundamentals,
    candidate,
    peers,
    theses,
    transactions: mine,
    transactionSummary: { buys, sells, dividends, invested: round2(buys.total + transfers.total - sells.total) },
    candles,
    news,
    filings,
    arNews,
    errors,
  };
}
