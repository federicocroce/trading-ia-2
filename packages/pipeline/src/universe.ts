import type { CandidateRow } from "@thesis/core";

export interface EventUniverseInput {
  /** Lista fija de config/universe.json. */
  config: { us: string[]; adr: string[] };
  positions: Array<{ symbol: string }>;
  watchlist: Array<{ symbol: string }>;
  plan: { lines: Array<{ symbol: string }> } | null;
  /** Último ranking del Radar: entran solo los COMPRAR de tipo acción o seguimiento. */
  candidates: Array<Pick<CandidateRow, "symbol" | "kind" | "verdict">>;
}

/**
 * Universo de la corrida de tesis: config más lo que la cartera y el Radar van sumando solos
 * (posiciones, seguimiento, plan del aporte, COMPRAR del ranking). Sin .BA: EDGAR no los cubre.
 * ETFs, argentinas y CEDEARs quedan afuera: no presentan filings.
 */
export function eventUniverse(i: EventUniverseInput): string[] {
  const radar = i.candidates.filter((c) => c.verdict === "COMPRAR" && (c.kind === "stock" || c.kind === "watch")).map((c) => c.symbol);
  const all = [...i.config.us, ...i.config.adr, ...i.positions.map((p) => p.symbol), ...i.watchlist.map((w) => w.symbol), ...(i.plan?.lines.map((l) => l.symbol) ?? []), ...radar];
  return [...new Set(all.map((x) => x.toUpperCase()))].filter((x) => !x.endsWith(".BA"));
}
