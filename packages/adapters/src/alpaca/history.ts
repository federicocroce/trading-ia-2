import type { Candle, PriceHistory } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { ALPACA_DATA, alpacaHeaders, type AlpacaConfig } from "./client.js";

interface BarsResp {
  bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>>;
}

/** Barras diarias IEX de Alpaca. Respaldo de Yahoo; el volumen IEX subestima el consolidado. */
export class AlpacaPriceHistory implements PriceHistory {
  constructor(
    private readonly http: HttpClient,
    private readonly cfg: AlpacaConfig,
  ) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    const sym = symbol.toUpperCase();
    const start = new Date(Date.now() - Math.ceil(days * 1.6) * 86_400_000).toISOString().slice(0, 10);
    const r = await this.http.getJson<BarsResp>(`${ALPACA_DATA}/v2/stocks/bars?symbols=${sym}&timeframe=1Day&start=${start}&limit=1000&feed=iex`, alpacaHeaders(this.cfg));
    return (r.bars[sym] ?? []).map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  }
}
