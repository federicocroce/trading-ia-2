import type { Ingestor, RawEvent } from "@thesis/core";
import { XMLParser } from "fast-xml-parser";
import type { HttpClient } from "../http/index.js";
import { newEvent } from "../util.js";

/**
 * Fuente argentina v1: feeds RSS (Boletín Oficial, BCRA, medios económicos) filtrados por
 * keywords de las empresas del portfolio y de macro. Emite `macro_ar` (sin fecha salvo que el
 * título la traiga) y `operational` para menciones directas a una empresa.
 *
 * Es deliberadamente simple: la señal fuerte para ADRs es política/regulatoria y no hay API
 * estructurada. El razonador es quien lee el contenido.
 */
export interface ArFeed {
  url: string;
  name: string;
}

export const DEFAULT_AR_FEEDS: ArFeed[] = [
  { url: "https://www.boletinoficial.gob.ar/rss/primera", name: "Boletín Oficial" },
  { url: "https://www.ambito.com/rss/pages/economia.xml", name: "Ámbito Economía" },
  { url: "https://www.infobae.com/feeds/rss/economia/", name: "Infobae Economía" },
];

/** Ticker ADR -> keywords que lo identifican en prensa. */
export const DEFAULT_AR_COMPANIES: Record<string, string[]> = {
  YPF: ["ypf"],
  VIST: ["vista energy", "vista oil"],
  PAM: ["pampa energía", "pampa energia"],
  GGAL: ["galicia", "grupo financiero galicia"],
};

export const DEFAULT_MACRO_KEYWORDS = [
  "bcra", "cepo", "dólar", "dolar", "riesgo país", "riesgo pais", "fmi", "licitación", "licitacion",
  "decreto", "vaca muerta", "retenciones", "tarifas", "indec", "inflación", "inflacion", "reservas", "canje", "bonos",
];

const DATE_IN_TITLE = /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\b/i;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export interface ArOptions {
  http: HttpClient;
  feeds?: ArFeed[];
  companies?: Record<string, string[]>;
  macroKeywords?: string[];
  /** Ticker "sintético" para eventos macro que afectan a todo el portfolio AR. */
  macroTicker?: string;
}

export class ArRssIngestor implements Ingestor {
  readonly source = "ar_official" as const;
  private readonly parser = new XMLParser({ ignoreAttributes: false });

  constructor(private readonly opts: ArOptions) {}

  async fetch(since: string): Promise<RawEvent[]> {
    const feeds = this.opts.feeds ?? DEFAULT_AR_FEEDS;
    const companies = this.opts.companies ?? DEFAULT_AR_COMPANIES;
    const macro = (this.opts.macroKeywords ?? DEFAULT_MACRO_KEYWORDS).map((k) => k.toLowerCase());
    const sinceMs = Date.parse(since);
    const out: RawEvent[] = [];
    for (const feed of feeds) {
      let xml: string;
      try {
        xml = await this.opts.http.getText(feed.url);
      } catch {
        continue;
      }
      for (const item of parseRssItems(this.parser, xml)) {
        if (item.pubDate && Date.parse(item.pubDate) < sinceMs) continue;
        const text = `${item.title} ${item.description}`.toLowerCase();
        const matchedCompanies = Object.entries(companies).filter(([, kws]) => kws.some((k) => text.includes(k)));
        const isMacro = macro.some((k) => text.includes(k));
        if (!matchedCompanies.length && !isMacro) continue;
        const eventDate = extractDate(item.title, since);
        const base = {
          source: "ar_official" as const,
          eventDate,
          sourceRef: item.link || `${feed.name}:${item.title}`,
          title: `[${feed.name}] ${item.title}`,
          payload: { description: item.description, link: item.link, pubDate: item.pubDate, feed: feed.name },
        };
        for (const [ticker] of matchedCompanies) out.push(newEvent({ ...base, ticker, eventType: "operational" }));
        if (isMacro && !matchedCompanies.length) out.push(newEvent({ ...base, ticker: this.opts.macroTicker ?? "ARG", eventType: "macro_ar" }));
      }
    }
    return out;
  }
}

export interface RssItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

export function parseRssItems(parser: XMLParser, xml: string): RssItem[] {
  const doc = parser.parse(xml) as { rss?: { channel?: { item?: unknown } }; feed?: { entry?: unknown } };
  const raw = doc.rss?.channel?.item ?? doc.feed?.entry ?? [];
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr.map((i) => {
    const it = i as Record<string, unknown>;
    const linkVal = it["link"];
    const link = typeof linkVal === "string" ? linkVal : ((linkVal as Record<string, string> | undefined)?.["@_href"] ?? "");
    return {
      title: String(it["title"] ?? "").trim(),
      description: String(it["description"] ?? it["summary"] ?? "").trim(),
      link,
      pubDate: String(it["pubDate"] ?? it["published"] ?? it["updated"] ?? ""),
    };
  });
}

/** "licitación del 15 de octubre" -> 2026-10-15 (año: el del `since`, o el siguiente si ya pasó). */
export function extractDate(title: string, sinceIso: string): string | null {
  const m = DATE_IN_TITLE.exec(title);
  if (!m) return null;
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
  const year = Number(sinceIso.slice(0, 4));
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return iso < sinceIso.slice(0, 10) ? `${year + 1}${iso.slice(4)}` : iso;
}
