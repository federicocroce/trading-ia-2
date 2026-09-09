/** Radar (etapa 2): tipos y puertos. Sin I/O. */
export type AssetClass = "accion_us" | "adr" | "accion_ar" | "cedear" | "etf" | "bono" | "commodity" | "cripto" | "efectivo";
export type EtfRole = "nucleo" | "satelite" | "cobertura";
export type EtfExposure = "rv_us" | "rv_internacional" | "emergentes" | "sector" | "commodity" | "bonos" | "cripto" | "argentina";

export interface EtfConfig {
  symbol: string;
  name: string;
  role: EtfRole;
  exposure: EtfExposure;
  ter: number;
  themes: string[];
  /** Peso objetivo dentro del núcleo (solo role nucleo). */
  coreWeight?: number | undefined;
}

export interface TaxonomyConfig {
  sectors: string[];
  themes: string[];
  industryToSector: Record<string, string>;
  industryToThemes: Record<string, string[]>;
  symbolToThemes: Record<string, string[]>;
  symbolToAssetClass: Record<string, AssetClass>;
}

export interface RadarPolicy {
  weights: { valuation: number; quality: number; growth: number; balance: number };
  quality: { minMcapUsd: number; minDollarVolumeUsd: number; minPrice: number };
  prefilter: { minPrice: number; minIexDollarVolume: number };
  technical: { maxReturn21dPct: number; earningsWithinDays: number };
  sizing: { riskPerTradePct: number; maxPositionPct: number; fallbackPortfolioUsd: number };
  candidates: { top: number; preselect: number; chronicWeeks: number };
  contribution: {
    monthlyUsd: number; coreTargetPct: number; maxPositionPct: number; maxNewPositionsPerMonth: number; maxLinePctOfContribution: number;
    /** Mientras el núcleo esté bajo su objetivo, qué % del monto va al núcleo (default 60). */
    coreSharePctWhileBelowTarget?: number | undefined;
    /** Qué % de lo que queda después del núcleo puede ir a SUMAR (default 30). */
    sumarSharePctOfRest?: number | undefined;
    /** Máximo de líneas de seguimiento y de ETFs satélite por plan (default 1 y 1). */
    watchLinesMax?: number | undefined;
    etfLinesMax?: number | undefined;
  };
}

export type ThemesSource = "regla" | "modelo" | "manual";
export interface Tags {
  assetClass: AssetClass;
  sector: string;
  industry: string | null;
  themes: string[];
  themesSource: ThemesSource;
}

/** Etapa del barrido semanal por símbolo (spec §4). */
export type ScanStage = "alpaca_ok" | "finnhub_ok" | "excluded" | "error";

/** Fila persistida de un candidato del Radar (acción o ETF) con su medición. */
export interface CandidateRow {
  candidateDate: string;
  symbol: string;
  /** stock/etf del Radar US; ar = acción de BYMA (precio en pesos, contra el Merval); cedear = chequeo de dólar implícito. */
  kind: "stock" | "etf" | "ar" | "cedear" | "watch";
  verdict: "COMPRAR" | "OBSERVAR" | "NUCLEO";
  score: number | null;
  axes: Record<string, number | null>;
  peerGroup: string[];
  rankInGroup: number | null;
  groupSize: number | null;
  close: number;
  entryLow: number | null;
  entryHigh: number | null;
  stop: number | null;
  target: number | null;
  sizeUsd: number | null;
  sizeQty: number | null;
  riskScore: number | null;
  flags: string[];
  nthAppearance: number;
  summary: string | null;
  whyRanks: string | null;
  mainRisk: string | null;
  moat: string | null;
  degradedBy: string | null;
  promptVersion: string | null;
  spyClose: number | null;
  close7d: number | null;
  spy7d: number | null;
  alpha7dPct: number | null;
  close30d: number | null;
  spy30d: number | null;
  alpha30dPct: number | null;
  close90d: number | null;
  spy90d: number | null;
  alpha90dPct: number | null;
  measuredAt: string | null;
}

