/** Radar (etapa 2): tipos y puertos. Sin I/O. */
/**
 * Familias de filas del Radar: cada una tiene su propia "última fecha", porque las producen corridas
 * distintas que no siempre corren el mismo día. Si las filas argentinas compartieran fecha con el ranking de
 * EE.UU., una corrida de Argentina un día sin ranking escondería las acciones del día anterior.
 *
 * Una sola definición para los dos almacenes (13/9/2026). Hasta hoy la base real tenía la lista escrita a
 * mano y DESCARTABA cualquier tipo que no estuviera; la de memoria de los tests lo metía en la familia de
 * EE.UU. Al agregar `adr`, la base real no mostraba ninguno y los tests pasaban igual.
 */
export const CANDIDATE_FAMILIES = {
  us: ["stock", "etf"],
  // `adr` va con Argentina: lo produce la misma corrida y comparte su fecha.
  ar: ["ar", "cedear", "adr"],
  watch: ["watch"],
} as const satisfies Record<string, ReadonlyArray<CandidateKind>>;
export type CandidateFamily = keyof typeof CANDIDATE_FAMILIES;
export type CandidateKind = "stock" | "etf" | "ar" | "cedear" | "watch" | "adr";
export const familyOf = (kind: CandidateKind): CandidateFamily =>
  (Object.keys(CANDIDATE_FAMILIES) as CandidateFamily[]).find((f) => (CANDIDATE_FAMILIES[f] as ReadonlyArray<string>).includes(kind))!;

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
  /** `verifyPerRun`: tope de verificaciones web (llamadas al modelo con búsqueda) por corrida; la cuota gratis de búsqueda es chica (default 8). */
  /**
   * `top`: cuántas filas entran por puntaje (como siempre). `maxRows`: tope total, porque además entran TODAS las
   * COMPRAR de la preselección aunque queden abajo del corte (16/9: 13 quedaban afuera, con puestos 77 a 149).
   * Sin `maxRows`, el doble de `top`. Ver `seleccionarCandidatas`.
   */
  candidates: { top: number; preselect: number; chronicWeeks: number; verifyPerRun?: number | undefined; maxRows?: number | undefined };
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
  /** `adr`: empresa argentina con ADR en Nueva York, medida en dólares contra el SPY (pestaña Argentina). */
  kind: CandidateKind;
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
  events?: CandidateEvent[];
  analystTargets?: AnalystTargets | null;
  /** Verificación web del candidato (modelo con búsqueda): lo que la fila necesita para salvedades, plan y ficha. */
  verification?: VerificationSummary | null;
  /** Cuándo entrar: estado, nivel y condición (ver radar/entry.ts). */
  entry?: import("./entry.js").EntryTiming | null;
}

/** Verificación por candidata (spec 2026-09-10): el modelo investiga en la web con un cuestionario fijo y dictamina. */
export type VerificationVerdict = "apto" | "con_reservas" | "evitar";
export interface VerificationSummary {
  date: string;
  verdict: VerificationVerdict;
  reason: string;
  /** Objetivo de consenso que encontró la verificación (para la salvedad "consenso en el precio" cuando no hay titulares de analistas). */
  consensusTarget?: number | null;
  /**
   * Versión del cuestionario con el que se verificó. El plan solo acepta una acción verificada con el vigente
   * (13/9): NBN salió "apto" con un cuestionario que no preguntaba si la sorpresa sobrevivía sin extraordinarios.
   * Las filas guardadas antes no la tienen, y eso cuenta como cuestionario anterior.
   */
  promptVersion?: string | null;
}
export interface CandidateVerification extends VerificationSummary {
  symbol: string;
  /** Último trimestre reportado: fecha, contra consenso, únicos, guía. */
  lastQuarter: { reportDate: string | null; revenueVsConsensus: string | null; epsVsConsensus: string | null; oneOffs: string[]; guidance: string | null } | null;
  /** Acciones de analistas de los últimos 90 días con fecha. */
  analysts: Array<{ date: string; firm: string; action: string; target: number | null }>;
  consensusTarget: number | null;
  /** Eventos materiales de 90 días: regulatorio, litigio, dilución, gestión, informes bajistas, ciberataques. */
  events: Array<{ date: string; kind: string; headline: string }>;
  valuation: string | null;
  nextEarnings: string | null;
  /** Fuentes que la búsqueda citó (título y URL). */
  sources: Array<{ title: string; url: string }>;
  /** Texto de la investigación, para auditar. */
  researchText: string;
  promptVersion: string;
  model: string | null;
  detectedAt: string;
}
export interface VerifierInput {
  symbol: string;
  name: string | null;
  today: string;
  /** Contexto que la app ya sabe (resumen de la ficha, banderas): el modelo lo contrasta, no lo repite. */
  context?: string | null;
}
export type VerifierResult = Omit<CandidateVerification, "symbol" | "date" | "detectedAt" | "promptVersion">;
export interface CandidateVerifier {
  readonly promptVersion: string;
  verify(input: VerifierInput): Promise<VerifierResult>;
  /**
   * ¿El informe guardado con esa versión responde el mismo cuestionario de investigación que el vigente? (18/9) Si sí,
   * se vuelve a estructurar su texto en vez de buscar de nuevo: la búsqueda es la cuota escasa.
   */
  puedeReestructurar?(promptVersion: string): boolean;
  reestructurar?(input: { symbol: string; today: string; researchText: string; sources: Array<{ title: string; url: string }>; model: string | null }): Promise<VerifierResult>;
}

