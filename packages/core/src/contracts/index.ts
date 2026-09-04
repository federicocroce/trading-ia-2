import type { RawEvent } from "../schemas/event.js";
import type { Thesis, ThesisProposal } from "../schemas/thesis.js";
import type { Order, OrderIntent } from "../schemas/order.js";
import type { Outcome } from "../schemas/outcome.js";

/**
 * Contratos de los cinco módulos (DESIGN.md §3). Cada implementación se escribe
 * contra esta interfaz, nunca contra otra implementación.
 */

/** 3.1 Ingesta: un adaptador por fuente. Idempotente por sourceRef. */
export interface Ingestor {
  readonly source: RawEvent["source"];
  /** Devuelve eventos nuevos desde `since` (ISO). Nunca lanza por datos vacíos. */
  fetch(since: string): Promise<RawEvent[]>;
}

/** 3.2 Filtro: determinístico, sin LLM. Devuelve los candidatos que pasan y por qué no pasaron los demás. */
export interface FilterResult {
  passed: RawEvent[];
  dropped: Array<{ event: RawEvent; reason: string }>;
}
export interface Filter {
  apply(events: RawEvent[], ctx: FilterContext): Promise<FilterResult>;
}
export interface FilterContext {
  today: string; // ISO date
  /** Máximo de candidatos que pasan al razonamiento por corrida (presupuesto). */
  maxCandidates: number;
}

/** 3.3 Razonamiento: recibe un candidato + documentos, devuelve una propuesta validada. */
export interface DocumentBundle {
  event: RawEvent;
  documents: Array<{ ref: string; title: string; text: string }>;
  /** Eventos pasados del mismo tipo con su resultado, para calibración. */
  comparables: Array<{ thesis: Thesis; outcome: Outcome }>;
}
export interface Reasoner {
  readonly promptVersion: string;
  propose(bundle: DocumentBundle): Promise<ThesisProposal>;
}

/** 3.4 Riesgo: reglas duras en código. Convierte tesis aprobada en OrderIntent o la rechaza. */
export interface PortfolioSnapshot {
  capitalUsd: number;
  /** Exposición abierta por thesisId. */
  openByThesis: Record<string, number>;
  /** Exposición abierta agrupada por tipo de evento. */
  openByEventType: Partial<Record<Thesis["eventType"], number>>;
  dailyPnlUsd: number;
  killSwitch: boolean;
}
export type RiskDecision =
  | { ok: true; intent: OrderIntent }
  | { ok: false; rule: string; detail: string };
export interface RiskEngine {
  size(thesis: Thesis, price: number, portfolio: PortfolioSnapshot): RiskDecision;
}

/** 3.5 Broker: paper por ahora. Cada orden lleva su thesisId. */
export interface Broker {
  readonly paper: boolean;
  submit(intent: OrderIntent): Promise<Order>;
  getOrder(brokerOrderId: string): Promise<Order>;
  cancel(brokerOrderId: string): Promise<void>;
}

/** Datos de mercado (precios, opciones). No es un Ingestor: se consulta bajo demanda. */
export interface Quote {
  ticker: string;
  price: number;
  asOf: string;
  avgVolume30d: number | null;
}
export interface ImpliedMove {
  ticker: string;
  expiration: string;
  spot: number;
  /** Prima ATM call + put. */
  straddle: number;
  /** straddle / spot, en fracción (0.08 = ±8%). */
  impliedMovePct: number;
}
export interface OptionContractQuote {
  symbol: string; // OCC
  strike: number;
  expiration: string;
  type: "call" | "put";
  bid: number;
  ask: number;
  mid: number;
}
export interface MarketData {
  getQuote(ticker: string): Promise<Quote | null>;
  /** Move implícito por el straddle ATM del vencimiento posterior más cercano a eventDate. */
  getImpliedMove(ticker: string, eventDate: string): Promise<ImpliedMove | null>;
  /** Contrato ATM (o el más cercano a `strike`) para ejecutar una tesis de opciones. */
  findOption(ticker: string, type: "call" | "put", afterDate: string, strike?: number): Promise<OptionContractQuote | null>;
}
