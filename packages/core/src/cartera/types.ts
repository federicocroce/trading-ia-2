/** Cartera real del dueño (etapa 1). Tipos y puertos; sin I/O. */
export interface Candle {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * Cierre ajustado por dividendos (y splits). `close` solo está ajustado por splits, así que un instrumento
   * que rinde por cupón (SGOV: precio clavado en 100,4 con una caída de 0,28% cada primero de mes) parece
   * plano. El retorno total se calcula con este campo; los precios, stops y medias siguen usando `close`.
   */
  adjClose?: number | null;
}
export type Market = "us" | "adr" | "ar";
export type Layer = "riesgo" | "nucleo" | "cobertura";
export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
  market: Market;
  layer: Layer;
  notes: string | null;
}
export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";

export interface Transaction {
  id: string;
  symbol: string;
  type: "BUY" | "SELL" | "DIVIDEND" | "TRANSFER";
  quantity: number;
  price: number;
  fees: number;
  /** YYYY-MM-DD */
  date: string;
  currency: string;
  platform: string | null;
  externalId: string | null;
  notes: string | null;
}

/** Fila persistida de un veredicto diario, con su medición posterior. */
export interface VerdictRow {
  verdictDate: string;
  symbol: string;
  verb: Verb;
  reason: string;
  narrative: string | null;
  warning: string | null;
  close: number;
  spot: number | null;
  stop: number | null;
  target: number | null;
  gainPct: number;
  weightPct: number;
  spyClose: number | null;
  degradedBy: string | null;
  promptVersion: string | null;
  close7d: number | null;
  spy7d: number | null;
  alpha7dPct: number | null;
  close30d: number | null;
  spy30d: number | null;
  alpha30dPct: number | null;
  measuredAt: string | null;
}

/** Velas diarias ascendentes por fecha. `days` es cuántas velas hacia atrás como mínimo. */
export interface PriceHistory {
  candles(symbol: string, days: number): Promise<Candle[]>;
}
export interface SymbolProfile {
  symbol: string;
  name: string | null;
  country: string | null;
  industry: string | null;
  marketCap: number | null;
  /** Moneda de los estados contables (ADRs: local). */
  currency?: string | null;
  /** Acciones en circulación, en millones (para capitalización en USD con precio de Alpaca). */
  shareOutstanding?: number | null;
}
export interface Profiles {
  profile(symbol: string): Promise<SymbolProfile | null>;
}

export interface NarratorInput {
  position: Position;
  verb: Verb;
  reason: string;
  close: number;
  stop: number | null;
  target: number | null;
  gainPct: number;
  weightPct: number;
  /** Últimos 30 cierres, ascendentes. */
  last30: number[];
  filings: string[];
  news: string[];
  riskFacts: string[];
}
export interface Note {
  narrative: string;
  degrade: boolean;
  degradeReason?: string;
}
/** El modelo escribe; solo puede pedir degradar. El código decide qué hacer con eso. */
export interface PositionNarrator {
  readonly promptVersion: string;
  narrate(input: NarratorInput): Promise<Note>;
}
