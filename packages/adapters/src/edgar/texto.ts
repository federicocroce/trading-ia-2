import type { HttpClient } from "../http/index.js";

/** Dirección y texto de un filing. Aparte de `index.ts` para que `ofertas.ts` los use sin importar al ingestor. */
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
