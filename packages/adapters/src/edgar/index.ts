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

export type Universe = string[] | (() => Promise<string[]>);
export const resolveUniverse = async (u: Universe | undefined): Promise<string[]> => (typeof u === "function" ? await u() : (u ?? []));

export interface EdgarOptions {
  http: HttpClient;
  /** Lista fija o función: así el universo sigue solo a posiciones, seguimiento y plan. */
  universe: Universe;
}

/**
 * Form 4 (insiders): el título del índice no dice nada ("4 — EMPRESA"), y la mayoría son vesting, ejercicios
 * o retenciones de impuestos (códigos A, M, F…) que no mueven precio y gastaban cuota del modelo.
 * Se lee el XML y solo generan evento las compras en mercado (P) y las ventas (S).
 */
export interface Form4Summary {
  insider: "compra" | "venta" | "rutina";
  owner: string | null;
  buyShares: number;
  sellShares: number;
  codes: string[];
}
const fmtShares = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function parseForm4(xml: string): Form4Summary {
  const owner = /<rptOwnerName>\s*([^<]+?)\s*<\/rptOwnerName>/.exec(xml)?.[1] ?? null;
  const codes: string[] = [];
  let buyShares = 0;
  let sellShares = 0;
  const txRe = /<(?:nonDerivative|derivative)Transaction>([\s\S]*?)<\/(?:nonDerivative|derivative)Transaction>/g;
  for (const m of xml.matchAll(txRe)) {
    const body = m[1]!;
    const code = /<transactionCode>\s*([A-Z])\s*<\/transactionCode>/.exec(body)?.[1];
    if (!code) continue;
    codes.push(code);
    const shares = Number(/<transactionShares>\s*<value>\s*([\d.]+)/.exec(body)?.[1] ?? 0);
    if (code === "P") buyShares += shares;
    if (code === "S") sellShares += shares;
  }
  const insider: Form4Summary["insider"] = buyShares > 0 ? "compra" : sellShares > 0 ? "venta" : "rutina";
  return { insider, owner, buyShares, sellShares, codes };
}

/** El índice apunta al XML renderizado (xslF345X06/…); el XML crudo es el mismo path sin ese prefijo. */
export const form4XmlDoc = (primaryDoc: string) => primaryDoc.replace(/^xsl[^/]+\//, "");

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
    for (const ticker of await resolveUniverse(this.opts.universe)) {
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
        let title = `${form}${items ? ` (items ${items})` : ""} — ${sub.name}`;
        let extra: Record<string, unknown> = {};
        if (form === "4") {
          // Sin el XML no se sabe si es compra o rutina: se deja pasar como antes, marcado como desconocido.
          let f4: Form4Summary | null = null;
          try {
            f4 = parseForm4(await this.opts.http.getText(filingUrl(cik, acc, form4XmlDoc(primaryDoc))));
          } catch {
            f4 = null;
          }
          if (f4?.insider === "rutina") continue;
          if (f4) {
            const shares = f4.insider === "compra" ? f4.buyShares : f4.sellShares;
            title = `4 ${f4.insider} de insider: ${f4.owner ?? "insider"}, ${fmtShares(shares)} acciones — ${sub.name}`;
            extra = { insider: f4.insider, insiderOwner: f4.owner, insiderBuyShares: f4.buyShares, insiderSellShares: f4.sellShares, insiderCodes: f4.codes };
          } else {
            extra = { insider: "desconocido" };
          }
        }
        const isFda = form === "8-K" && FDA_KEYWORDS.test(title);
        out.push(
          newEvent({
            ticker: ticker.toUpperCase(),
            eventType: isFda ? "fda" : "operational",
            source: "edgar",
            eventDate: null,
            sourceRef: acc,
            title,
            payload: { cik, form, filingDate, items, primaryDoc, url: filingUrl(cik, acc, primaryDoc), ...extra },
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