/**
 * Revisión antes de comprar (15/9): una segunda búsqueda, independiente de la verificación, sobre lo que el plan
 * compraría hoy. Busca razones para NO comprarla. Solo "sin_objeciones" deja comprar (ver `reviewBlock`).
 */
export interface PreTradeReviewInput {
  symbol: string;
  name: string | null;
  today: string;
  /** Lo que dijo la verificación, para que la revisión no la repita sino que la contraste. */
  verification: { verdict: string; reason: string; date: string } | null;
  line: { kind: string; close: number | null; stop: number | null };
}
export interface PreTradeReviewResult {
  verdict: "sin_objeciones" | "objecion" | "no_pude_verificar";
  reason: string;
  sources: Array<{ title: string; url: string }>;
  researchText: string;
  model: string;
}
export interface PreTradeReviewer {
  readonly promptVersion: string;
  review(input: PreTradeReviewInput): Promise<PreTradeReviewResult>;
}
/** Una revisión guardada: una por símbolo y por día. */
export interface PreTradeReview extends PreTradeReviewResult {
  symbol: string;
  date: string;
  promptVersion: string;
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
  /** Eventos materiales de 90 días (grave y moderado). undefined = no se buscaron. */
  events?: CandidateEvent[];
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

export type EventKind = "regulatorio" | "continuidad" | "contable" | "listado" | "guidance" | "dilucion" | "litigio" | "gestion" | "analista" | "otro";
export type EventSeverity = "grave" | "moderado" | "ruido";
/** Evento material guardado (spec verificación §5). */
export interface RadarEvent {
  symbol: string;
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
  url: string;
  source: string | null;
  why: string | null;
  detectedAt: string;
  promptVersion: string | null;
}
/** Lo que lleva la fila del candidato: solo lo necesario para salvedades y ficha. */
export interface CandidateEvent {
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
}
export interface AnalystAction {
  symbol: string;
  date: string;
  firm: string;
  action: "mantiene" | "sube" | "baja" | "inicia";
  rating: string | null;
  target: number | null;
  url: string;
}
export interface AnalystTargets {
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  latestDate: string | null;
}
/** Clasificador de titulares (modelo). Solo clasifica lo que el prefiltro marcó; nunca decide el veredicto. */
export interface EventClassifierInput {
  symbol: string;
  name: string | null;
  /** `id` es el índice 0-based dentro de este envío, asignado por `scanEventsFor`: el modelo lo usa para identificar cada ítem sin ambigüedad de titular. */
  items: Array<{ id: number; date: string; source: string | null; headline: string; summary: string | null; url: string; kind: EventKind }>;
}
export interface ClassifiedEvent {
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
  url: string;
  source: string | null;
  why: string;
}
export interface EventClassifier {
  readonly promptVersion: string;
  classify(input: EventClassifierInput): Promise<ClassifiedEvent[]>;
}

/** Barra para el gráfico: `time` en epoch segundos (intradiario) o medianoche UTC (diario). */
export interface ChartBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /**
   * Indicadores calculados en el servidor con las mismas funciones que deciden el veredicto, para que el
   * gráfico no dibuje una media distinta de la que excluye o habilita a la candidata. Solo en diario;
   * `undefined` cuando no hay historia suficiente para esa ventana.
   */
  sma20?: number | null;
  sma50?: number | null;
  sma200?: number | null;
  /** Stop dinámico (chandelier 22 ruedas, 3 ATR): la línea que, si la rompe, anula la tesis. */
  stop?: number | null;
  /** RSI de Wilder de 14 ruedas. Contexto de momento; la app NO decide con esto. */
  rsi14?: number | null;
  /** Vela de la sesión en curso (o de la última que la base todavía no guardó), armada con el intradiario. */
  partial?: boolean;
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
  /** Ganancia del trimestre que se llevan los socios minoritarios (NetIncomeLossAttributableToNoncontrollingInterest). */
  noncontrolling: number | null;
  /** Cuentas a cobrar al cierre del trimestre (instantáneo). */
  receivables: number | null;
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
  /** Ganancia TTM de los socios minoritarios (ya restada del neto núcleo). null si la empresa no la reporta. */
  noncontrollingTTM: number | null;
  /** Cuentas a cobrar del último trimestre sobre ingresos TTM (0.42 = cobra 42% de un año de ventas). null si no hay dato. */
  receivablesPctRevenue: number | null;
  /** Último trimestre contra el mismo del año anterior, en %. null si falta el comparable o la base no es positiva. */
  lastQuarterYoy: { end: string; revenuePct: number | null; operatingPct: number | null } | null;
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
