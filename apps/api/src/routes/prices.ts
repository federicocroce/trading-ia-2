import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { marketOf, quoteIsStale } from "@thesis/core";
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
const round2 = (n: number) => Math.round(n * 100) / 100;

export function toPriceRow(q: LiveQuote, now = Date.now()): PriceRow {
  const change = q.prevClose ? round2(q.price - q.prevClose) : null;
  const changePct = q.prevClose ? round2(((q.price - q.prevClose) / q.prevClose) * 100) : null;
  const stale = quoteIsStale(q.asOf, new Date(now), marketOf(q.symbol));
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
    const symbols = (ctx.req.query("symbols") ?? "").split(",").map((x) => x.trim().toUpperCase()).filter(Boolean);
    // Lo que el hub ya sigue sale de su foto (sin llamada); el resto se pide.
    const hub = c.priceHub;
    const known = hub ? symbols.map((x) => hub.get(x)).filter((r): r is PriceRow => !!r) : [];
    const missing = symbols.filter((x) => !known.some((r) => r.symbol === x));
    return ctx.json([...known, ...(missing.length ? await quotesFor(missing) : [])]);
  });
  /** Foto completa del hub: todo lo que la app sigue, con su último precio. */
  app.get("/prices/all", (ctx) => ctx.json({ at: c.priceHub?.lastTickAt ?? null, error: c.priceHub?.lastError ?? null, rows: c.priceHub?.snapshot() ?? [] }));
  /** Precios en vivo (SSE): al conectar, la foto completa; después, solo lo que cambia. Latido cada 25 s. */
  app.get("/prices/stream", (ctx) =>
    streamSSE(ctx, async (stream) => {
      const hub = c.priceHub;
      if (!hub) { await stream.writeSSE({ event: "snapshot", data: "[]" }); return; }
      await stream.writeSSE({ event: "snapshot", data: JSON.stringify(hub.snapshot()) });
      let alive = true;
      const unsub = hub.subscribe((rows) => { if (alive) void stream.writeSSE({ event: "prices", data: JSON.stringify(rows) }); });
      stream.onAbort(() => { alive = false; unsub(); });
      while (alive) {
        await stream.sleep(25_000);
        if (alive) await stream.writeSSE({ event: "ping", data: String(Date.now()) }).catch(() => { alive = false; });
      }
      unsub();
    }),
  );
  /** Buscador para el alta a la watchlist (Yahoo). Caché corta por consulta. */
  const searchCache = new Map<string, { at: number; hits: unknown }>();
  app.get("/symbols/search", async (ctx) => {
    const q = (ctx.req.query("q") ?? "").trim().slice(0, 40);
    if (!q) return ctx.json([]);
    const hit = searchCache.get(q.toLowerCase());
    if (hit && Date.now() - hit.at < 10 * 60_000) return ctx.json(hit.hits);
    const hits = await c.symbolSearch.search(q).catch(() => []);
    searchCache.set(q.toLowerCase(), { at: Date.now(), hits });
    return ctx.json(hits);
  });
  let tape: { at: number; body: unknown } | null = null;
  app.get("/prices/tape", async (ctx) => {
    // Con hub, la cinta sale de su foto (siempre fresca); sin hub, se cotiza con caché.
    if (c.priceHub && c.priceHub.snapshot().length) {
      const rows = c.priceHub.snapshot();
      return ctx.json({ at: c.priceHub.lastTickAt ?? new Date().toISOString(), tracked: rows.length, ...pickMovers(rows) });
    }
    if (tape && Date.now() - tape.at < TAPE_TTL_MS) return ctx.json(tape.body);
    const rows = await quotesFor(await tracked());
    const body = { at: new Date().toISOString(), tracked: rows.length, ...pickMovers(rows) };
    tape = { at: Date.now(), body };
    return ctx.json(body);
  });
  return app;
}
