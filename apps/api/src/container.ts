import { readFile } from "node:fs/promises";
import { AlpacaAssets, AlpacaBroker, AlpacaMarketData, AlpacaPriceHistory, ArRssIngestor, CompletedSessionsHistory, CourtListenerIngestor, EdgarIngestor, EdgarOfferForms, FallbackPriceHistory, FinnhubFundamentals, FinnhubProfiles, ManualCsvIngestor, NO_PROFILES, NasdaqEarningsIngestor, RateLimiter, SecStatements, YahooChart, YahooDescriptions, YahooPriceHistory, createHttpClient, createTradingHttp, ArgentinaMacro, YahooSearch } from "@thesis/adapters";
import { DEFAULT_FILTER_CONFIG, QUALITY_FLAGS, DEFAULT_RISK_LIMITS, DefaultFilter, DefaultRiskEngine, todayLocal, type Broker, type CandidateVerifier, type CardWriter, type EventClassifier, type Ingestor, type MarketData, type PortfolioSnapshot, type PositionNarrator, type Reasoner, type RiskEngine } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import { EdgarDocumentProvider, buildSnapshot, eventUniverse, scanEventsFor, type CarteraDeps, type CarteraStore, type FundamentalsSource, type RadarDeps, type RadarStore, type RunDeps, type ScanSummary, type Store, type TickerDeps, type TickerStore, ArgentinaDeps } from "@thesis/pipeline";
import { AgentReviewer, AgentVerifier, AnthropicCardWriter, AnthropicEventClassifier, AnthropicNarrator, AnthropicReasoner, DEFAULT_RPM_PER_KEY, GeminiCandidateVerifier, GeminiCardWriter, GeminiPreTradeReviewer, GeminiEventClassifier, GeminiNarrator, GeminiReasoner, QuotaTracker, type GeminiCallerOptions } from "@thesis/reasoner";
import { KeyedRateLimiter, recordingFetch } from "@thesis/core";
import { StoreUsageRecorder } from "@thesis/pipeline";
import type { Config, ReasonerConfig } from "./config.js";

/** Lo que comparten todos los llamadores de Gemini del proceso: cuota aprendida, freno por minuto y registro. */
export type GeminiShared = Pick<GeminiCallerOptions, "tracker" | "pace" | "recorder">;

/** Estado mutable mínimo del proceso. */
export interface ScanState {
  running: boolean;
  stopRequested: boolean;
  startedAt: string | null;
  progress: { done: number; total: number; stage: string } | null;
  last: ScanSummary | null;
}
export const state = {
  killSwitch: false,
  lastRun: null as null | { at: string; summary: unknown },
  scan: { running: false, stopRequested: false, startedAt: null, progress: null, last: null } as ScanState,
  /** Ponerse al día: evita corridas superpuestas y guarda el último resultado para la UI. */
  catchup: { running: false, last: null as null | { at: string; ran: Array<{ id: string; label: string; ok: boolean; detail: string }> }, current: null as string | null },
};

