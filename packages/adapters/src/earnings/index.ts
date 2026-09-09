import type { Ingestor, RawEvent } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { resolveUniverse } from "../edgar/index.js";
import { addDays, newEvent } from "../util.js";

/**
 * Calendario de earnings de Nasdaq (público, sin key). Un request por día.
 * Emite `earnings` con fecha conocida para tickers del universo (o todos si universe está vacío).
 */
const url = (date: string) => `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;

interface NasdaqEarnings {
  data: { rows: Array<{ symbol: string; name: string; time: string; epsForecast: string; noOfEsts: string; lastYearEPS: string; marketCap: string }> | null } | null;
}

export interface EarningsOptions {
  http: HttpClient;
  /** Vacío = todo el calendario. */
  universe?: string[] | (() => Promise<string[]>);
  /** Días hacia adelante a consultar. */
  horizonDays?: number;
}

export class NasdaqEarningsIngestor implements Ingestor {
  readonly source = "earnings_calendar" as const;
  constructor(private readonly opts: EarningsOptions) {}

  async fetch(since: string): Promise<RawEvent[]> {
    const start = since.slice(0, 10);
    const horizon = this.opts.horizonDays ?? 45;
    const universe = new Set((await resolveUniverse(this.opts.universe)).map((t) => t.toUpperCase()));
    const out: RawEvent[] = [];
    for (let i = 0; i <= horizon; i++) {
      const date = addDays(start, i);
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) continue;
      let res: NasdaqEarnings;
      try {
        res = await this.opts.http.getJson<NasdaqEarnings>(url(date), { Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
      } catch {
        continue;
      }
      for (const row of res.data?.rows ?? []) {
        const ticker = row.symbol.toUpperCase();
        if (universe.size && !universe.has(ticker)) continue;
        out.push(
          newEvent({
            ticker,
            eventType: "earnings",
            source: "earnings_calendar",
            eventDate: date,
            sourceRef: `nasdaq:${ticker}:${date}`,
            title: `Earnings ${row.name} (${row.time || "time n/a"})`,
            payload: { epsForecast: row.epsForecast, estimates: row.noOfEsts, lastYearEps: row.lastYearEPS, marketCap: row.marketCap, time: row.time },
          }),
        );
      }
    }
    return out;
  }
}
