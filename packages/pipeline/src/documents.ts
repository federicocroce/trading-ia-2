import type { DocumentBundle, RawEvent } from "@thesis/core";
import { EdgarIngestor, fetchFilingText, filingUrl, htmlToText, type HttpClient } from "@thesis/adapters";

export type Doc = DocumentBundle["documents"][number];

/** Provee los documentos primarios para un evento. */
export interface DocumentProvider {
  documentsFor(event: RawEvent): Promise<Doc[]>;
}

interface Submissions {
  name: string;
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; primaryDocument: string[] } };
}

/**
 * Documentos desde EDGAR: último 10-K, último 10-Q (o 20-F/6-K para ADRs) y 8-Ks recientes.
 * Para eventos que ya traen url de filing (edgar), ese filing va primero.
 * Para eventos AR, incluye la descripción y el artículo si se puede bajar.
 */
export class EdgarDocumentProvider implements DocumentProvider {
  private readonly edgar: EdgarIngestor;
  constructor(
    private readonly http: HttpClient,
    private readonly opts: { maxCharsPerDoc?: number; recent8k?: number } = {},
  ) {
    this.edgar = new EdgarIngestor({ http, universe: [] });
  }

  async documentsFor(event: RawEvent): Promise<Doc[]> {
    const max = this.opts.maxCharsPerDoc ?? 80_000;
    const docs: Doc[] = [];

    if (event.source === "edgar" && typeof event.payload["url"] === "string") {
      docs.push({ ref: `edgar:${event.sourceRef}`, title: event.title, text: await safe(() => fetchFilingText(this.http, event.payload["url"] as string, max)) });
    }
    if (event.source === "ar_official") {
      const desc = String(event.payload["description"] ?? "");
      let article = "";
      if (typeof event.payload["link"] === "string") article = await safe(() => this.http.getText(event.payload["link"] as string).then((h) => htmlToText(h).slice(0, max)));
      docs.push({ ref: `ar:${event.sourceRef}`, title: event.title, text: `${desc}\n\n${article}`.trim() });
    }
    if (event.ticker === "ARG") return docs;

    const cik = await safe(() => this.edgar.resolveCik(event.ticker), null);
    if (!cik) return docs;
    const sub = await safe(() => this.http.getJson<Submissions>(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`), null);
    if (!sub) return docs;
    const r = sub.filings.recent;
    const pick = (forms: string[], n: number) => {
      const out: Array<{ acc: string; form: string; date: string; doc: string }> = [];
      for (let i = 0; i < r.form.length && out.length < n; i++) {
        if (forms.includes(r.form[i]!)) out.push({ acc: r.accessionNumber[i]!, form: r.form[i]!, date: r.filingDate[i]!, doc: r.primaryDocument[i]! });
      }
      return out;
    };
    const wanted = [...pick(["10-K", "20-F"], 1), ...pick(["10-Q", "6-K"], 1), ...pick(["8-K"], this.opts.recent8k ?? 3)];
    for (const f of wanted) {
      if (docs.some((d) => d.ref === `edgar:${f.acc}`)) continue;
      const text = await safe(() => fetchFilingText(this.http, filingUrl(cik, f.acc, f.doc), max), "");
      if (text) docs.push({ ref: `edgar:${f.acc}`, title: `${f.form} ${f.date} — ${sub.name}`, text });
    }
    return docs;
  }
}

async function safe<T>(fn: () => Promise<T>, fallback: T = "" as T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}
