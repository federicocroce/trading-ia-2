import { useCallback, useEffect, useState } from "react";
import { api, type Candidate, type TickerPage, type WatchItem } from "./api";
import { PriceChart, type PeriodChange } from "./PriceChart";
import { relacionDeLaOrden } from "./niveles";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";
import { EntryLine } from "./Entry";
import { WatchlistButton } from "./WatchlistButton";
import { usePrices } from "./prices";
import { Flags } from "./flags";
import { VerificationSections } from "./Verification";
import { PeersTable } from "./Peers";
import { CarteraVerdict, RadarVerdict, usePlan } from "./plan";

const f2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const money = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const big = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
const AXIS_LABEL: Record<string, string> = { valuation: "valuación", quality: "calidad", growth: "crecimiento", balance: "balance" };
const stale = (asOf: string | null) => (asOf ? (Date.now() - Date.parse(asOf)) / 86_400_000 > 3 : false);

/** Página global por ticker: todo lo que el sistema sabe de un símbolo, servido desde la base. */
export function Ticker({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  // Toda etiqueta de COMPRAR o SUMAR sale del plan vigente (14/9).
  const plan = usePlan();
  const [t, setT] = useState<TickerPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodChange | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [moreSummary, setMoreSummary] = useState(false);
  const [watchItems, setWatchItems] = useState<WatchItem[]>([]);
  const loadWatch = useCallback(() => api.radar.watchlist().then((w) => setWatchItems(w.items)).catch(() => null), []);
  useEffect(() => { void loadWatch(); }, [loadWatch]);
  const load = useCallback(() => api.ticker.get(symbol).then(setT).catch((e) => setErr(String(e))), [symbol]);
  useEffect(() => {
    let alive = true;
    setT(null);
    setErr(null);
    // Dos fases: primero lo guardado (rápido) para pintar ya; después la página completa con precio vivo.
    api.ticker.get(symbol, { live: false }).then((p) => { if (alive && p) setT((cur) => cur ?? p); }).catch(() => null);
    api.ticker.get(symbol).then((p) => { if (alive) setT(p); }).catch((e) => { if (alive) setErr(String(e)); });
    return () => { alive = false; };
  }, [symbol]);
  const onPeriod = useCallback((p: PeriodChange | null) => setPeriod(p), []);
  const { prices: livePrices } = usePrices();

  if (err) return <div className="card"><button className="ghost" onClick={onBack}>← Volver</button><div className="err">{err}</div></div>;
  if (!t) return <div className="card muted">Cargando {symbol}…</div>;
  const d = t.description;
  const hubRow = livePrices.get(t.symbol.toUpperCase());
  // Precio en vivo del hub si el símbolo está seguido; si no, el de la página.
  const q = hubRow ? { price: hubRow.price, prevClose: hubRow.prevClose, change: hubRow.change, changePct: hubRow.changePct, asOf: hubRow.asOf, currency: hubRow.currency } : t.quote;
  const years = d?.firstTradeDate ? Math.floor((Date.now() - Date.parse(d.firstTradeDate)) / (365.25 * 86_400_000)) : null;
  const priceStale = stale(q?.asOf ?? null);
  const m = t.fundamentals?.metrics ?? {};
  // Niveles vigentes: el veredicto de Cartera manda; si no hay posición, los del Radar. El núcleo no tiene niveles: se mantiene.
  const isNucleo = t.candidate?.verdict === "NUCLEO";
  const levelsFrom = t.verdict ? "Cartera" : t.candidate && !isNucleo ? "Radar" : null;
  const stop = t.verdict?.stop ?? (isNucleo ? null : t.candidate?.stop ?? null);
  const target = t.verdict?.target ?? (isNucleo ? null : t.candidate?.target ?? null);
  const px = q?.price ?? null;
  const move = (level: number | null) => (px && level ? ((level - px) / px) * 100 : null);
  const toStop = move(stop);
  const toTarget = move(target);
  // Sin posición, la relación es la de la orden del Radar (desde el techo de compra), no la del precio en vivo.
  const rr = relacionDeLaOrden({ stop, target, price: px, entryHigh: t.verdict ? null : t.candidate?.entryHigh, desde: levelsFrom });
  const qty = t.position?.quantity ?? null;
  const usdAt = (level: number | null) => (px && level && qty ? money(qty * (level - px)) : null);

  return (
    <>
      <div className="card">
        <div className="row">
          <button className="ghost" onClick={onBack}>← Volver</button>
          <h2 style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace" }}>{t.symbol}</h2>
          {d?.longName && <span className="muted">— {d.longName}</span>}
          <TagChips tags={t.tags} />
          <WatchlistButton symbol={t.symbol} items={watchItems} onChanged={() => { void loadWatch(); window.dispatchEvent(new Event("watchlist:changed")); }} />
          <button className="ghost" onClick={() => setEditingTags(!editingTags)}>Etiquetas</button>
        </div>
        {editingTags && <TagEditor symbol={t.symbol} current={t.tags} onSaved={() => { setEditingTags(false); void load(); }} onCancel={() => setEditingTags(false)} />}
        {d ? (
          <div className="muted" style={{ marginTop: 8, borderLeft: "2px solid var(--line)", paddingLeft: 10 }}>
            <div>{[d.sector && d.industry ? `${d.sector} · ${d.industry}` : d.sector ?? d.industry, d.exchangeName && d.country ? `${d.exchangeName} · ${d.country}` : d.exchangeName ?? d.country, d.employees ? `~${d.employees.toLocaleString("en-US")} empleados` : null].filter(Boolean).join("  ·  ")}{d.website && <> · <a href={`https://${d.website}`} target="_blank" rel="noreferrer">{d.website}</a></>}</div>
            {years !== null && <div title="Años cotizando, no desde la fundación">Cotiza desde {d.firstTradeDate} · {years} años</div>}
            {d.summary && <p style={{ margin: "6px 0 0", maxWidth: 900, display: "-webkit-box", WebkitLineClamp: moreSummary ? "unset" : 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{d.summary}</p>}
            {d.summary && d.summary.length > 300 && <button className="ghost" style={{ padding: "2px 8px", marginTop: 4 }} onClick={() => setMoreSummary(!moreSummary)}>{moreSummary ? "ver menos" : "ver más"}</button>}
          </div>
        ) : <div className="muted" style={{ marginTop: 8 }}>Perfil no disponible (Yahoo no respondió).</div>}
        <div style={{ marginTop: 12 }}>
          {q ? (
            <div className="row" style={{ alignItems: "baseline" }}>
              <span style={{ fontSize: 30, fontWeight: 700, fontFamily: "ui-monospace, Menlo, monospace" }} className={priceStale ? "muted" : ""}>${q.price.toFixed(2)}</span>
              <span className="muted">{q.currency ?? "USD"}</span>
              {q.change !== null && <span className={priceStale ? "muted" : q.change >= 0 ? "ok" : "bad"}>{q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({pct(q.changePct)}){priceStale && " — de su última rueda, no de hoy"}</span>}
              {period && <span className={period.changePercent >= 0 ? "ok" : "bad"}>· {period.label}: {pct(period.changePercent)}</span>}
              {priceStale && <span className="verb REVISAR">⚠ precio viejo: última operación {q.asOf?.slice(0, 10)}</span>}
            </div>
          ) : <span className="muted">Sin precio vivo.</span>}
          {isNucleo && !t.verdict && <div className="row" style={{ marginTop: 8 }}><span className="verb NUCLEO">NUCLEO</span><span className="muted">ETF de base de la cartera: se compra por calendario con el aporte y se mantiene años. Sin stop ni objetivo: no se vende por precio.</span></div>}
          {px && (stop || target) && (
            <div className="row" style={{ marginTop: 8, gap: 16 }}>
              {stop && <span>Stop <b className="mono">{f2(stop)}</b> <span className={toStop !== null && toStop < 0 ? "bad" : "warn"}>{pct(toStop)}{usdAt(stop) && ` · ${usdAt(stop)}`}</span></span>}
              {target && <span>Objetivo <b className="mono">{f2(target)}</b> <span className={toTarget !== null && toTarget > 0 ? "ok" : "warn"}>{pct(toTarget)}{usdAt(target) && ` · ${usdAt(target)}`}</span></span>}
              {rr && <span className="muted">{rr.texto}</span>}
              {toStop !== null && toStop >= 0 && <span className="verb VENDER">precio por debajo del stop</span>}
              <span className="muted">({levelsFrom}{qty ? `, sobre tu tenencia de ${f2(qty)}` : ", sin posición"})</span>
            </div>
          )}
        </div>
      </div>

      <div className="card"><PriceChart symbol={t.symbol} currentPrice={q?.price ?? null} levels={{ avgCost: t.position?.avgCost ?? null, stop, target, stopLabel: levelsFrom === "Radar" ? "stop de compra" : "stop" }} onPeriodChange={onPeriod} /></div>

      <div className="grid2">
        {t.position && (
          <div className="card">
            <b>Tu posición</b>{t.verdict && <> <CarteraVerdict symbol={t.symbol} verb={t.verdict.verb} plan={plan} /></>}
            <div className="kpis" style={{ marginTop: 8 }}>
              <div className="kpi"><b>{f2(t.position.quantity)}</b><span>tenencia</span></div>
              <div className="kpi"><b>{t.position.weightPct !== null ? `${t.position.weightPct.toFixed(1)}%` : "—"}</b><span>% cartera</span></div>
              <div className="kpi"><b>${f2(t.position.avgCost)}</b><span>costo promedio</span></div>
              <div className="kpi"><b className={t.position.pnlUsd >= 0 ? "ok" : "bad"}>{money(t.position.pnlUsd)}</b><span>ganancia no realizada ({pct(t.position.pnlPct)})</span></div>
              <div className="kpi"><b>{money(t.position.valueUsd)}</b><span>valor</span></div>
              {t.verdict && <div className="kpi"><b><span className="bad">{f2(t.verdict.stop)}</span> / <span className="ok">{f2(t.verdict.target)}</span></b><span>stop ({pct(move(t.verdict.stop))}) / objetivo ({pct(move(t.verdict.target))})</span></div>}
            </div>
            {t.verdict && <div style={{ marginTop: 8 }}><b>Por qué:</b> {t.verdict.reason}{t.verdict.narrative && <div className="muted" style={{ marginTop: 4 }}><b>Modelo:</b> {t.verdict.narrative}</div>}{t.verdict.warning && <div className="warn" style={{ marginTop: 4 }}>⚠ {t.verdict.warning}</div>}</div>}
          </div>
        )}
        <div className="card">
          <b>Fundamentales</b> {t.fundamentals && <span className="muted">(Finnhub, {t.fundamentals.asOf})</span>}
          {t.fundamentals ? (
            <div className="kpis" style={{ marginTop: 8 }}>
              <div className="kpi"><b>{f2(m["peTTM"], 1)}</b><span>P/E</span></div>
              <div className="kpi"><b>{f2(m["evEbitdaTTM"], 1)}</b><span>EV/EBITDA</span></div>
              <div className="kpi"><b>{f2(m["psTTM"], 1)}</b><span>P/S</span></div>
              <div className="kpi"><b>{big(t.fundamentals.mcapUsd)}</b><span>capitalización{t.fundamentals.mcapUsd === null ? " (desconocida, ADR)" : ""}</span></div>
              <div className="kpi"><b>{f2(m["roeTTM"], 1)}%</b><span>ROE</span></div>
              <div className="kpi"><b>{f2(m["operatingMarginTTM"], 1)}%</b><span>margen operativo</span></div>
              <div className="kpi"><b>{f2(m["revenueGrowthTTMYoy"], 1)}%</b><span>crec. ingresos (12m)</span></div>
              <div className="kpi"><b>{f2(m["epsGrowthTTMYoy"], 1)}%</b><span>crec. EPS (12m)</span></div>
              <div className="kpi"><b>{f2(m["totalDebt/totalEquityAnnual"])}</b><span>deuda / patrimonio</span></div>
              <div className="kpi"><b>{f2(m["dividendYieldIndicatedAnnual"], 2)}%</b><span>dividendo</span></div>
              <div className="kpi"><b>{f2(m["beta"])}</b><span>beta</span></div>
              <div className="kpi"><b>{f2(m["52WeekLow"], 0)} – {f2(m["52WeekHigh"], 0)}</b><span>rango 52 semanas</span></div>
              <div className="kpi"><b>{big(t.fundamentals.dollarVolumeUsd)}</b><span>volumen / día</span></div>
              {t.fundamentals.nextEarnings && <div className="kpi"><b>{t.fundamentals.nextEarnings}</b><span>próximos resultados</span></div>}
            </div>
          ) : <div className="muted" style={{ marginTop: 8 }}>Sin fundamentals: el símbolo no está en el universo del Radar (corré un barrido) o no pasó el quality bar.</div>}
        </div>
      </div>

      {t.candidate && t.candidate.kind === "ar" && (
        <div className="card">
          <b>Radar Argentina</b> <RadarVerdict symbol={t.symbol} verdict={t.candidate.verdict} plan={null} context="argentina" /> <span className="muted">contra el Merval, en pesos · {t.candidate.candidateDate}</span>
          {t.candidate.flags.length > 0 && <div style={{ marginTop: 6 }}><Flags flags={t.candidate.flags} /></div>}
          <div className="muted mono" style={{ marginTop: 6 }}>FR 3m {pct(t.candidate.axes["rs3m"])} · FR 6m {pct(t.candidate.axes["rs6m"])} · FR 12m {pct(t.candidate.axes["rs12m"])} · vs SMA200 {pct(t.candidate.axes["distSma200Pct"])} · precio al CCL US$ {f2(t.candidate.axes["closeUsd"])}</div>
          {t.candidate.peerGroup[0] && <div style={{ marginTop: 6 }}>Fundamentals y ranking contra pares: en el ADR <SymbolLink symbol={t.candidate.peerGroup[0]} />.</div>}
        </div>
      )}
      {t.candidate && t.candidate.kind === "cedear" && (
        <div className="card">
          <b>CEDEAR</b> <span className="muted">de {t.candidate.peerGroup[0] && <SymbolLink symbol={t.candidate.peerGroup[0]} />} · ratio {t.candidate.axes["ratio"]} · {t.candidate.candidateDate}</span>
          <div style={{ marginTop: 6 }}>Dólar implícito <b className="mono">{f2(t.candidate.axes["impliedCcl"])}</b> · contra el CCL <b className={`mono ${(t.candidate.axes["gapPct"] ?? 0) > 2 ? "bad" : (t.candidate.axes["gapPct"] ?? 0) < -2 ? "ok" : ""}`}>{pct(t.candidate.axes["gapPct"])}</b> · {t.candidate.flags.join(", ")}</div>
        </div>
      )}
      {/* La verificación web, los estados de la SEC y los eventos vivían DENTRO de la tarjeta del Radar, que
          solo se dibuja si el símbolo es candidata de hoy. Resultado: en NEM, GGAL, YPF y TSM, donde hay
          plata puesta, la app tenía la verificación con reservas y seis recortes de precio objetivo, y la
          ficha no mostraba nada mientras Cartera decía SUMAR. La evidencia que contradice al veredicto es
          justo la que no puede depender de estar en el ranking del día. */}
      {/* También se dibuja cuando NO hay nada que mostrar, si el símbolo es una posición o una candidata de
          acciones: ahí el hueco es la información. Con la condición vieja, un símbolo sin estados y sin
          noticias leídas no dibujaba la tarjeta y la pantalla quedaba idéntica a la de uno verificado y
          limpio. Los ETFs no entran: no tienen estados de la SEC ni hechos de una empresa que leer, así que
          ahí el vacío no esconde nada. */}
      {(t.verification || t.statements || t.events.length > 0 || t.analystActions.length > 0 || t.position || (t.candidate && t.candidate.kind !== "etf")) && (
        <div className="card">
          <b>Verificación y estados</b>
          {!t.candidate && <span className="muted"> · no es candidata del Radar hoy, pero esto es lo que la app sabe del negocio</span>}
          <VerificationSections statements={t.statements} events={t.events} analystActions={t.analystActions} analystTargets={t.candidate?.analystTargets} close={t.quote?.price ?? t.candidate?.close ?? null} metricsRaw={t.fundamentals?.metricsRaw} verification={t.verification ?? null} newsScannedTo={t.candidate?.kind === "etf" ? undefined : t.newsScannedTo} />
        </div>
      )}
      {t.candidate && (t.candidate.kind === "etf" || t.candidate.kind === "adr") && <EtfCard c={t.candidate} />}
      {t.candidate && t.candidate.kind === "stock" && (
        <div className="card">
          <b>Radar</b> <RadarVerdict symbol={t.symbol} verdict={t.candidate.verdict} plan={plan} /> <span className="muted">score {f2(t.candidate.score)} · rank {t.candidate.rankInGroup}/{t.candidate.groupSize} entre pares · riesgo {t.candidate.riskScore}/10 · {t.candidate.candidateDate}</span>
          {t.candidate.flags.length > 0 && <div style={{ marginTop: 6 }}><Flags flags={t.candidate.flags} /></div>}
          {t.candidate.summary && <div style={{ marginTop: 6 }}><b>Qué hace:</b> {t.candidate.summary}</div>}
          {t.candidate.whyRanks && <div><b>Por qué rankea:</b> {t.candidate.whyRanks}</div>}
          {t.candidate.mainRisk && <div><b>Riesgo principal:</b> {t.candidate.mainRisk}</div>}
          {t.candidate.moat && <div><b>Foso:</b> {t.candidate.moat}</div>}
          <EntryLine e={t.candidate.entry} />
          <div className="muted mono" style={{ marginTop: 6 }}>ejes (z vs pares): {Object.entries(t.candidate.axes).map(([k, v]) => `${AXIS_LABEL[k] ?? k} ${f2(v)}`).join(" · ")} · entrada {f2(t.candidate.entryLow)}–{f2(t.candidate.entryHigh)} · stop {f2(t.candidate.stop)} · objetivo {f2(t.candidate.target)} · tamaño {t.candidate.sizeQty ?? "—"} ({money(t.candidate.sizeUsd)} pagando hasta {f2(t.candidate.entryHigh)})</div>
          <PeersTable own={t.symbol} ownMetrics={m} peers={t.peers} medians={t.medians ?? null} asOf={t.fundamentals?.asOf ?? null} />
        </div>
      )}

      {t.fundamentals && (t.fundamentals.analyst || t.fundamentals.earningsSurprises?.length || t.fundamentals.insiderBuys90d !== null) && (
        <div className="card muted">
          {t.fundamentals.analyst && <span>Analistas ({t.fundamentals.analyst.period}): {t.fundamentals.analyst.strongBuy + t.fundamentals.analyst.buy} compran · {t.fundamentals.analyst.hold} mantienen · {t.fundamentals.analyst.sell + t.fundamentals.analyst.strongSell} venden. </span>}
          {t.fundamentals.earningsSurprises?.length ? <span>Sorpresas de resultados: {t.fundamentals.earningsSurprises.map((s) => `${s.period.slice(0, 7)} ${pct(s.surprisePercent)}`).join(", ")}. </span> : null}
          {t.fundamentals.insiderBuys90d !== null && <span>Insiders 90 días: {t.fundamentals.insiderBuys90d} compras, {t.fundamentals.insiderSells90d ?? 0} ventas.</span>}
        </div>
      )}

      {t.theses.length > 0 && (
        <div className="card">
          <b>Tesis por evento</b>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>fecha</th><th>evento</th><th>dirección</th><th>pEst</th><th>pMkt</th><th>edge</th><th>estado</th></tr></thead>
            <tbody>{t.theses.map((x) => <tr key={x.id}><td>{x.createdAt.slice(0, 10)}</td><td>{x.eventType}{x.eventDate ? ` ${x.eventDate}` : ""}</td><td className={x.direction}>{x.direction}</td><td className="mono">{(x.pEstimate * 100).toFixed(0)}%</td><td className="mono">{(x.pMarket * 100).toFixed(0)}%</td><td className="mono">{(x.edge * 100).toFixed(0)}%</td><td>{x.status}{x.rejectionReason ? ` (${x.rejectionReason})` : ""}</td></tr>)}</tbody>
          </table>
        </div>
      )}

      <div className="card">
        <b>Operaciones</b>
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><b>{money(t.transactionSummary.buys.total)}</b><span>compras ({t.transactionSummary.buys.count})</span></div>
          <div className="kpi"><b>{money(t.transactionSummary.sells.total)}</b><span>ventas ({t.transactionSummary.sells.count})</span></div>
          {/* Los cinco DIVIDEND de GGAL no son plata: son acciones (dividendo reinvertido). La pantalla
              mostraba "dividendos US$ 382,71" entre "compras" y "total invertido", donde todo lo demás es
              efectivo, así que se leía como plata cobrada. Nunca entró un dólar: entraron 7,845 acciones. */}
          {t.transactionSummary.dividends.count > 0 && (
            t.transactionSummary.dividendShares
              ? <div className="kpi" title={`${t.transactionSummary.dividendShares} acciones recibidas en ${t.transactionSummary.dividends.count} pagos, que valían ${money(t.transactionSummary.dividends.total, 2)} al precio de cada uno. No entró efectivo: ya están dentro de tu posición.`}><b>{f2(t.transactionSummary.dividendShares, 3)}</b><span>acciones por dividendo ({t.transactionSummary.dividends.count} pagos, no es efectivo)</span></div>
              : <div className="kpi"><b>{money(t.transactionSummary.dividends.total, 2)}</b><span>dividendos ({t.transactionSummary.dividends.count})</span></div>
          )}
          <div className="kpi" title="Compras menos ventas. Los traspasos entre plataformas no entran: no son plata nueva, son la misma posición cambiando de lugar."><b>{money(t.transactionSummary.invested)}</b><span>total invertido (sin traspasos)</span></div>
        </div>
        {t.transactions.length ? (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>fecha</th><th>tipo</th><th>cantidad</th><th>precio</th><th>total</th><th>plataforma</th><th>notas</th></tr></thead>
            <tbody>{t.transactions.map((x) => <tr key={x.id}><td>{x.date}</td><td><span className="chip" title={x.type === "DIVIDEND" ? "Dividendo reinvertido: recibiste acciones, no efectivo." : x.type === "TRANSFER" ? "Traspaso entre plataformas: es la FOTO de lo que ya tenías ese día, no una compra. Por eso el monto puede superar al total invertido y por eso las compras anteriores ya están adentro de esta cantidad." : undefined}>{x.type === "DIVIDEND" ? "DIVIDENDO EN ACCIONES" : x.type === "TRANSFER" ? "TRASPASO (saldo)" : x.type}</span></td><td className="mono">{f2(x.quantity, 4)}</td><td className="mono">{f2(x.price)}</td><td className="mono">{money(x.quantity * x.price, 2)}</td><td>{x.platform ?? "—"}</td><td className="muted">{x.notes ?? ""}</td></tr>)}</tbody>
          </table>
        ) : <div className="muted" style={{ marginTop: 8 }}>Sin operaciones cargadas.</div>}
      </div>

      {(t.news.length > 0 || t.filings.length > 0 || t.arNews.length > 0) && (
        <div className="card">
          <b>Noticias y filings</b>
          {t.news.map((n) => <div key={n.url} style={{ marginTop: 6 }}><span className="muted mono">{n.date}</span> <a href={n.url} target="_blank" rel="noreferrer">{n.headline}</a>{n.source && <span className="muted"> · {n.source}</span>}</div>)}
          {t.filings.length > 0 && <div style={{ marginTop: 8 }}><span className="muted">Filings SEC:</span> {t.filings.map((f) => <div key={f} className="muted mono">{f}</div>)}</div>}
          {t.arNews.length > 0 && <div style={{ marginTop: 8 }}><span className="muted">Prensa argentina:</span> {t.arNews.map((f) => <div key={f} className="muted">{f}</div>)}</div>}
        </div>
      )}
      {t.pending.length > 0 && <div className="card muted">Completando {t.pending.join(", ")}…</div>}
      {t.errors.length > 0 && <div className="card muted">Fuentes que no respondieron: {t.errors.join(" · ")}</div>}
    </>
  );
}

/**
 * ETF en la ficha del ticker (12/9). Antes compartía tarjeta con las acciones y el resultado mentía tres
 * veces en la misma línea: "score — · rank / entre pares · riesgo /10" (un ETF no se puntúa contra pares ni
 * se le calcula riesgo, así que los tres salían vacíos con su rótulo puesto), y "ejes (z vs pares): rs3m
 * 2.76 · rs6m -3.25 · rs12m 45.88" con nombres crudos, cuando no son z de nada: son PORCENTAJES de fuerza
 * relativa contra SPY. Leído como z, un 45,88 es imposible; leído como lo que es, dice que COPX le sacó
 * 45,9% al SPY en doce meses, que es toda la tesis del ETF.
 */
function EtfCard({ c }: { c: Candidate }) {
  const plan = usePlan();
  const nucleo = c.verdict === "NUCLEO";
  // Un ADR argentino se decide con las mismas reglas de tendencia que un ETF satélite (ver `decideAdr`): la
  // tarjeta es la misma, pero tiene que decir qué es y de qué acción local sale.
  const adr = c.kind === "adr";
  return (
    <div className="card">
      <b>{adr ? "Radar · ADR argentino" : "Radar · ETF"}</b> <RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={adr ? null : plan} {...(adr ? { context: "argentina" as const } : {})} /> <span className="muted">{c.candidateDate}</span>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        {adr
          ? <>Empresa argentina en Nueva York, en dólares{c.peerGroup[0] && <> (su acción local es <SymbolLink symbol={c.peerGroup[0]} />)</>}. Se decide por tendencia contra el SPY, igual que un ETF satélite: no está en el ranking de fundamentals contra pares, por eso acá no hay score ni ranking.</>
          : nucleo
            ? "Del núcleo: se compra por calendario con el aporte del mes y se mantiene. No se le busca el momento, no lleva stop ni objetivo."
            : "Satélite: se decide por fuerza relativa contra el SPY, no por fundamentals. No se puntúa contra pares ni se le calcula riesgo, por eso acá no hay score ni ranking."}
      </div>
      {c.flags.length > 0 && <div style={{ marginTop: 6 }}><Flags flags={c.flags} /></div>}
      {!nucleo && <EntryLine e={c.entry} />}
      <div className="muted mono" style={{ marginTop: 6 }}>
        fuerza relativa contra SPY: 3m {pct(c.axes["rs3m"])} · 6m {pct(c.axes["rs6m"])} · 12m {pct(c.axes["rs12m"])} · contra su media de 200 {pct(c.axes["distSma200Pct"])} · movimiento diario típico {pct(c.axes["atrPct"])}
      </div>
      <div className="muted mono">
        precio {f2(c.close)}{nucleo ? "" : ` · stop ${f2(c.stop)} · objetivo ${f2(c.target)}`}
      </div>
    </div>
  );
}
