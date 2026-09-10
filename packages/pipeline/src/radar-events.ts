import { analystTargets, materialHeadlines, parseAnalystAction, type AnalystAction, type AnalystTargets, type CandidateEvent, type EventClassifier, type NewsItem, type RadarEvent } from "@thesis/core";
import type { RadarStore, TickerStore } from "./store.js";

/**
 * Eventos materiales y analistas desde noticias (spec verificación §5 y §6).
 * Noticias de Finnhub → prefiltro por reglas → analistas por regex → clasificador (modelo, solo lo nuevo) → eventos guardados.
 * Lo que el modelo no devuelve se guarda como `ruido` para no volver a mandarlo cada día. Si el modelo o las noticias
 * fallan, el barrido no avanza y el candidato lleva la bandera `eventos_sin_clasificar` hasta el próximo intento.
 */
export interface EventsDeps {
  store: RadarStore & Pick<TickerStore, "upsertNews">;
  news: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> };
  classifier: EventClassifier | null;
  log?: (msg: string, extra?: unknown) => void;
}
export interface EventScan {
  events: CandidateEvent[];
  analystTargets: AnalystTargets | null;
  unclassified: boolean;
}
export const EVENT_WINDOW_DAYS = 90;
const MAX_ITEMS_PER_CALL = 30;
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

export async function scanEventsFor(deps: EventsDeps, symbol: string, opts: { today: string; name: string | null; full?: boolean }): Promise<EventScan> {
  const { store } = deps;
  const sym = symbol.toUpperCase();
  const since = addDays(opts.today, -EVENT_WINDOW_DAYS);
  const scannedTo = opts.full ? null : await store.newsScannedTo(sym);
  const from = scannedTo && scannedTo > since ? scannedTo : since;
  let fetched = true;
  let items: NewsItem[] = [];
  try {
    items = (await deps.news.companyNews(sym, from, opts.today)).map((n) => ({ ...n, symbol: sym }));
  } catch (e) {
    fetched = false;
    deps.log?.(`[radar] noticias de ${sym} fallaron`, { error: String(e).slice(0, 120) });
  }
  if (items.length) await store.upsertNews(items);
  const matched = materialHeadlines(items);
  const actions = matched.filter((m) => m.kind === "analista").map((m) => parseAnalystAction(m.item)).filter((a): a is AnalystAction => a !== null);
  if (actions.length) await store.upsertAnalystActions(actions);
  const known = new Set((await store.eventsFor(sym, since)).map((e) => e.url));
  const toClassify = matched.filter((m) => m.kind !== "analista" && !known.has(m.item.url)).slice(0, MAX_ITEMS_PER_CALL);
  let unclassified = false;
  if (toClassify.length) {
    if (!deps.classifier) unclassified = true;
    else {
      try {
        const classified = await deps.classifier.classify({ symbol: sym, name: opts.name, items: toClassify.map((m) => ({ date: m.item.date, source: m.item.source, headline: m.item.headline, summary: m.item.summary, url: m.item.url, kind: m.kind })) });
        const now = new Date().toISOString();
        const version = deps.classifier.promptVersion;
        const events: RadarEvent[] = classified.map((c) => ({ symbol: sym, date: c.date, kind: c.kind, severity: c.severity, headline: c.headline, url: c.url, source: c.source, why: c.why, detectedAt: now, promptVersion: version }));
        const returned = new Set(events.map((e) => e.url));
        for (const m of toClassify) if (!returned.has(m.item.url)) events.push({ symbol: sym, date: m.item.date, kind: m.kind, severity: "ruido", headline: m.item.headline, url: m.item.url, source: m.item.source, why: null, detectedAt: now, promptVersion: version });
        await store.upsertEvents(events);
      } catch (e) {
        unclassified = true;
        deps.log?.(`[radar] clasificador de titulares falló para ${sym}`, { error: String(e).slice(0, 120) });
      }
    }
  }
  if (fetched && !unclassified) await store.setNewsScannedTo(sym, opts.today);
  const events = (await store.eventsFor(sym, since)).filter((e) => e.severity !== "ruido").map((e) => ({ date: e.date, kind: e.kind, severity: e.severity, headline: e.headline }));
  return { events, analystTargets: analystTargets(await store.analystActions(sym, since), opts.today), unclassified };
}