export interface Container {
  cfg: Config;
  store: Store & CarteraStore & RadarStore & TickerStore;
  /** Cartera real del dueño (spec etapa 1). */
  carteraDeps: CarteraDeps;
  /** Radar de candidatos (spec etapa 2). */
  radarDeps: RadarDeps;
  /** Argentina (etapa 3): macro, acciones de BYMA y CEDEARs. */
  argentinaDeps: ArgentinaDeps;
  /** Hub de precios en vivo (lo arranca index.ts; los tests pueden no tenerlo). */
  priceHub?: import("./prices-hub.js").PriceHub;
  /** Registro de uso de fuentes externas (los tests pueden no tenerlo). */
  usage?: StoreUsageRecorder;
  /** Buscador de símbolos para el alta a la watchlist. */
  symbolSearch: { search(query: string): Promise<import("@thesis/adapters").SymbolHit[]> };
  /** Precios vivos por lote para la watchlist y la cinta del header. */
  pricesDeps: { quotes(symbols: string[]): Promise<import("@thesis/core").LiveQuote[]> };
  /** Solo para tests: reemplaza los pasos reales de "ponerme al día". */
  catchupRunners?: import("./catchup.js").Runners;
  /** Asegura los controles automáticos sobre el plan vigente (15/9). Lo arma el servidor; en los tests puede no estar. */
  controlar?: () => Promise<import("@thesis/core").PlanControles | null>;
  /** Reintentos de la revisión antes de comprar (ver `revisiones.ts`). */
  revisiones?: import("./revisiones.js").EstadoRevisiones;
  /** Reintentos de la verificación web de lo que el plan compraría (ver `verificaciones.ts`). */
  verificaciones?: import("./verificaciones.js").EstadoVerificaciones;
  /** Cola del refresco de la lista de seguimiento: uno a la vez (ver `seguimiento.ts`). */
  seguimiento?: import("./seguimiento.js").EstadoSeguimiento;
  /** Página por ticker (etapa 2b): agregador + gráfico intradiario en vivo. */
  tickerDeps: TickerDeps & { chart: { bars(symbol: string, range: string, interval: string): Promise<import("@thesis/core").ChartBar[]> } };
  marketData: MarketData;
  broker: Broker;
  risk: RiskEngine;
  runDeps: RunDeps;
  snapshot: () => Promise<PortfolioSnapshot>;
  account: () => Promise<{ equity: number; lastEquity: number }>;
}

