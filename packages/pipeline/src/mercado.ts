import { decideCandidate, rankStocks, type Candle, type CandidateDecision, type CoreEarnings, type EntryTiming, type Fundamentals } from "@thesis/core";
import { candlesFor, heldSymbols, universoDelRanking, withStatements, type RadarDeps } from "./radar.js";

/**
 * El embudo del mercado (`/mercado`, 16/9): las MISMAS reglas de la app sobre todo el universo, no sobre las 40 filas
 * que muestra el Radar.
 *
 * Por qué acá y no en `rankRadar`: el ranking escribe el Radar y rearma el plan, así que no se puede correr con el
 * mercado abierto ni con un universo más ancho sin cambiar lo que el dueño ve. Esto es de SOLO LECTURA sobre el Radar
 * (guarda velas y estados, que son caché) y devuelve el embudo entero con el motivo de cada caída.
 *
 * Las reglas no se copian: son las funciones del núcleo (`rankStocks` para el puntaje contra pares, `decideCandidate`
 * para el filtro técnico, los niveles y el tamaño). Una sola vara, o serían dos apps diciendo cosas distintas.
 */
export interface FilaMercado {
  symbol: string;
  /** Puntaje contra pares y posición en el grupo; null si el símbolo no está en el universo del barrido. */
  score: number | null;
  rankInGroup: number | null;
  groupSize: number | null;
  peerGroup: string[];
  industry: string | null;
  verdict: CandidateDecision["verdict"];
  flags: string[];
  close: number;
  entryLow: number | null;
  entryHigh: number;
  stop: number | null;
  target: number | null;
  sizeUsd: number | null;
  sizeQty: number | null;
  riskScore: number | null;
  entry: EntryTiming | null;
  /** Ya está en cartera (su stop es el de la posición) o ya está en el Radar de hoy. */
  enCartera: boolean;
  enElRadar: boolean;
}

export interface EmbudoMercado {
  today: string;
  universo: { barrido: number; conFundamentales: number };
  rankeadas: number;
  preseleccionadas: number;
  conVelas: number;
  /** Las que pasaron el filtro técnico, ordenadas por puntaje contra pares. */
  filas: FilaMercado[];
  /** Cada exclusión con su etapa y su motivo: la regla de la casa es que nada cae sin explicación. */
  descartadas: Array<{ symbol: string; etapa: "ranking" | "velas" | "tecnica"; motivo: string }>;
}

/** Fundamentales mínimas para evaluar un símbolo fuera del universo: solo técnica, sin puntaje contra pares. */
const sinFundamentales = (symbol: string, close: number): Fundamentals => ({
  symbol, asOf: "", metrics: {}, peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 0, priceUsd: close,
  nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null,
});

export async function explorarMercado(
  deps: RadarDeps,
  opts: { today: string; portfolioUsd: number | null; preselect?: number; top?: number; symbols?: string[]; conEstados?: boolean },
): Promise<EmbudoMercado> {
  const { store, policy } = deps;
  const { all, scanOk } = await universoDelRanking(deps, opts.today);
  const held = await heldSymbols(store);
  const enRadar = new Set((await store.latestCandidates().catch(() => [])).filter((r) => r.candidateDate === opts.today).map((r) => r.symbol.toUpperCase()));
  const descartadas: EmbudoMercado["descartadas"] = [];

  // Puntaje contra pares: puro y barato, sobre el universo entero.
  const { ranked, skipped } = rankStocks(all, policy.weights);
  const porSimbolo = new Map(ranked.map((r) => [r.symbol, r]));
  const pedidos = opts.symbols?.map((s) => s.toUpperCase());
  if (!pedidos) for (const s of skipped) descartadas.push({ symbol: s.symbol, etapa: "ranking", motivo: s.reason });

  const preselect = opts.preselect ?? policy.candidates.preselect;
  const lista = pedidos ?? ranked.slice(0, preselect).map((r) => r.symbol);

  // Estados de la SEC (ganancia núcleo) para lo preseleccionado y sus pares, igual que el ranking del Radar. En la
  // pasada ancha se pueden saltear (`conEstados: false`): pedirlos para 600 símbolos y sus pares son miles de pedidos
  // para elegir a quién mirar, y el puntaje ya sale de las métricas guardadas (las corridas previas las dejaron con la
  // ganancia núcleo aplicada). La pasada angosta, sobre los finalistas, sí los pide.
  const conEstados = opts.conEstados ?? true;
  const cores = conEstados ? await withStatements(deps, all, lista.flatMap((s) => [s, ...(porSimbolo.get(s)?.group ?? [])]), opts.today) : new Map<string, CoreEarnings | null>();
  const coreOf = (sym: string): CoreEarnings | null | undefined => (deps.statements && conEstados ? (cores.get(sym) ?? null) : undefined);

  const { candles, errors } = await candlesFor(deps, lista);
  for (const e of errors) descartadas.push({ symbol: e.symbol, etapa: "velas", motivo: `sin velas: ${e.error.slice(0, 120)}` });

  const filas: FilaMercado[] = [];
  let conVelas = 0;
  for (const sym of lista) {
    const c: Candle[] | undefined = candles[sym];
    if (!c || !c.length) {
      if (!errors.some((e) => e.symbol === sym)) descartadas.push({ symbol: sym, etapa: "velas", motivo: "sin velas: la fuente no devolvió precios" });
      continue;
    }
    conVelas++;
    const r = porSimbolo.get(sym);
    const f = all.get(sym) ?? (await store.fundamentals(sym).catch(() => null)) ?? sinFundamentales(sym, c[c.length - 1]!.close);
    const core = coreOf(sym);
    const d = decideCandidate({ f, candles: c, nthAppearance: 1, portfolioUsd: opts.portfolioUsd, today: opts.today, held: held.has(sym), ...(core !== undefined ? { core } : {}) }, policy);
    if ("excluded" in d) {
      descartadas.push({ symbol: sym, etapa: "tecnica", motivo: d.reasons.join(", ") });
      continue;
    }
    filas.push({
      symbol: sym,
      score: r?.score ?? null,
      rankInGroup: r?.rankInGroup ?? null,
      groupSize: r?.groupSize ?? null,
      peerGroup: r?.group ?? [],
      industry: f.industry,
      verdict: d.verdict,
      flags: d.flags,
      close: d.close,
      entryLow: d.entryLow,
      entryHigh: d.entryHigh,
      stop: d.stop,
      target: d.target,
      sizeUsd: d.size?.sizeUsd ?? null,
      sizeQty: d.size?.qty ?? null,
      riskScore: d.riskScore,
      entry: d.entry ?? null,
      enCartera: held.has(sym),
      enElRadar: enRadar.has(sym),
    });
  }
  filas.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const top = opts.top ?? filas.length;
  return {
    today: opts.today,
    universo: { barrido: scanOk, conFundamentales: all.size },
    rankeadas: ranked.length,
    preseleccionadas: lista.length,
    conVelas,
    filas: filas.slice(0, top),
    descartadas,
  };
}
