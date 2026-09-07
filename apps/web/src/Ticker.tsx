import { useCallback, useEffect, useState } from "react";
import { api, type TickerPage } from "./api";
import { PriceChart, type PeriodChange } from "./PriceChart";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";

const f2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const money = (n: number | null | undefined, d = 0) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const big = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : `$${(n / 1e6).toFixed(0)}M`);
const AXIS_LABEL: Record<string, string> = { valuation: "valuación", quality: "calidad", growth: "crecimiento", balance: "balance" };
const stale = (asOf: string | null) => (asOf ? (Date.now() - Date.parse(asOf)) / 86_400_000 > 3 : false);

/** Página global por ticker: todo lo que el sistema sabe de un símbolo, servido desde la base. */
export function Ticker({ symbol, onBack }: { symbol: string; onBack: () => void }) {
  const [t, setT] = useState<TickerPage | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodChange | null>(null);
  const [editingTags, setEditingTags] = useState(false);
  const [moreSummary, setMoreSummary] = useState(false);
  const load = useCallback(() => api.ticker.get(symbol).then(setT).catch((e) => setErr(String(e))), [symbol]);
  useEffect(() => {
    setT(null);
    setErr(null);
    void load();
  }, [load]);
  const onPeriod = useCallback((p: PeriodChange | null) => setPeriod(p), []);

  if (err) return <div className="card"><button className="ghost" onClick={onBack}>← Volver</button><div className="err">{err}</div></div>;
  if (!t) return <div className="card muted">Cargando {symbol}…</div>;
  const d = t.description;
  const q = t.quote;
  const years = d?.firstTradeDate ? Math.floor((Date.now() - Date.parse(d.firstTradeDate)) / (365.25 * 86_400_000)) : null;
  const priceStale = stale(q?.asOf ?? null);
  const m = t.fundamentals?.metrics ?? {};

  return (
    <>
      <div className="card">
        <div className="row">
          <button className="ghost" onClick={onBack}>← Volver</button>
          <h2 style={{ margin: 0, fontFamily: "ui-monospace, Menlo, monospace" }}>{t.symbol}</h2>
          {d?.longName && <span className="muted">— {d.longName}</span>}
          <TagChips tags={t.tags} />
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
              <span className="muted">USD</span>
              {q.change !== null && <span className={priceStale ? "muted" : q.change >= 0 ? "ok" : "bad"}>{q.change >= 0 ? "+" : ""}{q.change.toFixed(2)} ({pct(q.changePct)}){priceStale && " — de su última rueda, no de hoy"}</span>}
              {period && <span className={period.changePercent >= 0 ? "ok" : "bad"}>· {period.label}: {pct(period.changePercent)}</span>}
              {priceStale && <span className="verb REVISAR">⚠ precio viejo: última operación {q.asOf?.slice(0, 10)}</span>}
            </div>
          ) : <span className="muted">Sin precio vivo.</span>}
        </div>
      </div>

      <div className="card"><PriceChart symbol={t.symbol} currentPrice={q?.price ?? null} levels={{ avgCost: t.position?.avgCost ?? null, stop: t.verdict?.stop ?? t.candidate?.stop ?? null, target: t.verdict?.target ?? t.candidate?.target ?? null }} onPeriodChange={onPeriod} /></div>

      <div className="grid2">
        {t.position && (
          <div className="card">
            <b>Tu posición</b>{t.verdict && <> <span className={`verb ${t.verdict.verb}`}>{t.verdict.verb}</span></>}
            <div className="kpis" style={{ marginTop: 8 }}>
              <div className="kpi"><b>{f2(t.position.quantity)}</b><span>tenencia</span></div>
              <div className="kpi"><b>{t.position.weightPct !== null ? `${t.position.weightPct.toFixed(1)}%` : "—"}</b><span>% cartera</span></div>
              <div className="kpi"><b>${f2(t.position.avgCost)}</b><span>costo promedio</span></div>
              <div className="kpi"><b className={t.position.pnlUsd >= 0 ? "ok" : "bad"}>{money(t.position.pnlUsd)}</b><span>ganancia no realizada ({pct(t.position.pnlPct)})</span></div>
              <div className="kpi"><b>{money(t.position.valueUsd)}</b><span>valor</span></div>
              {t.verdict && <div className="kpi"><b>{f2(t.verdict.stop)} / {f2(t.verdict.target)}</b><span>stop / objetivo</span></div>}
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

      {t.candidate && (
        <div className="card">
          <b>Radar</b> <span className={`verb ${t.candidate.verdict}`}>{t.candidate.verdict}</span> <span className="muted">score {f2(t.candidate.score)} · rank {t.candidate.rankInGroup}/{t.candidate.groupSize} entre pares · riesgo {t.candidate.riskScore}/10 · {t.candidate.candidateDate}</span>
          {t.candidate.flags.length > 0 && <div style={{ marginTop: 6 }}>{t.candidate.flags.map((f) => <span key={f} className="flag">⚑ {f}</span>)}</div>}
          {t.candidate.summary && <div style={{ marginTop: 6 }}><b>Qué hace:</b> {t.candidate.summary}</div>}
          {t.candidate.whyRanks && <div><b>Por qué rankea:</b> {t.candidate.whyRanks}</div>}
          {t.candidate.mainRisk && <div><b>Riesgo principal:</b> {t.candidate.mainRisk}</div>}
          {t.candidate.moat && <div><b>Foso:</b> {t.candidate.moat}</div>}
          <div className="muted mono" style={{ marginTop: 6 }}>ejes (z vs pares): {Object.entries(t.candidate.axes).map(([k, v]) => `${AXIS_LABEL[k] ?? k} ${f2(v)}`).join(" · ")} · entrada {f2(t.candidate.entryLow)}–{f2(t.candidate.entryHigh)} · stop {f2(t.candidate.stop)} · objetivo {f2(t.candidate.target)} · tamaño {t.candidate.sizeQty ?? "—"} ({money(t.candidate.sizeUsd)})</div>
          {t.peers.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>par</th><th>P/E</th><th>EV/EBITDA</th><th>P/S</th><th>ROE</th><th>margen op.</th><th>crec. ingresos</th><th>deuda/patr.</th></tr></thead>
              <tbody>
                {[{ symbol: `${t.symbol} (propia)`, metrics: m, own: true }, ...t.peers.map((p) => ({ ...p, own: false }))].map((p) => (
                  <tr key={p.symbol}><td>{p.own ? <b>{p.symbol}</b> : <SymbolLink symbol={p.symbol} />}</td><td className="mono">{f2(p.metrics["peTTM"], 1)}</td><td className="mono">{f2(p.metrics["evEbitdaTTM"], 1)}</td><td className="mono">{f2(p.metrics["psTTM"], 1)}</td><td className="mono">{f2(p.metrics["roeTTM"], 1)}</td><td className="mono">{f2(p.metrics["operatingMarginTTM"], 1)}</td><td className="mono">{f2(p.metrics["revenueGrowthTTMYoy"], 1)}</td><td className="mono">{f2(p.metrics["totalDebt/totalEquityAnnual"])}</td></tr>
                ))}
              </tbody>
            </table>
          )}
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
          <div className="kpi"><b>{money(t.transactionSummary.dividends.total, 2)}</b><span>dividendos ({t.transactionSummary.dividends.count})</span></div>
          <div className="kpi"><b>{money(t.transactionSummary.invested)}</b><span>total invertido</span></div>
        </div>
        {t.transactions.length ? (
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>fecha</th><th>tipo</th><th>cantidad</th><th>precio</th><th>total</th><th>plataforma</th><th>notas</th></tr></thead>
            <tbody>{t.transactions.map((x) => <tr key={x.id}><td>{x.date}</td><td><span className="chip">{x.type}</span></td><td className="mono">{f2(x.quantity, 4)}</td><td className="mono">{f2(x.price)}</td><td className="mono">{money(x.quantity * x.price, 2)}</td><td>{x.platform ?? "—"}</td><td className="muted">{x.notes ?? ""}</td></tr>)}</tbody>
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
      {t.errors.length > 0 && <div className="card muted">Fuentes que no respondieron: {t.errors.join(" · ")}</div>}
    </>
  );
}
