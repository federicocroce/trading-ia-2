import type { Ingestor, RawEvent } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { newEvent } from "../util.js";

/**
 * CourtListener (gratis; token opcional sube el rate limit). Busca dockets/opiniones
 * recientes que mencionen a empresas del universo. Emite `legal` sin fecha (la fecha del
 * fallo futuro rara vez está en la API); las fechas conocidas entran por ManualCsvIngestor.
 */
const SEARCH = "https://www.courtlistener.com/api/rest/v4/search/";

interface SearchResp {
  results: Array<{ id: number; caseName: string; dateFiled: string; court: string; absolute_url: string; docketNumber?: string }>;
}

export interface CourtListenerOptions {
  http: HttpClient;
  /** ticker -> nombre legal a buscar. */
  companies: Record<string, string>;
  token?: string;
}

export class CourtListenerIngestor implements Ingestor {
  readonly source = "courtlistener" as const;
  constructor(private readonly opts: CourtListenerOptions) {}

  async fetch(since: string): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const headers: Record<string, string> = this.opts.token ? { Authorization: `Token ${this.opts.token}` } : {};
    for (const [ticker, name] of Object.entries(this.opts.companies)) {
      const q = encodeURIComponent(`"${name}"`);
      const url = `${SEARCH}?q=${q}&type=r&order_by=dateFiled%20desc&filed_after=${since.slice(0, 10)}`;
      let res: SearchResp;
      try {
        res = await this.opts.http.getJson<SearchResp>(url, headers);
      } catch {
        continue;
      }
      for (const r of res.results ?? []) {
        out.push(
          newEvent({
            ticker: ticker.toUpperCase(),
            eventType: "legal",
            source: "courtlistener",
            eventDate: null,
            sourceRef: `cl:${r.id}`,
            title: `${r.caseName} (${r.court})`,
            payload: { dateFiled: r.dateFiled, url: `https://www.courtlistener.com${r.absolute_url}`, docketNumber: r.docketNumber ?? null },
          }),
        );
      }
    }
    return out;
  }
}
