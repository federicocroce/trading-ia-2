import type { HttpClient } from "../http/index.js";
import { CikResolver } from "./statements.js";

/**
 * Formularios que existen SÓLO cuando hay una fusión o una oferta de compra en curso. Son la prueba dura de que el
 * precio lo fija un acuerdo (AES a 15,00 en efectivo, 16/9; WTRG a 0,305 acciones de AWK, 17/9). El `DEF 14A` es el
 * poder de la asamblea anual y lo presenta toda empresa: no cuenta. Misma lista que `bajoOfertaDeCompra` en core.
 */
export const FORMULARIOS_DE_OFERTA = ["DEFM14A", "PREM14A", "SC 14D9", "425"] as const;
/** Una oferta firmada hace meses sigue fijando el precio hoy (AES: DEFM14A del 15/5 seguía vigente en septiembre). */
export const VENTANA_OFERTA_DIAS = 400;

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
      out.push(`${form}${items ? ` (items ${items})` : ""} — ${sub.name}`);
    }
    return out;
  }
}
