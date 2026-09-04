import { readFile } from "node:fs/promises";
import { AlpacaBroker, AlpacaMarketData, ArRssIngestor, CourtListenerIngestor, EdgarIngestor, ManualCsvIngestor, NasdaqEarningsIngestor, createHttpClient, createTradingHttp } from "@thesis/adapters";
import { DEFAULT_FILTER_CONFIG, DEFAULT_RISK_LIMITS, DefaultFilter, DefaultRiskEngine, type Broker, type Ingestor, type MarketData, type PortfolioSnapshot, type RiskEngine } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import { EdgarDocumentProvider, buildSnapshot, type RunDeps, type Store } from "@thesis/pipeline";
import { AnthropicReasoner } from "@thesis/reasoner";
import type { Config } from "./config.js";

/** Estado mutable mínimo del proceso. */
export const state = { killSwitch: false, lastRun: null as null | { at: string; summary: unknown } };

export interface Container {
  cfg: Config;
  store: Store;
  marketData: MarketData;
  broker: Broker;
  risk: RiskEngine;
  runDeps: RunDeps;
  snapshot: () => Promise<PortfolioSnapshot>;
  account: () => Promise<{ equity: number; lastEquity: number }>;
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
    reasoner: new AnthropicReasoner({ ...(cfg.anthropicApiKey ? { apiKey: cfg.anthropicApiKey } : {}), ...(cfg.anthropicModel ? { model: cfg.anthropicModel } : {}) }),
    documents: new EdgarDocumentProvider(http),
    marketData,
    minEdge: cfg.minEdge,
    maxCandidates: cfg.maxCandidates,
    log: (msg, extra) => console.log(`[pipeline] ${msg}`, extra ?? ""),
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

  return { cfg, store, marketData, broker, risk, runDeps, snapshot, account };
}
