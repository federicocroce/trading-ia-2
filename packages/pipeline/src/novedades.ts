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
  enteredBuy: Array<{ symbol: string; kind: CandidateRow["kind"]; score: number | null }>;
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
const isUs = (c: CandidateRow) => c.kind === "stock" || c.kind === "etf";

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

  // Candidatos US: COMPRAR que entran y salen contra la fecha anterior.
  const cands = (await store.allCandidates()).filter((c) => isUs(c) && (!cut || c.candidateDate <= cut));
  const cDates = [...new Set(cands.map((c) => c.candidateDate))].sort();
  const cLast = cDates.at(-1) ?? null;
  const cPrev = cDates.at(-2) ?? null;
  const todayC = cands.filter((c) => c.candidateDate === cLast);
  const prevC = new Map(cands.filter((c) => c.candidateDate === cPrev).map((c) => [c.symbol, c]));
  const enteredBuy = cPrev ? todayC.filter((c) => c.verdict === "COMPRAR" && prevC.get(c.symbol)?.verdict !== "COMPRAR").map((c) => ({ symbol: c.symbol, kind: c.kind, score: c.score })).sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)) : [];
  const leftBuy = cPrev ? [...prevC.values()].filter((p) => p.verdict === "COMPRAR" && todayC.find((c) => c.symbol === p.symbol)?.verdict !== "COMPRAR").map((p) => ({ symbol: p.symbol, kind: p.kind, now: todayC.find((c) => c.symbol === p.symbol)?.verdict ?? "fuera" })) : [];

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
