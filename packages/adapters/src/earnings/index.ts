import type { Ingestor, RawEvent } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { resolveUniverse } from "../edgar/index.js";
import { addDays, newEvent } from "../util.js";

/**
 * Calendario de earnings de Nasdaq (público, sin key). Un request por día.
 * Emite `earnings` con fecha conocida para tickers del universo (o todos si universe está vacío).
 */
const url = (date: string) => `https://api.nasdaq.com/api/calendar/earnings?date=${date}`;
/** Nasdaq rechaza pedidos sin cabeceras de navegador. */
const NASDAQ_HEADERS = { Accept: "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };

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
        res = await this.opts.http.getJson<NasdaqEarnings>(url(date), NASDAQ_HEADERS);
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

/**
 * La fecha de resultados de cada símbolo según Nasdaq, de hoy a `days` días (10/10). Es la segunda fuente de la regla
 * "resultados cerca": Finnhub difería en 33 de 93 símbolos en la mira, y donde se pudo verificar con la empresa erraba
 * Finnhub (DXCM 22/10 contra el 29/10 fijado; NEM sin fecha y reporta el 22/10; TSM 14/10 contra el 15/10).
 *
 * Un pedido por día hábil. Un día que falla no corta el resto: se cuenta y se devuelve, para que quien llama pueda
 * decir que el calendario quedó incompleto en vez de tratar "sin fecha" como "no reporta".
 */
export async function nasdaqEarningsCalendar(http: HttpClient, from: string, days = 75): Promise<{ fechas: Map<string, string>; diasFallidos: number }> {
  const fechas = new Map<string, string>();
  let diasFallidos = 0;
  for (let i = 0; i <= days; i++) {
    const date = addDays(from, i);
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (day === 0 || day === 6) continue;
    let res: NasdaqEarnings;
    try {
      res = await http.getJson<NasdaqEarnings>(url(date), NASDAQ_HEADERS);
    } catch {
      diasFallidos++;
      continue;
    }
    for (const row of res.data?.rows ?? []) {
      const sym = row.symbol.toUpperCase();
      // Se queda con la primera fecha (la más próxima): el recorrido va en orden de día.
      if (!fechas.has(sym)) fechas.set(sym, date);
    }
  }
  return { fechas, diasFallidos };
}
