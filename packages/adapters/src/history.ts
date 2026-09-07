import type { Candle, PriceHistory } from "@thesis/core";

/** Primario (Yahoo) con respaldo (Alpaca): si el primario lanza o devuelve vacío, se usa el otro. */
export class FallbackPriceHistory implements PriceHistory {
  constructor(
    private readonly primary: PriceHistory,
    private readonly fallback: PriceHistory,
    private readonly log: (m: string) => void = () => {},
  ) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    try {
      const c = await this.primary.candles(symbol, days);
      if (c.length) return c;
      this.log(`[history] ${symbol}: primario vacío, uso respaldo`);
    } catch (e) {
      this.log(`[history] ${symbol}: primario falló (${String(e).slice(0, 80)}), uso respaldo`);
    }
    return this.fallback.candles(symbol, days);
  }
}
