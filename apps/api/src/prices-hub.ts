import type { Candle } from "@thesis/core";
import { closeAnterior, withUsageStep } from "@thesis/pipeline";
import type { Container } from "./container.js";
import { toPriceRow, type PriceRow } from "./routes/prices.js";

/**
 * Fila del hub: el cambio del día se mide contra el cierre GUARDADO de la sesión anterior (el de Yahoo, el mismo que usan
 * las velas, el Radar y Cartera) y `prevCloseDate` dice de qué fecha es; null = no estaba guardado y vale el de la fuente.
 * El 15/9 la cabecera de TSM medía contra el cierre de Alpaca IEX (418,60) y las velas decían 418,01 (15/9).
 */
export type HubRow = PriceRow & { prevCloseDate: string | null };
/** El cierre guardado cambia una vez por día (cuando se guarda la vela): se relee de la base cada 10 minutos. */
const CLOSES_TTL_MS = 10 * 60_000;
const CLOSES_DAYS = 10;

/**
 * Hub de precios: una sola fuente de precios vivos para toda la app (Cartera, watchlist, cinta, ficha).
 * Cotiza todo lo que la app sigue en un solo lote cada 15 s en horario de mercado US (60 s fuera), guarda la última
 * foto y empuja solo lo que cambió a los clientes conectados (SSE). Los `.BA` van uno por uno vía Yahoo: cada 60 s.
 */
const MARKET_MS = 15_000;
const OFF_MS = 60_000;
const BA_EVERY_MS = 60_000;

/** 15 s con el mercado US abierto (lun–vie 9:30–16:00 ET), 60 s fuera. */
export function hubIntervalMs(now = new Date()): number {
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = et.getDay();
  const mins = et.getHours() * 60 + et.getMinutes();
  const open = day >= 1 && day <= 5 && mins >= 9 * 60 + 30 && mins < 16 * 60;
  return open ? MARKET_MS : OFF_MS;
}

type Listener = (changed: HubRow[]) => void;

export class PriceHub {
  private rows = new Map<string, HubRow>();
  private closes = new Map<string, { at: number; candles: Candle[] }>();
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastBa = 0;
  private ticking = false;
  lastError: string | null = null;
  lastTickAt: string | null = null;

  constructor(private readonly c: Container, private readonly opts: { now?: () => Date; log?: (m: string) => void } = {}) {}

  /** Todo lo que la app sigue: posiciones, watchlist y candidatos vigentes (sin CEDEARs: son un chequeo, no un precio a seguir). */
  async tracked(): Promise<string[]> {
    const [positions, watch, cands] = await Promise.all([this.c.store.positions(), this.c.store.watchlist(), this.c.store.latestCandidates()]);
    return [...new Set([...positions.map((p) => p.symbol), ...watch.map((w) => w.symbol), ...cands.filter((r) => r.kind !== "cedear" && r.kind !== "ar").map((r) => r.symbol)].map((s) => s.toUpperCase()))];
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const now = (this.opts.now ?? (() => new Date()))();
      const all = await this.tracked();
      const ba = all.filter((s) => s.endsWith(".BA"));
      const us = all.filter((s) => !s.endsWith(".BA"));
      const askBa = ba.length > 0 && now.getTime() - this.lastBa >= BA_EVERY_MS;
      const symbols = askBa ? [...us, ...ba] : us;
      if (askBa) this.lastBa = now.getTime();
      const quotes = await withUsageStep({ step: "precios" }, () => this.c.pricesDeps.quotes(symbols));
      const velas = await this.storedCandles(quotes.map((q) => q.symbol.toUpperCase()), now);
      const changed: HubRow[] = [];
      for (const q of quotes) {
        // Contra el cierre guardado de la sesión anterior; si no está guardado, el de la fuente (ver `closeAnterior`).
        const guardado = closeAnterior(velas.get(q.symbol.toUpperCase()) ?? [], q.asOf, now);
        const row: HubRow = { ...toPriceRow({ ...q, prevClose: guardado?.close ?? q.prevClose }, now.getTime()), prevCloseDate: guardado?.date ?? null };
        const prev = this.rows.get(row.symbol);
        if (!prev || prev.price !== row.price || prev.changePct !== row.changePct || prev.stale !== row.stale) {
          this.rows.set(row.symbol, row);
          changed.push(row);
        }
      }
      // Lo que dejó de seguirse sale del mapa.
      const keep = new Set(all);
      for (const k of [...this.rows.keys()]) if (!keep.has(k)) this.rows.delete(k);
      for (const k of [...this.closes.keys()]) if (!keep.has(k)) this.closes.delete(k);
      this.lastError = null;
      this.lastTickAt = now.toISOString();
      if (changed.length) for (const l of this.listeners) l(changed);
    } catch (e) {
      this.lastError = e instanceof Error ? e.message : String(e);
      this.opts.log?.(`[prices] tick falló: ${this.lastError}`);
    } finally {
      this.ticking = false;
    }
  }

  /** Velas guardadas de los últimos días por símbolo, con caché de 10 minutos; de a 20 consultas a la vez. */
  private async storedCandles(symbols: string[], now: Date): Promise<Map<string, Candle[]>> {
    const since = new Date(now.getTime() - CLOSES_DAYS * 86_400_000).toISOString().slice(0, 10);
    const viejos = symbols.filter((s) => {
      const h = this.closes.get(s);
      return !h || now.getTime() - h.at > CLOSES_TTL_MS;
    });
    for (let i = 0; i < viejos.length; i += 20) {
      await Promise.all(viejos.slice(i, i + 20).map(async (s) => {
        const candles = await this.c.store.candles(s, since).catch(() => null);
        if (candles) this.closes.set(s, { at: now.getTime(), candles });
      }));
    }
    return new Map(symbols.map((s) => [s, this.closes.get(s)?.candles ?? []]));
  }

  start(): void {
    const loop = async () => {
      await this.tick();
      this.timer = setTimeout(loop, hubIntervalMs());
    };
    void loop();
  }
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
  // Tipadas como PriceRow para las rutas que ya las usan; cada fila lleva además `prevCloseDate` (ver `HubRow`).
  snapshot(): PriceRow[] {
    return [...this.rows.values()];
  }
  get(symbol: string): PriceRow | undefined {
    return this.rows.get(symbol.toUpperCase());
  }
  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  get clients(): number {
    return this.listeners.size;
  }
}
