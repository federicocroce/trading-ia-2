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
  log?: (msg: string) => void;
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
  /** Fuentes que no se esperaron (modo rápido) y se están completando en segundo plano. */
  pending: string[];
  /** Milisegundos por fuente y total, para saber qué tarda cuando la página se siente lenta. */
  timings: Record<string, number>;
}

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const round2 = (n: number) => Math.round(n * 100) / 100;
const DESCRIPTION_TTL_DAYS = 30;
const CANDLES_STALE_DAYS = 4;
const NEWS_TTL_HOURS = 24;
const CANDLE_DAYS = 400;
/** Ninguna fuente externa puede colgar la página más que esto; después se sirve lo que hay. */
export const DEFAULT_SOURCE_TIMEOUT_MS = 6_000;

/** Rechaza con un mensaje claro si la promesa no resuelve a tiempo. */
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} tardó más de ${ms} ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 120);

/**
 * Regla de carga: lo guardado se sirve al instante. Si falta, se pide con timeout; si está viejo,
 * se sirve igual y se refresca en segundo plano para la próxima visita. Las fuentes corren en paralelo.
 * Con `live: false` (modo rápido) ni siquiera se espera lo que falta: se dispara atrás y se marca en `pending`,
 * para que la UI pinte lo guardado ya y complete con una segunda llamada.
 */
export async function buildTicker(deps: TickerDeps, symbolRaw: string, opts: { today: string; timeoutMs?: number; live?: boolean }): Promise<TickerPage> {
  const symbol = symbolRaw.toUpperCase();
  const { store } = deps;
  const errors: string[] = [];
  const pending: string[] = [];
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const live = opts.live ?? true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const background = (label: string, fn: () => Promise<unknown>) => {
    fn().catch((e) => deps.log?.(`[ticker] ${symbol} ${label} en segundo plano falló: ${errText(e)}`));
  };
  const guarded = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    if (!live) {
      background(label, fn);
      pending.push(label);
      return null;
    }
    const start = Date.now();
    try {
      return await withTimeout(fn(), timeoutMs, label);
    } catch (e) {
      errors.push(`${label}: ${errText(e)}`);
      return null;
    } finally {
      timings[label] = Date.now() - start;
    }
  };
  const daysOld = (iso: string) => (Date.parse(opts.today) - Date.parse(iso)) / DAY;
  const since = addDays(opts.today, -CANDLE_DAYS);

  // Descripción (Yahoo), cache 30 días.
  const fetchDescription = async () => {
    const fresh = await deps.descriptions.description(symbol);
    if (fresh) await store.saveDescription(fresh);
    return fresh;
  };
  const descriptionP = store.description(symbol).then((stored) => {
    if (!stored) return guarded("descripción", fetchDescription);
    if (daysOld(stored.updatedAt) > DESCRIPTION_TTL_DAYS) background("descripción", fetchDescription);
    return stored;
  });

  // Velas diarias: de la base; si faltan se traen y persisten; si están viejas se refrescan atrás.
  const fetchCandles = async () => {
    const fresh = await deps.history.candles(symbol, 260);
    if (fresh.length) await store.upsertCandles(symbol, fresh);
    return fresh.length ? store.candles(symbol, since) : [];
  };
  const candlesP = store.candles(symbol, since).then(async (stored) => {
    const last = stored[stored.length - 1]?.date;
    if (!last) return (await guarded("velas", fetchCandles)) ?? [];
    if (daysOld(last) > CANDLES_STALE_DAYS) background("velas", fetchCandles);
    return stored;
  });

  // Noticias (Finnhub), refresco cada 24 h por proceso.
  const fetchNews = async () => {
    const items = await deps.news.companyNews(symbol, addDays(opts.today, -30), opts.today);
    await store.upsertNews(items);
    return store.news(symbol, 20);
  };
  const newsP = store.news(symbol, 20).then(async (stored) => {
    const lastFetch = deps.newsFetchedAt?.get(symbol) ?? 0;
    if (Date.now() - lastFetch <= NEWS_TTL_HOURS * 3_600_000) return stored;
    deps.newsFetchedAt?.set(symbol, Date.now());
    // Si el pedido falla, se borra la marca para reintentar en la próxima visita en vez de esperar 24 h.
    const retryLater = () => deps.newsFetchedAt?.delete(symbol);
    if (stored.length || !live) {
      background("noticias", () => fetchNews().catch((e) => { retryLater(); throw e; }));
      if (!stored.length) pending.push("noticias");
      return stored;
    }
    const fresh = await guarded("noticias", fetchNews);
    if (fresh === null) retryLater();
    return fresh ?? [];
  });

  const quoteP = guarded("precio", () => deps.quote(symbol)).then((q): TickerPage["quote"] => {
    if (!q) return null;
    const change = q.prevClose ? round2(q.price - q.prevClose) : null;
    return { price: q.price, prevClose: q.prevClose, change, changePct: q.prevClose ? round2(((q.price - q.prevClose) / q.prevClose) * 100) : null, asOf: q.asOf };
  });

  const dbStart = Date.now();
  const [description, candles, news, quote, positions, verdicts, tags, fundamentals, candidates, theses, txs, filings, risk] = await Promise.all([
    descriptionP,
    candlesP,
    newsP,
    quoteP,
    store.positions(),
    store.latestVerdicts(),
    store.tags(symbol),
    store.fundamentals(symbol),
    store.latestCandidates(),
    store.thesesForTicker(symbol, 20),
    store.transactions(),
    store.recentFilingTitles(symbol, 10),
    store.latestRisk(),
  ]);
  timings["fuentes+base"] = Date.now() - dbStart;
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
  // TRANSFER es un movimiento entre plataformas (Buenbit → Nexo), no plata nueva: no entra en "invertido".
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
    transactionSummary: { buys, sells, dividends, invested: round2(buys.total - sells.total) },
    candles,
    news,
    filings,
    arNews,
    errors,
    pending,
    timings: { ...timings, total: Date.now() - t0 },
  };
}
