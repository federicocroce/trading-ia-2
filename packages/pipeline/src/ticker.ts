import type { AnalystAction, Candle, CandidateRow, CandidateVerification, Fundamentals, HechoExterno, LiveQuote, NewsItem, Position, PriceHistory, RadarEvent, Statements, SymbolDescription, Tags, Thesis, Transaction, VerdictRow } from"@thesis/core";
import { AXES, AXIS_METRICS, atr, dividendYieldPct, groupMedians, hechosVigentes, holdTargetOf, unreliableGrowthKeys, VENTANA_MAXIMA_DIAS } from "@thesis/core";
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
  /** `prevCloseDate`: el cambio del día se midió contra el cierre guardado de esa fecha; sin él, contra el de la fuente. */
  quote: { price: number; prevClose: number | null; change: number | null; changePct: number | null; asOf: string | null; currency: string | null; prevCloseDate?: string } | null;
  position: (Position & { valueUsd: number; pnlUsd: number; pnlPct: number; weightPct: number | null }) | null;
  verdict: (VerdictRow & { holdTarget: number | null }) | null;
  tags: Tags | null;
  fundamentals: Fundamentals | null;
  /**
   * Rendimiento por dividendo de los últimos doce meses, calculado con `dividendYieldPct` (lo que la empresa pagó
   * sobre el precio que la app tiene). La ficha mostraba `dividendYieldIndicatedAnnual`, que decía 3,44% en MCY
   * cuando paga 1,25%, y 1,83% en HCI cuando paga 0,85% (16/9). null = no se puede comprobar lo que pagó.
   */
  dividendYieldPct: number | null;
  candidate: CandidateRow | null;
  peers: PeerRowView[];
  /** Mediana de cada métrica en el grupo completo, la propia incluida: la referencia exacta del puntaje. */
  medians: Record<string, number | null> | null;
  /** Métricas que el puntaje no usa para este símbolo (en bancos, el crecimiento de ingresos de Finnhub). */
  ownExcluded: string[];
  /** Verificación (spec verificación): estados de la SEC, eventos materiales de 90 días sin ruido, acciones de analistas de 90 días. */
  statements: Statements | null;
  events: RadarEvent[];
  analystActions: AnalystAction[];
  /** Hechos externos vigentes (17/9), verificados o no: la ficha los muestra con su estado y su fuente. */
  hechos: HechoExterno[];
  /**
   * Hasta qué fecha se leyeron las noticias de este símbolo. `null` = nunca se leyeron, y entonces una lista
   * de eventos vacía no significa que no haya pasado nada: significa que nadie miró. La pantalla tiene que
   * poder distinguir las dos cosas.
   */
  newsScannedTo: string | null;
  /** Verificación web del candidato (spec 2026-09-10), si existe. */
  verification: CandidateVerification | null;
  /**
   * ¿La verificación es del cuestionario vigente? null = no hay verificación o no hay verificador para comparar. El
   * 15/9 NBN y NVDA estaban APTAS con el cuestionario anterior, que el plan ya no acepta, y la ficha las pintaba en verde.
   */
  verificationCurrent: boolean | null;
  theses: Thesis[];
  transactions: Transaction[];
  transactionSummary: {
    buys: { count: number; total: number };
    sells: { count: number; total: number };
    dividends: { count: number; total: number };
    /** Acciones recibidas por dividendo reinvertido (DRIP). Si es > 0, `dividends.total` NO es plata cobrada. */
    dividendShares: number;
    invested: number;
  };
  candles: Candle[];
  /**
   * ATR de 14 ruedas de las velas guardadas (el `atr` del núcleo), para decir a cuántos ATR está el precio del stop. El
   * 15/9 TSM estaba a 0,2 ATR del stop y la ficha mostraba "relación 67,8 : 1" en vez de avisarlo.
   */
  atr14: number | null;
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
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
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

/** Fila de la tabla de comparables: métricas del puntaje y cuáles de ellas el puntaje NO usa para esa empresa. */
export interface PeerRowView {
  symbol: string;
  metrics: Record<string, number | null>;
  excluded: string[];
}

/**
 * Tabla de comparables con la mediana del puntaje, para la ficha y el detalle del Radar (15/9). Los pares se armaban
 * con `{ symbol, metrics }`, sin la industria, así que `groupMedians` no podía aplicar la regla de los bancos: en NBN
 * (diez pares, todos bancos) la tabla mostraba una mediana de crecimiento de ingresos de 53,2% y pintaba en verde el
 * 123,9% de NBN, cuando el ranking no usa ese dato en bancos (`crecimiento_no_confiable`) y su mediana es nula. Ahora
 * la mediana sale de las fundamentales completas, igual que en `rankStocks`, y cada fila dice qué métricas no cuentan.
 */