/** Ficha de candidato escrita por el modelo (spec §9). El verbo ya está decidido; solo puede degradar. */
export interface CardInput {
  symbol: string;
  name: string | null;
  industry: string | null;
  sector: string;
  themes: string[];
  themeOptions: string[];
  verdict: "COMPRAR" | "OBSERVAR";
  score: number;
  axes: Record<string, number | null>;
  rankInGroup: number;
  groupSize: number;
  basis: "pares" | "industria";
  own: Record<string, number | null>;
  medians: Record<string, number | null>;
  peers: string[];
  flags: string[];
  insiders: { buys: number; sells: number } | null;
  analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null;
  surprises: Array<{ period: string; surprisePercent: number | null }> | null;
  filings: string[];
  close: number;
  stop: number | null;
  target: number | null;
  riskScore: number;
  /** Estados de la SEC (spec verificación §4): últimos 4 trimestres y ganancia núcleo. undefined = no se pidieron; [] = no hay. */
  quarters?: QuarterStatement[];
  core?: CoreEarnings | null;
}
export interface Card {
  summary: string;
  whyRanks: string;
  mainRisk: string;
  moat: "debil" | "moderado" | "fuerte" | "desconocido";
  themes: string[];
  degrade: boolean;
  degradeReason?: string;
}
export interface CardWriter {
  readonly promptVersion: string;
  write(input: CardInput): Promise<Card>;
}

/** Página por ticker (etapa 2b). */
export interface SymbolDescription {
  symbol: string;
  longName: string | null;
  summary: string | null;
  employees: number | null;
  website: string | null;
  exchangeName: string | null;
  /** YYYY-MM-DD de la primera rueda (años cotizando), no de la fundación. */
  firstTradeDate: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  updatedAt: string;
}
export interface NewsItem {
  symbol: string;
  /** YYYY-MM-DD */
  date: string;
  headline: string;
  source: string | null;
  url: string;
  summary: string | null;
}
/** Barra para el gráfico: `time` en epoch segundos (intradiario) o medianoche UTC (diario). */
export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export interface LiveQuote {
  symbol: string;
  price: number;
  prevClose: number | null;
  /** ISO de la última operación. */
  asOf: string | null;
  /** Moneda del precio (ARS para los .BA). Sin valor = USD. */
  currency?: string | null;
}

/** Seguimiento (watchlist) con foto del alta y ciclo de vida, portado de trading v1. */
export interface WatchSnapshot {
  note?: string | null;
  entryPrice?: number | null;
  entryAction?: string | null;
  targetPrice?: number | null;
  stopLoss?: number | null;
  thesis?: string | null;
  horizonDays?: number | null;
}
export interface WatchEval {
  status: "live" | "triggered" | "invalidated" | "expired";
  lastPrice: number;
  lastReturn: number;
  lastEvaluatedAt: string;
  resolvedAt: string | null;
  resolutionPrice: number | null;
  resolutionReturn: number | null;
}
export interface WatchItem {
  symbol: string;
  note: string | null;
  addedAt: string;
  entryPrice: number | null;
  entryAction: string | null;
  targetPrice: number | null;
  stopLoss: number | null;
  thesis: string | null;
  horizonDays: number;
  status: "live" | "triggered" | "invalidated" | "expired";
  lastPrice: number | null;
  lastReturn: number | null;
  lastEvaluatedAt: string | null;
  resolvedAt: string | null;
  resolutionPrice: number | null;
  resolutionReturn: number | null;
}

/** Un trimestre de estados (SEC XBRL), en USD. null = tag ausente. */
export interface QuarterStatement {
  start: string;
  end: string;
  /** Q1..Q4 del reporte; Q4 cuando se deriva del anual. */
  fp: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  pretaxIncome: number | null;
  taxExpense: number | null;
  /** Resultado no operativo del trimestre (NonoperatingIncomeExpense). */
  nonoperatingIncome: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  dilutedShares: number | null;
  equity: number | null;
  /** Ítems extraordinarios del trimestre con signo: ganancia > 0 infla, cargo < 0 deprime. */
  extraordinary: Array<{ tag: string; value: number }>;
}
export interface CoreEarnings {
  /** Fin del último trimestre usado. */
  asOf: string;
  revenueTTM: number | null;
  operatingIncomeTTM: number | null;
  coreOperatingIncomeTTM: number | null;
  netIncomeTTM: number | null;
  coreNetIncomeTTM: number | null;
  coreEpsTTM: number | null;
  operatingCashFlowTTM: number | null;
  freeCashFlowTTM: number | null;
  equity: number | null;
  taxRate: number;
  extraordinaryTTM: number;
  extraordinaryItems: Array<{ tag: string; quarterEnd: string; value: number }>;
  /** (neto − núcleo) / max(|neto|, |núcleo|, 1). > 0 ganancia inflada; < 0 deprimida. */
  deviationPct: number | null;
}
export interface Statements {
  symbol: string;
  cik: string;
  asOf: string;
  quarters: QuarterStatement[];
  core: CoreEarnings | null;
}
/** Forma mínima del JSON `companyfacts` de la SEC. */
export interface CompanyFactsJson {
  cik: number | string;
  entityName?: string;
  facts: { "us-gaap"?: Record<string, { units: Record<string, Array<{ start?: string; end: string; val: number; fp?: string; form?: string; filed?: string; frame?: string }>> }> };
}
