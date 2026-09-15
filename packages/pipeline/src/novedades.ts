import type { CandidateRow, NewsItem, Thesis, VerdictRow } from "@thesis/core";
import type { CarteraStore, RadarStore, Store, TickerStore } from "./store.js";

/**
 * Novedades del día: qué cambió contra la corrida anterior, para leer a la mañana en un minuto.
 * Solo compara lo que ya está en la base (veredictos, candidatos, seguimiento, tesis, noticias); no pide nada afuera.
 */
export interface Novedades {
  /** Fecha de la última corrida de Cartera/Radar y la anterior con la que se compara. */
  date: string | null;
  previousDate: string | null;
  verdictChanges: Array<{ symbol: string; from: VerdictRow["verb"]; to: VerdictRow["verb"]; reason: string }>;
  /** VENDER y REVISAR vigentes: lo que pide acción hoy. */
  alerts: Array<{ symbol: string; verb: VerdictRow["verb"]; reason: string }>;
  /** `held`: ya la tenés (15/9: TSM entraba como "nueva en el Radar" sin decirlo). */
  enteredBuy: Array<{ symbol: string; kind: CandidateRow["kind"]; score: number | null; held: boolean }>;
  leftBuy: Array<{ symbol: string; kind: CandidateRow["kind"]; now: string }>;
  watchResolved: Array<{ symbol: string; status: string; returnPct: number | null }>;
  proposedTheses: Array<{ id: string; ticker: string; eventType: Thesis["eventType"]; direction: Thesis["direction"]; edge: number; summary: string }>;
  /** Noticias de hoy y ayer solo de lo tuyo: posiciones y líneas del plan vigente. */
  news: NewsItem[];
  empty: boolean;
}

/** Ventana de "qué cambió": una resolución más vieja que esto ya no es novedad. */
export const NOVEDAD_DIAS = 2;

/** Corta sin partir un número al medio: "incremento del 11" mostraba otra cifra que la real (11,36%). */
function recortar(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const corte = texto.slice(0, max);
  const limpio = corte.replace(/[\s.,]*[\d.,]*$/, "");
  return `${(limpio.length > max * 0.6 ? limpio : corte).trimEnd()}…`;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);
/** Las familias del plan en dólares. Cada una se compara contra SU corrida anterior: el seguimiento se refresca aparte. */
const FAMILIAS_US: Array<CandidateRow["kind"]> = ["stock", "etf", "watch"];