export async function comparables(store: Pick<RadarStore, "fundamentals">, own: Fundamentals | null, peerGroup: string[]): Promise<{ peers: PeerRowView[]; medians: Record<string, number | null> | null; ownExcluded: string[] }> {
  const keys = AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key));
  const full: Fundamentals[] = [];
  for (const p of peerGroup) {
    const f = await store.fundamentals(p);
    if (f) full.push(f);
  }
  const peers = full.map((f) => ({ symbol: f.symbol, metrics: Object.fromEntries(keys.map((k) => [k, f.metrics[k] ?? null])), excluded: unreliableGrowthKeys(f) }));
  // Misma mediana que el puntaje, calculada en un solo lugar (ver `groupMedians`), con la industria de cada uno.
  const medians = own && full.length ? groupMedians([own, ...full]) : null;
  return { peers, medians, ownExcluded: own ? unreliableGrowthKeys(own) : [] };
}

/** Del precio crudo a lo que muestra la UI: variación diaria en moneda y en % contra el cierre previo. */
export type QuoteView = NonNullable<TickerPage["quote"]>;
export function shapeQuote(q: LiveQuote, guardado?: { close: number; date: string } | null): QuoteView {
  const prev = guardado?.close ?? q.prevClose;
  const change = prev ? round2(q.price - prev) : null;
  return { price: q.price, prevClose: prev, change, changePct: prev ? round2(((q.price - prev) / prev) * 100) : null, asOf: q.asOf, currency: q.currency ?? null, ...(guardado ? { prevCloseDate: guardado.date } : {}) };
}

const fechaNY = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const habilAnterior = (iso: string) => {
  let t = Date.parse(`${iso}T12:00:00Z`) - DAY;
  while (new Date(t).getUTCDay() === 0 || new Date(t).getUTCDay() === 6) t -= DAY;
  return new Date(t).toISOString().slice(0, 10);
};

/**
 * Cierre guardado de la sesión anterior a la del precio (15/9). La cabecera de la ficha medía el cambio del día contra
 * el cierre previo de Alpaca IEX (TSM 418,60) mientras las velas, el Radar y Cartera usan el de Yahoo guardado en la
 * base (418,01): dos "cierres de ayer" en la misma pantalla. Se usa el guardado solo si es EXACTAMENTE la sesión hábil
 * anterior a la del precio (hora de Nueva York); si falta (todavía no se guardó), null y queda el de la fuente, para no
 * medir contra un cierre de hace dos ruedas. Una vela de hoy a medio armar no cuenta.
 */
export function closeAnterior(candles: Candle[], asOf: string | null, now = new Date()): { close: number; date: string } | null {
  const sesion = fechaNY(asOf ? new Date(asOf) : now);
  const vela = candles.filter((c) => c.date < sesion).sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  return vela && vela.date === habilAnterior(sesion) ? { close: vela.close, date: vela.date } : null;
}

/**
 * Precio vivo de varios símbolos a la vez (la tabla de Cartera): todos en paralelo, cada uno con su
 * timeout. Una fuente caída o colgada da null para ese símbolo y no frena al resto.
 */
