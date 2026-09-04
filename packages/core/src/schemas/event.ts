import { z } from "zod";

/** Tipos de tesis soportados en v1 (DESIGN.md §2). */
export const EventType = z.enum(["fda", "earnings", "legal", "macro_ar", "operational"]);
export type EventType = z.infer<typeof EventType>;

/** Fuentes de ingesta. Cada adaptador emite un `source` fijo. */
export const EventSource = z.enum([
  "edgar",
  "fda",
  "earnings_calendar",
  "alpaca_market",
  "courtlistener",
  "news",
  "ar_official",
  "manual",
]);
export type EventSource = z.infer<typeof EventSource>;

/**
 * Evento crudo tal como sale de la ingesta. Se guarda SIEMPRE, aunque el
 * filtro lo descarte después (principio: todo se mide).
 */
export const RawEvent = z.object({
  id: z.string().uuid(),
  ticker: z.string().min(1).max(12),
  eventType: EventType,
  source: EventSource,
  /** Fecha del evento si es conocida (eventos con fecha). null para `operational`. */
  eventDate: z.string().date().nullable(),
  /** Identificador estable en la fuente (accession number, PDUFA id, url). */
  sourceRef: z.string().min(1),
  title: z.string().min(1),
  /** Payload libre del adaptador; se persiste como jsonb. */
  payload: z.record(z.unknown()).default({}),
  observedAt: z.string().datetime(),
});
export type RawEvent = z.infer<typeof RawEvent>;

/** Clave de deduplicación: un RawEvent por (ticker, tipo, fecha, sourceRef). */
export function rawEventDedupeKey(e: Pick<RawEvent, "ticker" | "eventType" | "eventDate" | "sourceRef">): string {
  return `${e.ticker.toUpperCase()}|${e.eventType}|${e.eventDate ?? "-"}|${e.sourceRef}`;
}
