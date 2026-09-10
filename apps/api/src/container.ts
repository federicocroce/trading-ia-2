import { readFile } from "node:fs/promises";
import { AlpacaAssets, AlpacaBroker, AlpacaMarketData, AlpacaPriceHistory, ArRssIngestor, CompletedSessionsHistory, CourtListenerIngestor, EdgarIngestor, FallbackPriceHistory, FinnhubFundamentals, FinnhubProfiles, ManualCsvIngestor, NO_PROFILES, NasdaqEarningsIngestor, RateLimiter, SecStatements, YahooChart, YahooDescriptions, YahooPriceHistory, createHttpClient, createTradingHttp, ArgentinaMacro, YahooSearch } from "@thesis/adapters";
import { DEFAULT_FILTER_CONFIG, DEFAULT_RISK_LIMITS, DefaultFilter, DefaultRiskEngine, type Broker, type CardWriter, type EventClassifier, type Ingestor, type MarketData, type PortfolioSnapshot, type PositionNarrator, type Reasoner, type RiskEngine } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import { EdgarDocumentProvider, buildSnapshot, type CarteraDeps, type CarteraStore, type FundamentalsSource, type RadarDeps, type RadarStore, type RunDeps, type ScanSummary, type Store, type TickerDeps, type TickerStore, ArgentinaDeps } from "@thesis/pipeline";
import { AnthropicCardWriter, AnthropicEventClassifier, AnthropicNarrator, AnthropicReasoner, GeminiCardWriter, GeminiEventClassifier, GeminiNarrator, GeminiReasoner } from "@thesis/reasoner";
import type { Config, ReasonerConfig } from "./config.js";

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
  catchup: { running: false, last: null as null | { at: string; ran: Array<{ id: string; label: string; ok: boolean; detail: string }> } },
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
  /** Buscador de símbolos para el alta a la watchlist. */
  symbolSearch: { search(query: string): Promise<import("@thesis/adapters").SymbolHit[]> };
  /** Precios vivos por lote para la watchlist y la cinta del header. */
  pricesDeps: { quotes(symbols: string[]): Promise<import("@thesis/core").LiveQuote[]> };
  /** Solo para tests: reemplaza los pasos reales de "ponerme al día". */
  catchupRunners?: import("./catchup.js").Runners;
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
export function buildReasoner(r: ReasonerConfig): Reasoner {
  if (r.kind === "gemini") {
    return new GeminiReasoner({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m) });
  }
  return new AnthropicReasoner({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Narrador de posiciones: misma regla de proveedor que el razonador. Solo puede degradar. */
export function buildNarrator(r: ReasonerConfig): PositionNarrator {
  if (r.kind === "gemini") {
    return new GeminiNarrator({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m) });
  }
  return new AnthropicNarrator({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Ficha de candidato: misma regla de proveedor que el razonador. Solo puede degradar. */
export function buildCardWriter(r: ReasonerConfig): CardWriter {
  if (r.kind === "gemini") {
    return new GeminiCardWriter({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m) });
  }
  return new AnthropicCardWriter({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}

/** Clasificador de titulares del Radar: misma regla de proveedor. Solo clasifica; el veredicto lo deciden las reglas. */
export function buildEventClassifier(r: ReasonerConfig): EventClassifier {
  if (r.kind === "gemini") {
    return new GeminiEventClassifier({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m) });
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
  const http = createHttpClient({ userAgent: cfg.userAgent });
  const db = createDb(cfg.databaseUrl);
  const store = new Repo(db);
  const marketData = new AlpacaMarketData(http, cfg.alpaca);
  const broker = new AlpacaBroker(createTradingHttp(http, cfg.userAgent), cfg.alpaca);
  const risk = new DefaultRiskEngine(DEFAULT_RISK_LIMITS);
  // Universo de eventos: lo de config más lo que la cartera va sumando sola (posiciones, seguimiento, plan). Sin .BA: EDGAR no los cubre.
  const eventUniverse = async (): Promise<string[]> => {
    const [positions, watch, plan] = await Promise.all([store.positions(), store.watchlist(), store.latestPlan()]);
    const all = [...cfg.universe.us, ...cfg.universe.adr, ...positions.map((p) => p.symbol), ...watch.map((w) => w.symbol), ...(plan?.lines.map((l) => l.symbol) ?? [])];
    return [...new Set(all.map((x) => x.toUpperCase()))].filter((x) => !x.endsWith(".BA"));
  };
  const adrAllowlist = async (): Promise<string[]> => {
    const [positions, tags] = await Promise.all([store.positions(), store.allTags()]);
    const adrs = [...cfg.universe.adr, ...positions.filter((p) => p.market === "adr").map((p) => p.symbol), ...Object.entries(tags).filter(([, t]) => t.assetClass === "adr").map(([sym]) => sym)];
    return [...new Set(adrs.map((x) => x.toUpperCase()))];
  };
  const allTickers = eventUniverse;

  const ingestors: Ingestor[] = [
    new EdgarIngestor({ http, universe: allTickers }),
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
    reasoner: buildReasoner(cfg.reasoner),
    documents: new EdgarDocumentProvider(http),
    marketData,
    minEdge: cfg.minEdge,
    maxCandidates: cfg.maxCandidates,
    log: (msg, extra) => console.log(`[pipeline] ${msg}`, extra ?? ""),
  };

  // Cartera real: velas de Yahoo (respaldo Alpaca), perfil de Finnhub si hay key, spot de Alpaca.
  const yahooHttp = createHttpClient({ userAgent: "Mozilla/5.0 (compatible; thesis-engine)" });
  const history = new CompletedSessionsHistory(new FallbackPriceHistory(new YahooPriceHistory(yahooHttp), new AlpacaPriceHistory(http, cfg.alpaca), (m) => console.log(m)));
  const carteraDeps: CarteraDeps = {
    store,
    history,
    profiles: cfg.finnhubToken ? new FinnhubProfiles(http, cfg.finnhubToken) : NO_PROFILES,
    narrator: buildNarrator(cfg.reasoner),
    spot: async (symbol) => (await marketData.getQuote(symbol))?.price ?? null,
    log: (msg, extra) => console.log(msg, extra ?? ""),
  };

  // Radar: universo de Alpaca, fundamentals de Finnhub (55/min), ficha del modelo, config editable.
  const finnhub = cfg.finnhubToken ? new FinnhubFundamentals(http, cfg.finnhubToken, new RateLimiter(55)) : null;
  const radarDeps: RadarDeps = {
    store,
    assets: new AlpacaAssets(http, cfg.alpaca),
    fundamentals: finnhub ?? NO_FUNDAMENTALS,
    history,
    cardWriter: buildCardWriter(cfg.reasoner),
    taxonomy: cfg.radar.taxonomy,
    etfs: cfg.radar.etfs,
    policy: cfg.radar.policy,
    filings: (symbol) => store.recentFilingTitles(symbol, 8),
    log: (msg, extra) => console.log(msg, extra ?? ""),
    onProgress: (p) => { state.scan.progress = p; },
    shouldStop: () => state.scan.stopRequested,
    // Verificación: estados de la SEC (mismo `http` con SEC_USER_AGENT), noticias de Finnhub y clasificador de titulares.
    statements: new SecStatements(http),
    news: finnhub ? { companyNews: (s, from, to) => finnhub.companyNews(s, from, to) } : null,
    eventClassifier: buildEventClassifier(cfg.reasoner),
  };

  // Argentina: Yahoo para `.BA` y el Merval (en pesos), dolarapi + argentinadatos para el macro, Alpaca para el precio US de los CEDEARs.
  const argentinaDeps: ArgentinaDeps = {
    store,
    history,
    macro: new ArgentinaMacro(),
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
    descriptions: new YahooDescriptions(),
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
  return { cfg, store, carteraDeps, radarDeps, argentinaDeps, tickerDeps, pricesDeps, symbolSearch, marketData, broker, risk, runDeps, snapshot, account };
}