export async function liveQuotes(quote: TickerDeps["quote"], symbols: string[], opts: { timeoutMs?: number; log?: (msg: string) => void } = {}): Promise<Record<string, QuoteView | null>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_SOURCE_TIMEOUT_MS;
  const entries = await Promise.all(
    symbols.map(async (raw) => {
      const symbol = raw.toUpperCase();
      try {
        const q = await withTimeout(quote(symbol), timeoutMs, `precio ${symbol}`);
        return [symbol, q ? shapeQuote(q) : null] as const;
      } catch (e) {
        opts.log?.(`[cartera] precio ${symbol}: ${errText(e)}`);
        return [symbol, null] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * Regla de carga: lo guardado se sirve al instante. Si falta, se pide con timeout; si está viejo,
 * se sirve igual y se refresca en segundo plano para la próxima visita. Las fuentes corren en paralelo.
 * Con `live: false` (modo rápido) ni siquiera se espera lo que falta: se dispara atrás y se marca en `pending`,
 * para que la UI pinte lo guardado ya y complete con una segunda llamada.
 */
export async function buildTicker(deps: TickerDeps, symbolRaw: string, opts: { today: string; timeoutMs?: number; live?: boolean; verifierPromptVersion?: string | null }): Promise<TickerPage> {
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

  // Noticias (Finnhub), refresco cada 24 h por proceso. Finnhub no cubre BYMA: un .BA usa las noticias de su ADR.
  const newsSource = async (): Promise<string | null> => {
    if (!symbol.endsWith(".BA")) return symbol;
    return (await store.latestCandidates()).find((c) => c.symbol === symbol)?.peerGroup[0] ?? null;
  };
  const fetchNews = async () => {
    const src = await newsSource();
    if (!src) return store.news(symbol, 20);
    const items = await deps.news.companyNews(src, addDays(opts.today, -30), opts.today);
    await store.upsertNews(items.map((i) => ({ ...i, symbol })));
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

  const quoteP = guarded("precio", () => deps.quote(symbol));

  const dbStart = Date.now();
  const [description, candles, news, liveQuote, positions, verdicts, tags, fundamentals, candidates, theses, txs, filings, risk] = await Promise.all([
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
  // El cambio del día contra el mismo cierre que usan las velas, el Radar y Cartera (ver `closeAnterior`).
  const quote: TickerPage["quote"] = liveQuote ? shapeQuote(liveQuote, closeAnterior(candles, liveQuote.asOf)) : null;
  const pos = positions.find((p) => p.symbol === symbol) ?? null;
  const price = quote?.price ?? candles[candles.length - 1]?.close ?? null;
  const position = pos && price !== null
    ? { ...pos, valueUsd: round2(pos.quantity * price), pnlUsd: round2((price - pos.avgCost) * pos.quantity), pnlPct: round2(((price - pos.avgCost) / pos.avgCost) * 100), weightPct: risk?.report.weights.find((w) => w.symbol === symbol)?.weightPct ?? null }
    : null;
  const candidate = candidates.find((c) => c.symbol === symbol) ?? null;
  const since90 = addDays(opts.today, -90);
  const [statements, allEvents, analystActions, verification, newsScannedTo, hechosTodos] = await Promise.all([
    store.statements(symbol).catch(() => null),
    store.eventsFor(symbol, since90).catch(() => []),
    store.analystActions(symbol, since90).catch(() => []),
    store.verification(symbol).catch(() => null),
    store.newsScannedTo(symbol).catch(() => null),
    store.hechos(symbol, addDays(opts.today, -VENTANA_MAXIMA_DIAS)).catch(() => [] as HechoExterno[]),
  ]);
  const events = allEvents.filter((e) => e.severity !== "ruido");
  const { peers, medians, ownExcluded } = await comparables(store, fundamentals, candidate?.peerGroup ?? []);
  const mine = txs.filter((t) => t.symbol === symbol).sort((a, b) => b.date.localeCompare(a.date));
  const sum = (type: Transaction["type"]) => {
    const rows = mine.filter((t) => t.type === type);
    return { count: rows.length, total: round2(rows.reduce((s, t) => s + t.quantity * t.price, 0)) };
  };
  const buys = sum("BUY");
  const sells = sum("SELL");
  const dividends = sum("DIVIDEND");
  // Los cinco DIVIDEND de GGAL no son plata: son acciones. Cada uno trae una cantidad fraccionaria (2,298 ·
  // 2,508 · 1,455 · 1,133 · 0,451) a un precio, o sea dividendo reinvertido (DRIP). La pantalla mostraba
  // "dividendos US$ 382,71" al lado de "compras" y "total invertido", donde todo lo demás es plata, así que
  // se leía como efectivo cobrado. Nunca entró un dólar a la cuenta: entraron 7,845 acciones de GGAL.
  const dividendShares = round4(mine.filter((t) => t.type === "DIVIDEND").reduce((s, t) => s + t.quantity, 0));
  // TRANSFER es un movimiento entre plataformas (Buenbit → Nexo), no plata nueva: no entra en "invertido".
  const arNews = description?.longName ? await store.recentNewsTitles(description.longName.split(" ")[0] ?? symbol, 5) : [];

  return {
    symbol,
    description,
    quote,
    position,
    // Con el objetivo de la posición al lado (15/9): en un SUMAR, `target` es el de la compra nueva, y la ficha mostraba
    // ese (533,92 en TSM) mientras Cartera y el Radar mostraban el de la posición (428,41).
    verdict: (() => { const v = verdicts.find((x) => x.symbol === symbol); return v ? { ...v, holdTarget: holdTargetOf(v) } : null; })(),
    tags,
    fundamentals,
    dividendYieldPct: fundamentals ? dividendYieldPct(fundamentals) : null,
    candidate,
    peers,
    medians,
    ownExcluded,
    statements,
    events,
    analystActions,
    hechos: hechosVigentes(hechosTodos, opts.today),
    newsScannedTo,
    verification,
    verificationCurrent: verification && opts.verifierPromptVersion ? verification.promptVersion === opts.verifierPromptVersion : null,
    theses,
    transactions: mine,
    transactionSummary: { buys, sells, dividends, dividendShares, invested: round2(buys.total - sells.total) },
    candles,
    atr14: atr(candles, 14),
    news,
    filings,
    arNews,
    errors,
    pending,
    timings: { ...timings, total: Date.now() - t0 },
  };
}
