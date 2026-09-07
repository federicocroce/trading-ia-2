import type { Candle, PriceHistory } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

interface YahooQuote {
  open: Array<number | null>;
  high: Array<number | null>;
  low: Array<number | null>;
  close: Array<number | null>;
  volume: Array<number | null>;
}
interface YahooChart {
  chart: {
    result: Array<{ timestamp?: number[]; indicators: { quote: YahooQuote[] } }> | null;
    error: { code: string; description: string } | null;
  };
}

const r4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Parser puro del chart API v8 de Yahoo. */
export function parseYahooChart(json: unknown): Candle[] {
  const d = json as YahooChart;
  if (d.chart?.error) throw new Error(`yahoo: ${d.chart.error.description}`);
  const r = d.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0]!;
  const out: Candle[] = [];
  r.timestamp.forEach((ts, i) => {
    const close = q.close[i];
    if (close === null || close === undefined) return;
    // Yahoo devuelve floats con ruido (44.36000061035156): se redondea a 4 decimales en la fuente.
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), open: r4(q.open[i] ?? close), high: r4(q.high[i] ?? close), low: r4(q.low[i] ?? close), close: r4(close), volume: q.volume[i] ?? 0 });
  });
  return out;
}

const rangeFor = (days: number) => (days <= 60 ? "3mo" : days <= 120 ? "6mo" : days <= 250 ? "1y" : "2y");

/** Velas diarias de Yahoo (API no oficial; gratis; cubre .BA para la etapa 3). */
export class YahooPriceHistory implements PriceHistory {
  constructor(private readonly http: HttpClient) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=${rangeFor(days)}&interval=1d`;
    return parseYahooChart(await this.http.getJson(url));
  }
}
