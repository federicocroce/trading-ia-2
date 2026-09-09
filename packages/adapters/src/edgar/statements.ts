import { buildQuarters, coreEarnings, type CompanyFactsJson, type Statements } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

/**
 * Estados trimestrales desde la API XBRL de la SEC (spec verificación §4). Gratis; exige User-Agent con contacto
 * (el `http` del container ya lo lleva) y ≤ 10 req/s. Un JSON por empresa (0,5–3 MB): el pipeline lo pide solo
 * para la pre-selección y sus pares; la frescura de 7 días la maneja el pipeline en la tabla statements.
 */
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const companyFactsUrl = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`;

interface CompanyTickers {
  [k: string]: { cik_str: number; ticker: string; title: string };
}

export class CikResolver {
  private cache: Map<string, string> | null = null;
  constructor(private readonly http: HttpClient) {}
  async resolve(ticker: string): Promise<string | null> {
    if (!this.cache) {
      const data = await this.http.getJson<CompanyTickers>(TICKERS_URL);
      this.cache = new Map(Object.values(data).map((c) => [c.ticker.toUpperCase(), String(c.cik_str)]));
    }
    return this.cache.get(ticker.toUpperCase()) ?? null;
  }
}

export class SecStatements {
  private readonly resolver: CikResolver;
  constructor(
    private readonly http: HttpClient,
    resolver?: CikResolver,
  ) {
    this.resolver = resolver ?? new CikResolver(http);
  }
  async quarters(symbol: string, today: string): Promise<Statements | null> {
    const sym = symbol.toUpperCase();
    const cik = await this.resolver.resolve(sym);
    if (!cik) return null;
    const json = await this.http.getJson<CompanyFactsJson>(companyFactsUrl(cik));
    const quarters = buildQuarters(json);
    if (!quarters.length) return null;
    return { symbol: sym, cik, asOf: today, quarters, core: coreEarnings(quarters) };
  }
}