export async function buildNovedades(store: Store & CarteraStore & RadarStore & TickerStore, opts: { today: string; at?: string | null }): Promise<Novedades> {
  // Histórico: "hoy" es la corrida pedida y se compara con la anterior a esa fecha.
  const cut = opts.at ?? null;
  // Veredictos: última fecha (≤ la pedida) y la anterior.
  const verdicts = (await store.allVerdicts()).filter((v) => !cut || v.verdictDate <= cut);
  const vDates = [...new Set(verdicts.map((v) => v.verdictDate))].sort();
  const vLast = vDates.at(-1) ?? null;
  const vPrev = vDates.at(-2) ?? null;
  const todayV = verdicts.filter((v) => v.verdictDate === vLast);
  const prevV = new Map(verdicts.filter((v) => v.verdictDate === vPrev).map((v) => [v.symbol, v]));
  const verdictChanges = todayV
    .filter((v) => prevV.has(v.symbol) && prevV.get(v.symbol)!.verb !== v.verb)
    .map((v) => ({ symbol: v.symbol, from: prevV.get(v.symbol)!.verb, to: v.verb, reason: v.reason }))
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
  const alerts = todayV.filter((v) => v.verb === "VENDER" || v.verb === "REVISAR").map((v) => ({ symbol: v.symbol, verb: v.verb, reason: v.reason }));

  // Candidatos US: COMPRAR que entran y salen, cada familia contra SU corrida anterior (15/9). Con una sola serie de
  // fechas el seguimiento, que se refresca aparte, no aparecía nunca, y un refresco suyo dejaba a las acciones sin
  // corrida con qué compararse. Lo que ya tenés se marca.
  const todas = (await store.allCandidates()).filter((c) => FAMILIAS_US.includes(c.kind) && (!cut || c.candidateDate <= cut));
  const tenidas = new Set((await store.positions()).map((p) => p.symbol.toUpperCase()));
  // Por símbolo, no por fila (15/9): un símbolo puede cambiar de familia. APH pasó del seguimiento al ranking y figuraba
  // a la vez como "nueva en el Radar" y como "deja de pasar los filtros". Hoy = la última corrida de cada familia; antes
  // = la fila más reciente del símbolo anterior a la de hoy, sea de la familia que sea.
  const hoyC: CandidateRow[] = [];
  const conPrevia = new Set<CandidateRow["kind"]>();
  const previasC: CandidateRow[] = [];
  let cLast: string | null = null;
  let cPrev: string | null = null;
  for (const familia of FAMILIAS_US) {
    const cands = todas.filter((c) => c.kind === familia);
    const fechas = [...new Set(cands.map((c) => c.candidateDate))].sort();
    const ultima = fechas.at(-1) ?? null;
    const previa = fechas.at(-2) ?? null;
    // El encabezado dice la corrida del ranking (acciones, la primera familia), que es la del día.
    if (cLast === null && ultima) { cLast = ultima; cPrev = previa; }
    hoyC.push(...cands.filter((c) => c.candidateDate === ultima));
    if (previa) { conPrevia.add(familia); previasC.push(...cands.filter((c) => c.candidateDate === previa)); }
  }
  /** ¿Estaba en COMPRAR en su última aparición anterior a `fecha`? null = nunca apareció antes. */
  const comprabaAntes = (sym: string, fecha: string): boolean | null => {
    const antes = todas.filter((c) => c.symbol === sym && c.candidateDate < fecha);
    const ultima = antes.reduce((m, c) => (c.candidateDate > m ? c.candidateDate : m), "");
    return ultima ? antes.some((c) => c.candidateDate === ultima && c.verdict === "COMPRAR") : null;
  };
  const compraHoy = new Set(hoyC.filter((c) => c.verdict === "COMPRAR").map((c) => c.symbol));
  const enteredBuy: Novedades["enteredBuy"] = [];
  for (const c of hoyC) {
    if (c.verdict !== "COMPRAR" || enteredBuy.some((x) => x.symbol === c.symbol)) continue;
    const antes = comprabaAntes(c.symbol, c.candidateDate);
    // Sin corrida anterior en su familia ni aparición previa, es la primera corrida: no hay contra qué comparar.
    if (antes === true || (antes === null && !conPrevia.has(c.kind))) continue;
    enteredBuy.push({ symbol: c.symbol, kind: c.kind, score: c.score, held: tenidas.has(c.symbol.toUpperCase()) });
  }
  enteredBuy.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));
  const leftBuy: Novedades["leftBuy"] = [];
  for (const p of previasC) {
    if (p.verdict !== "COMPRAR" || compraHoy.has(p.symbol) || leftBuy.some((x) => x.symbol === p.symbol)) continue;
    leftBuy.push({ symbol: p.symbol, kind: p.kind, now: hoyC.find((c) => c.symbol === p.symbol)?.verdict ?? "fuera" });
  }

  // Seguimiento resuelto (pide revisión). Solo lo resuelto en la ventana de esta corrida: sin filtro de
  // fecha, una resolución de hace tres días seguía apareciendo como novedad para siempre, y en modo
  // histórico se mostraban resoluciones posteriores a la fecha elegida.
  const hasta = cut ?? opts.today;
  const desdeNovedad = addDays(hasta, -NOVEDAD_DIAS);
  const watchResolved = (await store.watchlist())
    .filter((w) => w.status !== "live")
    .filter((w) => {
      const cuando = (w.resolvedAt ?? w.lastEvaluatedAt ?? "").slice(0, 10);
      return cuando ? cuando > desdeNovedad && cuando <= hasta : false;
    })
    .map((w) => ({ symbol: w.symbol, status: w.status, returnPct: w.resolutionReturn ?? w.lastReturn, date: (w.resolvedAt ?? w.lastEvaluatedAt ?? "").slice(0, 10) }));

  // Tesis propuestas esperando decisión, creadas hasta la fecha de la corrida (en histórico no se adelanta).
  const proposedTheses = (await store.thesesByStatus("proposed"))
    // Solo en modo histórico: mirando una corrida vieja no se pueden mostrar tesis creadas después.
    .filter((t) => !cut || t.createdAt.slice(0, 10) <= cut)
    .map((t) => ({ id: t.id, ticker: t.ticker, eventType: t.eventType, direction: t.direction, edge: t.edge, pMarketFromOptions: t.pMarketFromOptions ?? false, summary: recortar(t.reasoning, 160) }))
    .sort((a, b) => b.edge - a.edge);

  // Noticias de lo tuyo: posiciones + líneas del plan, de hoy y ayer.
  const mine = new Set<string>([...(await store.positions()).map((p) => p.symbol), ...((await store.latestPlan())?.lines.map((l) => l.symbol) ?? [])]);
  const since = addDays(cut ?? opts.today, -1);
  const until = cut ?? opts.today;
  const news: NewsItem[] = [];
  for (const sym of [...mine].sort()) news.push(...(await store.news(sym, 5)).filter((n) => n.date >= since && n.date <= until));

  const date = vLast && cLast ? (vLast > cLast ? vLast : cLast) : vLast ?? cLast;
  const previousDate = vPrev ?? cPrev;
  const empty = !verdictChanges.length && !alerts.length && !enteredBuy.length && !leftBuy.length && !watchResolved.length && !proposedTheses.length && !news.length;
  return { date, previousDate, verdictChanges, alerts, enteredBuy, leftBuy, watchResolved, proposedTheses, news, empty };
}