/** Un razonador por proveedor; el prompt, la validación y pMarket son los mismos. */
export function buildReasoner(r: ReasonerConfig, shared: GeminiShared = {}): Reasoner {
  if (r.kind === "gemini") {
    return new GeminiReasoner({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
  }
  return new AnthropicReasoner({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Narrador de posiciones: misma regla de proveedor que el razonador. Solo puede degradar. */
export function buildNarrator(r: ReasonerConfig, shared: GeminiShared = {}): PositionNarrator {
  if (r.kind === "gemini") {
    return new GeminiNarrator({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
  }
  return new AnthropicNarrator({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Ficha de candidato: misma regla de proveedor que el razonador. Solo puede degradar. */
export function buildCardWriter(r: ReasonerConfig, shared: GeminiShared = {}): CardWriter {
  if (r.kind === "gemini") {
    return new GeminiCardWriter({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
  }
  return new AnthropicCardWriter({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Clasificador de titulares del Radar: misma regla de proveedor. Solo clasifica; el veredicto lo deciden las reglas. */
/** Verificación web por candidata: solo con Gemini (búsqueda de Google integrada). Con Anthropic no hay verificador. */
export function buildVerifier(r: ReasonerConfig, shared: GeminiShared = {}, modo: "agente" | "gemini" = "agente"): CandidateVerifier | null {
  // Con el agente (22/9) la app no busca: la verificación la escribe el agente de Claude por cron.
  if (modo === "agente") return new AgentVerifier();
  if (r.kind !== "gemini") return null;
  return new GeminiCandidateVerifier({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
}

/** Revisión antes de comprar (15/9): solo con Gemini, como la verificación. Sin revisor, el plan no la exige. */
export function buildReviewer(r: ReasonerConfig, shared: GeminiShared = {}, modo: "agente" | "gemini" = "agente"): import("@thesis/core").PreTradeReviewer | null {
  if (modo === "agente") return new AgentReviewer();
  if (r.kind !== "gemini") return null;
  return new GeminiPreTradeReviewer({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
}

export function buildEventClassifier(r: ReasonerConfig, shared: GeminiShared = {}): EventClassifier {
  if (r.kind === "gemini") {
    return new GeminiEventClassifier({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m), ...shared });
  }
  return new AnthropicEventClassifier({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Sin FINNHUB_API_KEY el Radar no puede barrer: cada llamada falla con un mensaje claro. */
const NO_FUNDAMENTALS: FundamentalsSource = {
  profile: async () => { throw new Error("FINNHUB_API_KEY requerida para el Radar"); },
  metrics: async () => { throw new Error("FINNHUB_API_KEY requerida para el Radar"); },
  peers: async () => [],
  recommendation: async () => null,
  earningsSurprises: async () => null,
  insiders: async () => ({ buys: 0, sells: 0 }),
  nextEarnings: async () => null,
};

export function buildContainer(cfg: Config): Container {
  const db = createDb(cfg.databaseUrl);
  const store = new Repo(db);
  // Registro de uso: todo pedido saliente pasa por `usageFetch`; Gemini registra por su cuenta (tokens, modelo, clave)
  // y comparte entre sus cuatro llamadores la cuota aprendida y el freno por minuto por modelo+clave.
  const usage = new StoreUsageRecorder(store, { log: (m) => console.warn(m) });
  const usageFetch = recordingFetch(usage);
  const gemini: GeminiShared = { tracker: new QuotaTracker(), pace: new KeyedRateLimiter(DEFAULT_RPM_PER_KEY), recorder: usage };
  const http = createHttpClient({ userAgent: cfg.userAgent, fetch: usageFetch });
  const marketData = new AlpacaMarketData(http, cfg.alpaca);
  const broker = new AlpacaBroker(createTradingHttp(http, cfg.userAgent, usageFetch), cfg.alpaca);
  const risk = new DefaultRiskEngine(DEFAULT_RISK_LIMITS);
  // Universo de eventos: config más lo que la cartera y el Radar suman solos (posiciones, seguimiento, plan, COMPRAR del ranking). Ver eventUniverse.
  const allTickers = async (): Promise<string[]> => {
    const [positions, watchlist, plan, candidates] = await Promise.all([store.positions(), store.watchlist(), store.latestPlan(), store.latestCandidates()]);
    return eventUniverse({ config: cfg.universe, positions, watchlist, plan, candidates });
  };
  const adrAllowlist = async (): Promise<string[]> => {
    const [positions, tags] = await Promise.all([store.positions(), store.allTags()]);
    const adrs = [...cfg.universe.adr, ...positions.filter((p) => p.market === "adr").map((p) => p.symbol), ...Object.entries(tags).filter(([, t]) => t.assetClass === "adr").map(([sym]) => sym)];
    return [...new Set(adrs.map((x) => x.toUpperCase()))];
  };

  const ingestors: Ingestor[] = [
    new EdgarIngestor({ http, universe: allTickers, knownRefs: (refs) => store.knownSourceRefs("edgar", refs) }),
    new NasdaqEarningsIngestor({ http, universe: allTickers }),
    new ArRssIngestor({ http }),
    new ManualCsvIngestor({ read: () => readFile(cfg.csvPath, "utf8").catch(() => "ticker,event_type,event_date,title,ref\n") }),
  ];
  if (Object.keys(cfg.universe.legalNames).length) {
    ingestors.push(new CourtListenerIngestor({ http, companies: cfg.universe.legalNames, ...(cfg.courtListenerToken ? { token: cfg.courtListenerToken } : {}) }));
  }

  const runDeps: RunDeps = {
    store,
    ingestors,
    filter: new DefaultFilter((t) => marketData.getQuote(t), { ...DEFAULT_FILTER_CONFIG, allowlist: adrAllowlist }),
    reasoner: buildReasoner(cfg.reasoner, gemini),
    documents: new EdgarDocumentProvider(http),
    marketData,
    minEdge: cfg.minEdge,
    maxCandidates: cfg.maxCandidates,
    log: (msg, extra) => console.log(`[pipeline] ${msg}`, extra ?? ""),
  };

  // Cartera real: velas de Yahoo (respaldo Alpaca), perfil de Finnhub si hay key, spot de Alpaca.
  const yahooHttp = createHttpClient({ userAgent: "Mozilla/5.0 (compatible; thesis-engine)", fetch: usageFetch });
  const history = new CompletedSessionsHistory(new FallbackPriceHistory(new YahooPriceHistory(yahooHttp), new AlpacaPriceHistory(http, cfg.alpaca), (m) => console.log(m)));
  const carteraDeps: CarteraDeps = {
    store,
    history,
    profiles: cfg.finnhubToken ? new FinnhubProfiles(http, cfg.finnhubToken) : NO_PROFILES,
    narrator: buildNarrator(cfg.reasoner, gemini),
    spot: async (symbol) => (await marketData.getQuote(symbol))?.price ?? null,
    // Lo que la app ya sabe del negocio, reusado para decidir si mantener: verificación web, eventos
    // materiales de 90 días, salvedades de calidad de la ganancia (las que el Radar ya calculó en la fila)
    // y consenso de analistas. Nada de esto vende solo: como mucho pasa la posición a REVISAR.
    tesis: async (symbol) => {
      const sym = symbol.toUpperCase();
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const [verification, eventos, filas, f, scannedTo] = await Promise.all([
        store.verification(sym).catch(() => null),
        store.eventsFor(sym, desde).catch(() => []),
        store.candidateHistory(sym, 1).catch(() => []),
        store.fundamentals(sym).catch(() => null),
        store.newsScannedTo(sym).catch(() => null),
      ]);
      const fila = filas[0];
      return {
        verification: verification ? { date: verification.date, verdict: verification.verdict, reason: verification.reason } : null,
        events: eventos.filter((e) => e.severity !== "ruido").map((e) => ({ date: e.date, kind: e.kind, severity: e.severity, headline: e.headline })),
        qualityFlags: (fila?.flags ?? []).filter((x) => QUALITY_FLAGS.has(x)),
        analyst: f?.analyst ?? null,
        // Sin esto, "no hay eventos" y "nunca leí una noticia" eran el mismo `events: []`.
        news: { scannedTo },
      };
    },
    log: (msg, extra) => console.log(msg, extra ?? ""),
  };

  // Radar: universo de Alpaca, fundamentals de Finnhub (55/min), ficha del modelo, config editable.
  const finnhub = cfg.finnhubToken ? new FinnhubFundamentals(http, cfg.finnhubToken, new RateLimiter(55)) : null;
  const ofertas = new EdgarOfferForms(http);
  const radarDeps: RadarDeps = {
    store,
    assets: new AlpacaAssets(http, cfg.alpaca),
    fundamentals: finnhub ?? NO_FUNDAMENTALS,
    history,
    cardWriter: buildCardWriter(cfg.reasoner, gemini),
    taxonomy: cfg.radar.taxonomy,
    etfs: cfg.radar.etfs,
    policy: cfg.radar.policy,
    fomc: cfg.radar.fomc,
    filings: (symbol) => store.recentFilingTitles(symbol, 8),
    // Lo guardado en raw_events si hay; si no, EDGAR en vivo (17/9): la regla tiene que llegar a toda la preselección y
    // al comando mercado, no sólo al universo de ingesta. Un pedido por símbolo, cacheado en el proceso, sin escribir.
    filingsDeOferta: async (symbol) => {
      const guardados = await store.offerFilingTitles(symbol);
      return guardados.length ? guardados : ofertas.offerFilingTitles(symbol, { today: todayLocal() });
    },
    log: (msg, extra) => console.log(msg, extra ?? ""),
    onProgress: (p) => { state.scan.progress = p; },
    shouldStop: () => state.scan.stopRequested,
    // Verificación: estados de la SEC (mismo `http` con SEC_USER_AGENT), noticias de Finnhub y clasificador de titulares.
    statements: new SecStatements(http),
    news: finnhub ? { companyNews: (s, from, to) => finnhub.companyNews(s, from, to) } : null,
    eventClassifier: buildEventClassifier(cfg.reasoner, gemini),
    verifier: buildVerifier(cfg.reasoner, gemini, cfg.verificador),
    reviewer: buildReviewer(cfg.reasoner, gemini, cfg.verificador),
  };

  // Las noticias de las posiciones se leen con la misma cadena que las candidatas (Finnhub + clasificador):
  // mismas reglas, mismos eventos, misma marca de hasta cuándo se leyó. Se ata acá porque `finnhub` recién
  // existe a esta altura.
  if (radarDeps.news) {
    const eventsDeps = { store, news: radarDeps.news, classifier: radarDeps.eventClassifier ?? null, log: (m: string, extra?: unknown) => console.log(m, extra ?? "") };
    carteraDeps.scanEvents = async (symbol) => {
      const profile = await store.profile(symbol).catch(() => null);
      await scanEventsFor(eventsDeps, symbol, { today: todayLocal(), name: profile?.profile.name ?? null });
    };
  }

  // Argentina: Yahoo para `.BA` y el Merval (en pesos), dolarapi + argentinadatos para el macro, Alpaca para el precio US de los CEDEARs.
  const argentinaDeps: ArgentinaDeps = {
    store,
    history,
    macro: new ArgentinaMacro(usageFetch),
    usPrices: async (symbols) => Object.fromEntries((await new AlpacaAssets(http, cfg.alpaca).snapshots(symbols)).flatMap((x) => (x.price === null ? [] : [[x.symbol, x.price] as const]))),
    config: cfg.radar.argentina,
    policy: cfg.radar.policy,
    log: (msg) => console.log(msg),
  };

  // Página por ticker: descripción de Yahoo (crumb), noticias de Finnhub, precio vivo de Alpaca, gráfico de Yahoo.
  const alpacaAssets = new AlpacaAssets(http, cfg.alpaca);
  const yahooChart = new YahooChart(yahooHttp);
  const tickerDeps: Container["tickerDeps"] = {
    store,
    history,
    descriptions: new YahooDescriptions(usageFetch),
    news: { companyNews: (s, from, to) => (finnhub ? finnhub.companyNews(s, from, to) : Promise.resolve([])) },
    // Los `.BA` (pesos) no están en Alpaca: precio de la meta del chart de Yahoo.
    quote: (symbol) => (symbol.toUpperCase().endsWith(".BA") ? yahooChart.quote(symbol) : ((s) => alpacaAssets.quote(s))(symbol)),
    newsFetchedAt: new Map(),
      log: (m: string) => console.warn(m),
    chart: { bars: (s, range, interval) => yahooChart.bars(s, range as never, interval as never) },
  };

  async function account() {
    try {
      const a = await broker.account();
      return { equity: a.equity, lastEquity: a.lastEquity };
    } catch {
      return { equity: cfg.capitalFallbackUsd, lastEquity: cfg.capitalFallbackUsd };
    }
  }
  const snapshot = async () => buildSnapshot(store, await account(), state.killSwitch);

  // Precios por lote: Alpaca para US (100 por llamada); los .BA uno por uno vía Yahoo.
  const pricesDeps: Container["pricesDeps"] = {
    quotes: async (symbols) => {
      const us = symbols.filter((x) => !x.toUpperCase().endsWith(".BA"));
      const ba = symbols.filter((x) => x.toUpperCase().endsWith(".BA"));
      const [a, b] = await Promise.all([
        us.length ? alpacaAssets.quotes(us).catch(() => []) : Promise.resolve([]),
        Promise.all(ba.map((x) => yahooChart.quote(x).catch(() => null))),
      ]);
      return [...a, ...b.filter((q): q is NonNullable<typeof q> => q !== null)];
    },
  };
  const symbolSearch = new YahooSearch(yahooHttp);
  return { cfg, store, carteraDeps, radarDeps, argentinaDeps, tickerDeps, pricesDeps, symbolSearch, marketData, broker, risk, runDeps, snapshot, account, usage };
}
