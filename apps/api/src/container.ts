import { readFile } from "node:fs/promises";
import { AlpacaBroker, AlpacaMarketData, AlpacaPriceHistory, ArRssIngestor, CourtListenerIngestor, EdgarIngestor, FallbackPriceHistory, FinnhubProfiles, ManualCsvIngestor, NO_PROFILES, NasdaqEarningsIngestor, YahooPriceHistory, createHttpClient, createTradingHttp } from "@thesis/adapters";
import { DEFAULT_FILTER_CONFIG, DEFAULT_RISK_LIMITS, DefaultFilter, DefaultRiskEngine, type Broker, type Ingestor, type MarketData, type PortfolioSnapshot, type PositionNarrator, type Reasoner, type RiskEngine } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import { EdgarDocumentProvider, buildSnapshot, type CarteraDeps, type CarteraStore, type RunDeps, type Store } from "@thesis/pipeline";
import { AnthropicNarrator, AnthropicReasoner, GeminiNarrator, GeminiReasoner } from "@thesis/reasoner";
import type { Config, ReasonerConfig } from "./config.js";

/** Estado mutable mínimo del proceso. */
export const state = { killSwitch: false, lastRun: null as null | { at: string; summary: unknown } };

export interface Container {
  cfg: Config;
  store: Store & CarteraStore;
  /** Cartera real del dueño (spec etapa 1). */
  carteraDeps: CarteraDeps;
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

export function buildContainer(cfg: Config): Container {
  const http = createHttpClient({ userAgent: cfg.userAgent });
  const db = createDb(cfg.databaseUrl);
  const store = new Repo(db);
  const marketData = new AlpacaMarketData(http, cfg.alpaca);
  const broker = new AlpacaBroker(createTradingHttp(http, cfg.userAgent), cfg.alpaca);
  const risk = new DefaultRiskEngine(DEFAULT_RISK_LIMITS);
  const allTickers = [...new Set([...cfg.universe.us, ...cfg.universe.adr])];

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
    filter: new DefaultFilter((t) => marketData.getQuote(t), { ...DEFAULT_FILTER_CONFIG, allowlist: cfg.universe.adr }),
    reasoner: buildReasoner(cfg.reasoner),
    documents: new EdgarDocumentProvider(http),
    marketData,
    minEdge: cfg.minEdge,
    maxCandidates: cfg.maxCandidates,
    log: (msg, extra) => console.log(`[pipeline] ${msg}`, extra ?? ""),
  };

  // Cartera real: velas de Yahoo (respaldo Alpaca), perfil de Finnhub si hay key, spot de Alpaca.
  const yahooHttp = createHttpClient({ userAgent: "Mozilla/5.0 (compatible; thesis-engine)" });
  const history = new FallbackPriceHistory(new YahooPriceHistory(yahooHttp), new AlpacaPriceHistory(http, cfg.alpaca), (m) => console.log(m));
  const carteraDeps: CarteraDeps = {
    store,
    history,
    profiles: cfg.finnhubToken ? new FinnhubProfiles(http, cfg.finnhubToken) : NO_PROFILES,
    narrator: buildNarrator(cfg.reasoner),
    spot: async (symbol) => (await marketData.getQuote(symbol))?.price ?? null,
    log: (msg, extra) => console.log(msg, extra ?? ""),
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

  return { cfg, store, carteraDeps, marketData, broker, risk, runDeps, snapshot, account };
}
