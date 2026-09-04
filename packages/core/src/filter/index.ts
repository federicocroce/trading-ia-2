import type { Filter, FilterContext, FilterResult } from "../contracts/index.js";
import type { Quote } from "../contracts/index.js";
import type { RawEvent } from "../schemas/event.js";
import { rawEventDedupeKey } from "../schemas/event.js";

/**
 * Filtro determinístico (DESIGN.md §3.2). Sin LLM. Cada descarte lleva razón.
 */
export interface FilterConfig {
  /** Ventana para eventos con fecha: [minDays, maxDays] desde hoy. */
  minDaysToEvent: number;
  maxDaysToEvent: number;
  /** Volumen promedio mínimo (acciones/día). */
  minAvgVolume: number;
  /** Precio mínimo (evita penny stocks sin opciones). */
  minPrice: number;
  /** Tickers que se aceptan aunque no pasen liquidez (ADRs del portfolio, etc.). */
  allowlist: string[];
  /** Prioridad por tipo cuando hay que recortar al presupuesto. */
  priority: Record<RawEvent["eventType"], number>;
}

export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  minDaysToEvent: 5,
  maxDaysToEvent: 45,
  minAvgVolume: 200_000,
  minPrice: 3,
  allowlist: [],
  priority: { fda: 5, earnings: 4, legal: 3, macro_ar: 2, operational: 1 },
};

export type QuoteLookup = (ticker: string) => Promise<Quote | null>;

export class DefaultFilter implements Filter {
  constructor(
    private readonly quotes: QuoteLookup,
    private readonly cfg: FilterConfig = DEFAULT_FILTER_CONFIG,
  ) {}

  async apply(events: RawEvent[], ctx: FilterContext): Promise<FilterResult> {
    const dropped: FilterResult["dropped"] = [];
    const seen = new Set<string>();
    const candidates: RawEvent[] = [];
    const allow = new Set(this.cfg.allowlist.map((t) => t.toUpperCase()));
    const quoteCache = new Map<string, Quote | null>();

    for (const event of events) {
      const key = rawEventDedupeKey(event);
      if (seen.has(key)) {
        dropped.push({ event, reason: "duplicate" });
        continue;
      }
      seen.add(key);

      if (event.eventDate) {
        const days = daysBetween(ctx.today, event.eventDate);
        if (days < this.cfg.minDaysToEvent) {
          dropped.push({ event, reason: `event in ${days}d < min ${this.cfg.minDaysToEvent}` });
          continue;
        }
        if (days > this.cfg.maxDaysToEvent) {
          dropped.push({ event, reason: `event in ${days}d > max ${this.cfg.maxDaysToEvent}` });
          continue;
        }
      }

      if (!allow.has(event.ticker.toUpperCase())) {
        if (!quoteCache.has(event.ticker)) quoteCache.set(event.ticker, await this.quotes(event.ticker));
        const q = quoteCache.get(event.ticker) ?? null;
        if (!q) {
          dropped.push({ event, reason: "no quote" });
          continue;
        }
        if (q.price < this.cfg.minPrice) {
          dropped.push({ event, reason: `price ${q.price} < ${this.cfg.minPrice}` });
          continue;
        }
        if (q.avgVolume30d !== null && q.avgVolume30d < this.cfg.minAvgVolume) {
          dropped.push({ event, reason: `avg volume ${q.avgVolume30d} < ${this.cfg.minAvgVolume}` });
          continue;
        }
      }
      candidates.push(event);
    }

    candidates.sort((a, b) => {
      const p = this.cfg.priority[b.eventType] - this.cfg.priority[a.eventType];
      if (p !== 0) return p;
      return (a.eventDate ?? "9999").localeCompare(b.eventDate ?? "9999");
    });
    const passed = candidates.slice(0, ctx.maxCandidates);
    for (const event of candidates.slice(ctx.maxCandidates)) dropped.push({ event, reason: "budget exceeded" });
    return { passed, dropped };
  }
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = Date.UTC(+fromIso.slice(0, 4), +fromIso.slice(5, 7) - 1, +fromIso.slice(8, 10));
  const b = Date.UTC(+toIso.slice(0, 4), +toIso.slice(5, 7) - 1, +toIso.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}
