import type { Candle, Finding, LivePriceSample, LiveQuote } from "@thesis/core";
import { actedOnSymbols, checkConsistency, lastCompletedSession, marketOf, quoteIsStale, summarizeFindings } from "@thesis/core";
import type { RadarDeps } from "./radar.js";

/**
 * Corre el chequeo de consistencia sobre lo que la app acaba de guardar (ver core/radar/consistency.ts).
 * Va al final de cada corrida: si la salida se contradice con sus propias fuentes, se entera la app, no el dueño.
 */
const DAY = 86_400_000;

export interface ConsistencyReport {
  date: string;
  findings: Finding[];
  graves: number;
  avisos: number;
}

/**
 * De dónde salen los precios de `precio_vivo`: lo que sirve el hub y un testigo independiente (Yahoo, un pedido por
 * símbolo). Sin esto el chequeo no corre: los tests y los procesos que no tienen red no lo necesitan.
 */
export interface LivePriceSources {
  /** `stale` es la marca que ya ve la pantalla (la foto del hub); sin ella se calcula igual que la pantalla. */
  hub(symbols: string[]): Promise<Array<LiveQuote & { stale?: boolean }>>;
  witness(symbol: string): Promise<LiveQuote | null>;
}

/**
 * Arma las muestras de `precio_vivo`. Una fuente que falla no se traga el chequeo: el símbolo queda con ese lado en
 * null y core lo reporta como aviso (sin hub, sin testigo), nunca como verificado. Yahoo va de a un pedido por
 * símbolo, en serie: el cliente HTTP ya espacia los pedidos al mismo host y son unas decenas de símbolos.
 */
export async function sampleLivePrices(src: LivePriceSources, symbols: string[], at: Date): Promise<LivePriceSample[]> {
  const hub = new Map((await src.hub(symbols).catch(() => [] as Array<LiveQuote & { stale?: boolean }>)).map((q) => [q.symbol.toUpperCase(), q]));
  const out: LivePriceSample[] = [];
  for (const symbol of symbols) {
    const w = await src.witness(symbol).catch(() => null);
    const h = hub.get(symbol) ?? null;
    out.push({ symbol, hub: h ? { price: h.price, asOf: h.asOf, stale: h.stale ?? quoteIsStale(h.asOf, at, marketOf(symbol)) } : null, witness: w && Number.isFinite(w.price) ? { price: w.price, asOf: w.asOf } : null });
  }
  return out;
}

export async function checkRun(deps: Pick<RadarDeps, "store" | "log"> & { livePrices?: LivePriceSources | null }, opts: { today: string; now?: () => Date }): Promise<ConsistencyReport> {
  const rows = await deps.store.latestCandidates();
  const plan = await deps.store.latestPlan().catch(() => null);
  // Hasta dónde TENÍAN que llegar las velas. Sale del calendario, no de lo guardado: es el único testigo de
  // afuera que tiene el chequeo (23/9, ver `velas_desfasadas`). Se ancla a CUÁNDO SE ARMÓ la corrida, no a
  // "ahora": entre el cierre de EE.UU. y el refresco de la mañana siguiente las velas están legítimamente una
  // rueda atrás, y un control que grita todas las tardes con datos correctos enseña a ignorar los graves.
  const armadoEn = plan?.builtAt ? new Date(plan.builtAt) : (opts.now ?? (() => new Date()))();
  const lastSession = lastCompletedSession(armadoEn);
  // Solo las últimas ruedas: alcanza para comparar el cierre guardado contra el último cierre real.
  const desde = new Date(Date.parse(opts.today) - 10 * DAY).toISOString().slice(0, 10);
  const candles: Record<string, Candle[]> = {};
  for (const r of rows) {
    // Las filas argentinas cotizan en pesos y no comparten la serie con el resto: se saltean.
    if (r.kind === "ar" || r.kind === "cedear") continue;
    const c = await deps.store.candles(r.symbol, desde).catch(() => [] as Candle[]);
    if (c.length) candles[r.symbol] = c;
  }
  // Métricas de Finnhub por símbolo: sin esto no se pueden ver los fundamentales que se contradicen solos.
  const metrics: Record<string, Record<string, number | null | undefined>> = {};
  const mcaps: Record<string, number | null> = {};
  const industries: Record<string, string | null> = {};
  for (const r of rows) {
    const f = await deps.store.fundamentals(r.symbol).catch(() => null);
    if (f) {
      metrics[r.symbol] = f.metrics;
      mcaps[r.symbol] = f.mcapUsd;
      industries[r.symbol] = f.industry;
    }
  }
  // Hasta qué fecha se leyeron las noticias de cada símbolo: es lo que separa "no hubo eventos" de "nadie miró".
  const newsScannedTo: Record<string, string | null> = {};
  for (const r of rows) newsScannedTo[r.symbol] = await deps.store.newsScannedTo(r.symbol).catch(() => null);
  // Lo que está en cartera usa su stop de seguimiento: sin esta lista, `stop_dentro_del_ruido` no puede correr.
  const held = (await deps.store.positions().catch(() => null))?.map((p) => p.symbol);
  // La última verificación guardada de cada símbolo, la que muestra la ficha: la fila tiene que decir la misma.
  const verifications: Record<string, { date: string; verdict: string } | null> = {};
  for (const r of rows) {
    const v = await deps.store.verification(r.symbol).catch(() => null);
    verifications[r.symbol] = v ? { date: v.date, verdict: v.verdict } : null;
  }
  // El precio vivo contra Yahoo (24/9, `precio_vivo`): a diferencia de las velas, se mira AHORA, porque lo que se
  // controla es el número que la app está mostrando en este momento, no el que usó la corrida.
  let livePrices: { at: string; samples: LivePriceSample[] } | null = null;
  if (deps.livePrices) {
    const at = (opts.now ?? (() => new Date()))();
    const symbols = actedOnSymbols({ rows, plan, held: held ?? null });
    livePrices = { at: at.toISOString(), samples: await sampleLivePrices(deps.livePrices, symbols, at) };
  }
  const findings = checkConsistency({ rows, candles, plan, metrics, mcaps, industries, newsScannedTo, verifications, lastSession, livePrices, today: opts.today, ...(held ? { held } : {}) });
  const { graves, avisos } = summarizeFindings(findings);
  if (livePrices) {
    const n = livePrices.samples.length;
    const conTestigo = livePrices.samples.filter((x) => x.hub && x.witness).length;
    deps.log?.(`[consistencia] precio vivo: ${n} símbolos sobre los que se actúa, ${conTestigo} con hub y Yahoo`);
  }
  if (findings.length === 0) deps.log?.(`[consistencia] ${rows.length} filas revisadas: sin contradicciones`);
  else {
    deps.log?.(`[consistencia] ${graves} graves y ${avisos} avisos sobre ${rows.length} filas`);
    for (const f of findings) deps.log?.(`[consistencia] ${f.severity === "grave" ? "GRAVE" : "aviso"} ${f.check} ${f.symbol ?? ""}: ${f.detail}`);
  }
  return { date: opts.today, findings, graves, avisos };
}
