import type { Ingestor, RawEvent } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { newEvent } from "../util.js";
import { CikResolver } from "./statements.js";

/**
 * SEC EDGAR. Dos usos:
 *  1) Ingestor: filings recientes de un universo de tickers (8-K, 10-Q, 10-K, 4, SC 13D/G).
 *  2) Fetch del texto de un filing para el razonador.
 * Requiere User-Agent con contacto (política SEC) y ≤10 req/s.
 */

const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;

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

/**
 * Formularios que existen SÓLO cuando hay una fusión o una oferta de compra en curso: son la única prueba dura de
 * que el precio de la acción está fijado por un acuerdo (AES, 16/9: ver `bajoOfertaDeCompra` en core).
 *
 * `DEF 14A` NO está y no puede estar: es el poder de la asamblea anual, que presenta toda empresa que cotiza.
 */
const OFFER_FORMS = new Set(["DEFM14A", "PREM14A", "SC 14D9", "425"]);
/**
 * Una oferta firmada hace meses sigue fijando el precio hoy, así que estos formularios se miran con una ventana
 * mucho más larga que la de la ingesta normal. AES firmó el 1/3/2026 y presentó su DEFM14A el 15/5: con los 30
 * días de siempre no entraba nunca, y el Radar le seguía calculando un objetivo al doble del riesgo contra un
 * acuerdo en efectivo a 15,00. No cuesta un pedido más: el JSON de submissions ya viene entero.
 */
const OFFER_WINDOW_DAYS = 400;
const INTERESTING_FORMS = new Set(["8-K", "10-Q", "10-K", "4", "SC 13D", "SC 13G", "S-1", "424B4", "6-K", "20-F", ...OFFER_FORMS]);
/** Items de 8-K que suelen mover precio. */
const FDA_KEYWORDS = /pdufa|fda (approval|approves|accept|complete response|advisory committee)|adcom/i;

export type Universe = string[] | (() => Promise<string[]>);
export const resolveUniverse = async (u: Universe | undefined): Promise<string[]> => (typeof u === "function" ? await u() : (u ?? []));

export interface EdgarOptions {
  http: HttpClient;
  /** Lista fija o función: así el universo sigue solo a posiciones, seguimiento y plan. */
  universe: Universe;
  /**
   * Cuáles de estas presentaciones ya están guardadas. Se saltean antes de bajar nada más. Existe para que
   * la ventana pueda ser de 30 días sin costo: sin esto cada corrida volvía a bajar y parsear el XML de
   * cada Form 4 del mes para descubrir lo que ya sabía. Opcional: sin él, todo se trae como antes y la
   * deduplicación la hace la base.
   */
  knownRefs?: (refs: string[]) => Promise<Set<string>>;
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
  private readonly resolver: CikResolver;

  constructor(private readonly opts: EdgarOptions) {
    this.resolver = new CikResolver(opts.http);
  }

  async resolveCik(ticker: string): Promise<string | null> {
    return this.resolver.resolve(ticker);
  }

  async fetch(since: string): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    const sinceDate = since.slice(0, 10);
    // Los formularios de oferta de compra se miran mucho más atrás que el resto: ver OFFER_WINDOW_DAYS.
    const ofertaDesde = new Date(Date.parse(since) - OFFER_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const desdeCuando = (form: string) => (OFFER_FORMS.has(form) ? ofertaDesde : sinceDate);
    for (const ticker of await resolveUniverse(this.opts.universe)) {
      const cik = await this.resolveCik(ticker);
      if (!cik) continue;
      const sub = await this.opts.http.getJson<Submissions>(submissionsUrl(cik));
      const r = sub.filings.recent;
      // Una sola consulta por ticker: cuáles de las de la ventana ya se vieron.
      const enVentana = r.accessionNumber.filter((_, i) => desdeCuando(r.form[i]!) <= r.filingDate[i]! && INTERESTING_FORMS.has(r.form[i]!));
      const conocidas = this.opts.knownRefs && enVentana.length ? await this.opts.knownRefs(enVentana) : new Set<string>();
      for (let i = 0; i < r.accessionNumber.length; i++) {
        const form = r.form[i]!;
        const filingDate = r.filingDate[i]!;
        if (filingDate < desdeCuando(form)) continue;
        if (!INTERESTING_FORMS.has(form)) continue;
        const acc = r.accessionNumber[i]!;
        if (conocidas.has(acc)) continue;
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
          // Una Form 4 de rutina (vesting, ejercicio, retención de impuestos) ya no se saltea en silencio: se
          // guarda marcada y la descarta el filtro con su motivo. Dos razones. El diseño dice que raw_events
          // guarda todo lo ingerido aunque se descarte, y esto era la excepción. Y sin guardarla, la próxima
          // corrida no podía saber que ya la había visto y volvía a bajar su XML, una y otra vez.
          if (f4?.insider === "rutina") {
            title = `4 rutina de insider (${f4.codes.join(", ") || "sin código"}): ${f4.owner ?? "insider"} — ${sub.name}`;
            extra = { insider: "rutina", insiderOwner: f4.owner, insiderCodes: f4.codes };
          } else if (f4) {
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
