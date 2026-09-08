import { Hono } from "hono";
import type { LiveQuote } from "@thesis/core";
import type { Container } from "../container.js";

/**
 * Precios vivos para la watchlist y la cinta del header (portado de trading v1, con nuestros datos).
 * Caché en memoria corta: la barra lateral y la cinta consultan seguido y Alpaca cobra por llamada.
 */
export interface PriceRow {
  symbol: string;
  price: number;
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  asOf: string | null;
  /** El precio no es de hoy (papel que dejó de operar o feriado): la UI lo pinta gris, no verde/rojo. */
  stale: boolean;
  currency: string | null;
}
const QUOTES_TTL_MS = 60_000;
const TAPE_TTL_MS = 5 * 60_000;
const STALE_AFTER_H = 30;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function toPriceRow(q: LiveQuote, now = Date.now()): PriceRow {
  const change = q.prevClose ? round2(q.price - q.prevClose) : null;
  const changePct = q.prevClose ? round2(((q.price - q.prevClose) / q.prevClose) * 100) : null;
  const stale = q.asOf ? now - Date.parse(q.asOf) > STALE_AFTER_H * 3_600_000 : true;
  return { symbol: q.symbol, price: q.price, prevClose: q.prevClose, change, changePct, asOf: q.asOf, stale, currency: q.currency ?? null };
}

/** Los que más se movieron hoy, arriba y abajo, entre los símbolos que la app sigue. */
export function pickMovers(rows: PriceRow[], n = 12): { gainers: PriceRow[]; losers: PriceRow[] } {
  const fresh = rows.filter((r) => !r.stale && r.changePct !== null);
  const gainers = fresh.filter((r) => (r.changePct ?? 0) > 0).sort((a, b) => (b.changePct ?? 0) - (a.changePct ?? 0)).slice(0, n);
  const losers = fresh.filter((r) => (r.changePct ?? 0) < 0).sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, n);
  return { gainers, losers };
}

export function pricesRoutes(c: Container) {
  const app = new Hono();
  const cache = new Map<string, { at: number; rows: PriceRow[] }>();
  const quotesFor = async (symbols: string[]): Promise<PriceRow[]> => {
    const syms = [...new Set(symbols.map((x) => x.toUpperCase()).filter((x) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(x)))].sort();
    if (!syms.length) return [];
    const key = syms.join(",");
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < QUOTES_TTL_MS) return hit.rows;
    const rows = (await c.pricesDeps.quotes(syms)).map((q) => toPriceRow(q));
    cache.set(key, { at: Date.now(), rows });
    return rows;
  };
  /** Todo lo que la app sigue: posiciones, seguimiento y los candidatos vigentes (US, ETFs, seguimiento). */
  const tracked = async (): Promise<string[]> => {
    const [positions, watch, cands] = await Promise.all([c.store.positions(), c.store.watchlist(), c.store.latestCandidates()]);
    return [...new Set([...positions.map((p) => p.symbol), ...watch.map((w) => w.symbol), ...cands.filter((r) => r.kind !== "cedear").map((r) => r.symbol)])];
  };

  app.get("/prices", async (ctx) => {
    const symbols = (ctx.req.query("symbols") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
    return ctx.json(await quotesFor(symbols));
  });
  let tape: { at: number; body: unknown } | null = null;
  app.get("/prices/tape", async (ctx) => {
    if (tape && Date.now() - tape.at < TAPE_TTL_MS) return ctx.json(tape.body);
    const rows = await quotesFor(await tracked());
    const body = { at: new Date().toISOString(), tracked: rows.length, ...pickMovers(rows) };
    tape = { at: Date.now(), body };
    return ctx.json(body);
  });
  return app;
}
