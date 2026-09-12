import { z } from "zod";
import { EventType } from "./event.js";

export const Direction = z.enum(["long", "short"]);
export type Direction = z.infer<typeof Direction>;

export const Instrument = z.enum(["stock", "call", "put"]);
export type Instrument = z.infer<typeof Instrument>;

export const Confidence = z.enum(["low", "med", "high"]);
export type Confidence = z.infer<typeof Confidence>;

export const ThesisStatus = z.enum(["proposed", "rejected", "approved", "open", "closed"]);
export type ThesisStatus = z.infer<typeof ThesisStatus>;

/** Quién rechazó una tesis: el umbral de edge, el riesgo, o el humano. */
export const RejectionReason = z.enum(["edge_below_threshold", "risk_rule", "human"]);
export type RejectionReason = z.infer<typeof RejectionReason>;

/**
 * Salida ESTRICTA del módulo de razonamiento (DESIGN.md §3.3).
 * Es lo único que Claude puede devolver. Se valida antes de persistir.
 */
export const ThesisProposal = z
  .object({
    ticker: z.string().min(1).max(12),
    eventType: EventType,
    eventDate: z.string().date().nullable(),
    direction: Direction,
    /** Probabilidad estimada por el sistema de que el evento salga a favor. */
    pEstimate: z.number().min(0).max(1),
    /** Probabilidad implícita en el precio de mercado (opciones o move implícito). */
    pMarket: z.number().min(0).max(1),
    instrument: Instrument,
    entryMax: z.number().positive(),
    target: z.number().positive(),
    /** Hecho concreto que anula la tesis. Obligatorio y no vacío. */
    invalidation: z.string().min(20),
    confidence: Confidence,
    reasoning: z.string().min(50),
    sources: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type ThesisProposal = z.infer<typeof ThesisProposal>;

/** edge = pEstimate - pMarket, siempre derivado, nunca declarado por el LLM. */
export function computeEdge(p: Pick<ThesisProposal, "pEstimate" | "pMarket" | "direction">): number {
  const raw = p.pEstimate - p.pMarket;
  return p.direction === "long" ? raw : -raw;
}

/** Tesis persistida: propuesta + metadata de ciclo de vida. */
export const Thesis = ThesisProposal.extend({
  id: z.string().uuid(),
  rawEventId: z.string().uuid(),
  edge: z.number(),
  status: ThesisStatus,
  rejectionReason: RejectionReason.nullable(),
  /**
   * ¿`pMarket` salió de la cadena de opciones (lo fija el sistema, auditable) o lo estimó el modelo?
   * Importa porque el edge es pEstimate − pMarket: si pMarket no se midió, el edge no es contra el mercado.
   */
  pMarketFromOptions: z.boolean().optional(),
  promptVersion: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Thesis = z.infer<typeof Thesis>;
