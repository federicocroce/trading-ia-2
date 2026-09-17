import type { HttpClient } from "../http/index.js";
import { FORMULARIOS_DE_OFERTA } from "@thesis/core";
import { CikResolver } from "./statements.js";

/** Una oferta firmada hace meses sigue fijando el precio hoy (AES: DEFM14A del 15/5 seguía vigente en septiembre). */
export const VENTANA_OFERTA_DIAS = 400;

/** Construye el título de un filing en el formato estándar: `"<form>[ (items ...)] — <company>"`. */
export const tituloDeFiling = (form: string, items: string, name: string): string =>
  `${form}${items ? ` (items ${items})` : ""} — ${name}`;

interface Submissions {
  name: string;
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; items?: string[] } };
}
const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
const DAY = 86_400_000;

/**
 * Consulta en vivo a EDGAR: los títulos de los formularios de oferta de un símbolo, con el mismo formato que guarda el
 * ingestor (`"<formulario>[ (items …)] — <empresa>"`), para que `bajoOfertaDeCompra` los lea igual. Un pedido por
 * símbolo (más la tabla de CIKs, que se cachea), y el resultado se cachea por símbolo dentro del proceso: el ranking
 * pregunta por cada fila de la preselección y después por cada fila guardada. No escribe nada.
 */
export class EdgarOfferForms {
  private readonly resolver: CikResolver;
  private readonly cache = new Map<string, Promise<string[]>>();
  constructor(private readonly http: HttpClient, resolver?: CikResolver) {
    this.resolver = resolver ?? new CikResolver(http);
  }

  async offerFilingTitles(ticker: string, opts: { today?: string; windowDays?: number } = {}): Promise<string[]> {
    const sym = ticker.toUpperCase();
    const key = `${sym}|${opts.today ?? ""}|${opts.windowDays ?? ""}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.lookup(sym, opts).catch((e) => { this.cache.delete(key); throw e; });
      this.cache.set(key, p);
    }
    return p;
  }

  private async lookup(sym: string, opts: { today?: string; windowDays?: number }): Promise<string[]> {
    const cik = await this.resolver.resolve(sym);
    if (!cik) return [];
    const sub = await this.http.getJson<Submissions>(submissionsUrl(cik));
    const hoy = Date.parse(opts.today ?? new Date().toISOString().slice(0, 10));
    const desde = new Date(hoy - (opts.windowDays ?? VENTANA_OFERTA_DIAS) * DAY).toISOString().slice(0, 10);
    const r = sub.filings.recent;
    const out: string[] = [];
    for (let i = 0; i < r.form.length; i++) {
      const form = r.form[i]!;
      if (!(FORMULARIOS_DE_OFERTA as readonly string[]).includes(form)) continue;
      const fecha = r.filingDate[i]!;
      if (fecha < desde || fecha > new Date(hoy).toISOString().slice(0, 10)) continue;
      const items = r.items?.[i] ?? "";
      out.push(tituloDeFiling(form, items, sub.name));
    }
    return out;
  }
}
