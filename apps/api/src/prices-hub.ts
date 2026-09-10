import { withUsageStep } from "@thesis/pipeline";
import type { Container } from "./container.js";
import { toPriceRow, type PriceRow } from "./routes/prices.js";

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

type Listener = (changed: PriceRow[]) => void;

export class PriceHub {
  private rows = new Map<string, PriceRow>();
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
      const changed: PriceRow[] = [];
      for (const q of quotes) {
        const row = toPriceRow(q, now.getTime());
        const prev = this.rows.get(row.symbol);
        if (!prev || prev.price !== row.price || prev.changePct !== row.changePct || prev.stale !== row.stale) {
          this.rows.set(row.symbol, row);
          changed.push(row);
        }
      }
      // Lo que dejó de seguirse sale del mapa.
      const keep = new Set(all);
      for (const k of [...this.rows.keys()]) if (!keep.has(k)) this.rows.delete(k);
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
