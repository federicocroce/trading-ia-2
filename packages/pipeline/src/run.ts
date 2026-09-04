import { impliedProbability, type Filter, type Ingestor, type MarketData, type RawEvent, type Reasoner, type Thesis, type ThesisProposal } from "@thesis/core";
import type { BundleWithMarket } from "@thesis/reasoner";
import type { DocumentProvider } from "./documents.js";
import type { Store } from "./store.js";

export interface RunDeps {
  store: Store;
  ingestors: Ingestor[];
  filter: Filter;
  reasoner: Reasoner;
  documents: DocumentProvider;
  marketData: MarketData;
  minEdge: number;
  maxCandidates: number;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

export interface RunSummary {
  ingested: number;
  newEvents: number;
  passed: number;
  dropped: number;
  proposed: Thesis[];
  rejected: Thesis[];
  errors: Array<{ eventId: string; error: string }>;
}

/** Ingesta → filtro → razonamiento → persistencia. Una corrida = un día. */
export async function dailyRun(deps: RunDeps, opts: { since: string; today: string }): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const summary: RunSummary = { ingested: 0, newEvents: 0, passed: 0, dropped: 0, proposed: [], rejected: [], errors: [] };

  // 1. Ingesta
  for (const ing of deps.ingestors) {
    let evs: RawEvent[] = [];
    try {
      evs = await ing.fetch(opts.since);
    } catch (e) {
      log(`ingest ${ing.source} failed`, { error: String(e) });
      continue;
    }
    summary.ingested += evs.length;
    const fresh = await deps.store.insertRawEvents(evs);
    summary.newEvents += fresh.length;
    log(`ingest ${ing.source}`, { fetched: evs.length, new: fresh.length });
  }

  // 2. Filtro sobre todo lo no evaluado (incluye lo de corridas anteriores)
  const pending = await deps.store.unfilteredEvents();
  const { passed, dropped } = await deps.filter.apply(pending, { today: opts.today, maxCandidates: deps.maxCandidates });
  await deps.store.markFilter([
    ...passed.map((e) => ({ id: e.id, passed: true, reason: null })),
    ...dropped.filter((d) => d.reason !== "budget exceeded").map((d) => ({ id: d.event.id, passed: false, reason: d.reason })),
    // "budget exceeded" queda sin evaluar: entra mañana.
  ]);
  summary.passed = passed.length;
  summary.dropped = dropped.length;

  // 3. Razonamiento
  await deps.store.ensurePromptVersion(deps.reasoner.promptVersion, "see @thesis/reasoner");
  for (const event of passed) {
    try {
      const bundle = await buildBundle(event, deps);
      const proposal = enforceMarketProbability(await deps.reasoner.propose(bundle), bundle);
      const thesis = await deps.store.insertThesis(event.id, proposal, deps.reasoner.promptVersion, deps.minEdge);
      (thesis.status === "proposed" ? summary.proposed : summary.rejected).push(thesis);
      log(`thesis ${thesis.status}`, { ticker: thesis.ticker, edge: thesis.edge });
    } catch (e) {
      summary.errors.push({ eventId: event.id, error: String(e) });
      log(`reason failed`, { eventId: event.id, error: String(e) });
    }
  }
  return summary;
}

export async function buildBundle(event: RawEvent, deps: Pick<RunDeps, "documents" | "marketData" | "store">): Promise<BundleWithMarket> {
  const documents = await deps.documents.documentsFor(event);
  const comparables = await deps.store.comparables(event.eventType);
  let spot: number | null = null;
  let impliedMove = null;
  if (event.ticker !== "ARG") {
    const q = await deps.marketData.getQuote(event.ticker).catch(() => null);
    spot = q?.price ?? null;
    if (event.eventDate) impliedMove = await deps.marketData.getImpliedMove(event.ticker, event.eventDate).catch(() => null);
  }
  return { event, documents, comparables, market: { spot, impliedMove } };
}

/**
 * pMarket lo fija el sistema desde opciones cuando existen, no el LLM (auditable).
 * Se aplica acá, en el pipeline, para que valga con cualquier Reasoner.
 */
export function enforceMarketProbability(p: ThesisProposal, bundle: BundleWithMarket): ThesisProposal {
  const im = bundle.market?.impliedMove;
  if (!im || bundle.event.eventType === "macro_ar") return p;
  const pm = impliedProbability({ spot: im.spot, target: p.target, impliedMovePct: im.impliedMovePct, direction: p.direction });
  return Number.isFinite(pm) ? { ...p, pMarket: Number(pm.toFixed(4)) } : p;
}
