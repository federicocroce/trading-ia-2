import type { Ingestor, RawEvent } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { newEvent } from "../util.js";

/**
 * SEC EDGAR. Dos usos:
 *  1) Ingestor: filings recientes de un universo de tickers (8-K, 10-Q, 10-K, 4, SC 13D/G).
 *  2) Fetch del texto de un filing para el razonador.
 * Requiere User-Agent con contacto (política SEC) y ≤10 req/s.
 */

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;

interface CompanyTickers {
  [k: string]: { cik_str: number; ticker: string; title: string };
}
interface Submissions {
  cik: string;
  name: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      form: string[];
      primaryDocument: string[];
      items?: string[];
      reportDate?: string[];
    };
  };
}

const INTERESTING_FORMS = new Set(["8-K", "10-Q", "10-K", "4", "SC 13D", "SC 13G", "S-1", "424B4", "6-K", "20-F"]);
/** Items de 8-K que suelen mover precio. */
const FDA_KEYWORDS = /pdufa|fda (approval|approves|accept|complete response|advisory committee)|adcom/i;

export interface EdgarOptions {
  http: HttpClient;
  universe: string[];
}

export class EdgarIngestor implements Ingestor {
  readonly source = "edgar" as const;
  private cikCache: Map<string, string> | null = null;

  constructor(private readonly opts: EdgarOptions) {}

  async resolveCik(ticker: string): Promise<string | null> {
    if (!this.cikCache) {
      const data = await this.opts.http.getJson<CompanyTickers>(TICKERS_URL);
      this.cikCache = new Map(Object.values(data).map((c) => [c.ticker.toUpperCase(), String(c.cik_str)]));
    }
    return this.cikCache.get(ticker.toUpperCase()) ?? null;
  }

  async fetch(since: string): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const sinceDate = since.slice(0, 10);
    for (const ticker of this.opts.universe) {
      const cik = await this.resolveCik(ticker);
      if (!cik) continue;
      const sub = await this.opts.http.getJson<Submissions>(submissionsUrl(cik));
      const r = sub.filings.recent;
      for (let i = 0; i < r.accessionNumber.length; i++) {
        const form = r.form[i]!;
        const filingDate = r.filingDate[i]!;
        if (filingDate < sinceDate) continue;
        if (!INTERESTING_FORMS.has(form)) continue;
        const acc = r.accessionNumber[i]!;
        const primaryDoc = r.primaryDocument[i]!;
        const items = r.items?.[i] ?? "";
        const title = `${form}${items ? ` (items ${items})` : ""} — ${sub.name}`;
        const isFda = form === "8-K" && FDA_KEYWORDS.test(title);
        out.push(
          newEvent({
            ticker: ticker.toUpperCase(),
            eventType: isFda ? "fda" : "operational",
            source: "edgar",
            eventDate: null,
            sourceRef: acc,
            title,
            payload: { cik, form, filingDate, items, primaryDoc, url: filingUrl(cik, acc, primaryDoc) },
          }),
        );
      }
    }
    return out;
  }
}

export function filingUrl(cik: string, accession: string, primaryDoc: string): string {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}/${primaryDoc}`;
}

/** Texto plano de un filing (HTML → texto). Recorta a maxChars para controlar tokens. */
export async function fetchFilingText(http: HttpClient, url: string, maxChars = 120_000): Promise<string> {
  const html = await http.getText(url);
  return htmlToText(html).slice(0, maxChars);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|tr|li|h\d|br)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
