import { impliedProbability, type Filter, type Ingestor, type MarketData, type RawEvent, type Reasoner, type Thesis, type ThesisProposal } from "@thesis/core";
import type { BundleWithMarket } from "@thesis/reasoner";
import type { DocumentProvider } from "./documents.js";
import type { Store } from "./store.js";
import { retirarReemplazadas } from "./theses.js";

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
  /** Propuestas retiradas porque el mismo evento tiene una lectura más nueva (15/9): una tesis viva por evento. */
  reemplazadas: Array<{ id: string; ticker: string; por: string }>;
  errors: Array<{ eventId: string; error: string }>;
}

/**
 * Cuántos días hacia atrás mira la corrida de tesis (13/9/2026). Una sola constante: hasta hoy el cron y
 * "ponerse al día" miraban 3 días y el botón manual y la línea de comandos 7, así que el mismo trabajo cubría
 * distinto según quién lo disparara.
 *
 * Por qué 30. Los COMPRAR del Radar entraron al universo de tesis el 11/9, y con 3 días nunca se miró hacia
 * atrás: APH, NBN, LNC y V tenían cero eventos. Ampliar solo es seguro porque (a) la base ya deduplica los
 * eventos sin fecha (migración 0020; antes cada corrida re-guardaba todo lo de su ventana) y (b) el ingestor
 * de la SEC saltea lo que ya conoce antes de bajar nada. En régimen, 30 días cuestan lo mismo que 3: solo lo
 * nuevo llega al filtro y al modelo.
 */
export const TESIS_VENTANA_DIAS = 30;
export const tesisSince = (now = Date.now()) => new Date(now - TESIS_VENTANA_DIAS * 86_400_000).toISOString();

/** Ingesta → filtro → razonamiento → persistencia. Una corrida = un día. */
export async function dailyRun(deps: RunDeps, opts: { since: string; today: string }): Promise<RunSummary> {
  const log = deps.log ?? (() => {});
  const summary: RunSummary = { ingested: 0, newEvents: 0, passed: 0, dropped: 0, proposed: [], rejected: [], reemplazadas: [], errors: [] };

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
  // Los descartados se marcan ya. Los que pasan se marcan recién cuando hay tesis: si el
  // razonador falla (cuota, 503, red) el evento queda pendiente y entra en la corrida siguiente.
  // "budget exceeded" también queda sin evaluar: entra mañana.
  await deps.store.markFilter(
    dropped.filter((d) => d.reason !== "budget exceeded").map((d) => ({ id: d.event.id, passed: false, reason: d.reason })),
  );
  summary.passed = passed.length;
  summary.dropped = dropped.length;

  // 3. Razonamiento
  await deps.store.ensurePromptVersion(deps.reasoner.promptVersion, "see @thesis/reasoner");
  for (const event of passed) {
    try {
      const bundle = await buildBundle(event, deps);
      const proposal = enforceMarketProbability(await deps.reasoner.propose(bundle), bundle);
      const thesis = await deps.store.insertThesis(event.id, proposal, deps.reasoner.promptVersion, deps.minEdge);
      await deps.store.markFilter([{ id: event.id, passed: true, reason: null }]);
      (thesis.status === "proposed" ? summary.proposed : summary.rejected).push(thesis);
      log(`thesis ${thesis.status}`, { ticker: thesis.ticker, edge: thesis.edge });
    } catch (e) {
      summary.errors.push({ eventId: event.id, error: String(e) });
      log(`reason failed`, { eventId: event.id, error: String(e) });
    }
  }

  // 4. Una tesis viva por evento (15/9): lo que el mismo evento ya tenía propuesto queda reemplazado por la lectura más
  //    nueva. El 15/9 el 6-K de Vista tenía cinco propuestas vivas con objetivos de 82 a 88. Idempotente: también
  //    limpia lo que quedó de antes.
  summary.reemplazadas = await retirarReemplazadas(deps.store);
  if (summary.reemplazadas.length) log("theses superseded", { n: summary.reemplazadas.length, tickers: summary.reemplazadas.map((r) => r.ticker) });
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
export function enforceMarketProbability(p: ThesisProposal, bundle: BundleWithMarket): ThesisProposal & { pMarketFromOptions: boolean } {
  const im = bundle.market?.impliedMove;
  // Queda registrado de dónde salió pMarket. Si no hay cadena de opciones lo estima el modelo, y en ese caso
  // el edge (pEstimate − pMarket) no mide una diferencia contra el mercado: mide contra una suposición.
  if (!im || bundle.event.eventType === "macro_ar") return { ...p, pMarketFromOptions: false };
  const pm = impliedProbability({ spot: im.spot, target: p.target, impliedMovePct: im.impliedMovePct, direction: p.direction });
  return Number.isFinite(pm) ? { ...p, pMarket: Number(pm.toFixed(4)), pMarketFromOptions: true } : { ...p, pMarketFromOptions: false };
}
