import { useCallback, useEffect, useState } from "react";
import { api, type Measurement, type Position, type Quote, type RiskReport, type Tags, type Verdict } from "./api";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";

const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const f2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const pct2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const usd = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const signed = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${usd(n)}`);
const cls = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "" : n >= 0 ? "ok" : "bad");
/** Un precio de hace más de 3 días no es "de hoy": se muestra apagado, igual que en la ficha. */
const stale = (asOf: string | null) => (asOf ? (Date.now() - Date.parse(asOf)) / 86_400_000 > 3 : false);
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

/**
 * Valuación de una posición: precio vivo si llegó; si no, el cierre del veredicto (apagado). P&L en la moneda de
 * la posición, misma cuenta que la ficha por ticker.
 */
function valuation(p: Position, v: Verdict | undefined, q: Quote | null) {
  const price = q?.price ?? v?.close ?? null;
  const live = q !== null && !stale(q.asOf);
  const cost = p.quantity * p.avgCost;
  const value = price === null ? null : price * p.quantity;
  const pnl = price === null ? null : (price - p.avgCost) * p.quantity;
  const pnlPct = price === null ? null : ((price - p.avgCost) / p.avgCost) * 100;
  return { price, live, cost, value, pnl, pnlPct };
}

/** Totales de la cartera en USD: suma solo las posiciones en USD con precio; avisa cuántas quedaron afuera. */
function totals(positions: Position[], vBy: Map<string, Verdict>, quotes: Record<string, Quote | null>) {
  let value = 0, cost = 0, counted = 0, otherCurrency = 0, noPrice = 0;
  for (const p of positions) {
    if (p.currency !== "USD") { otherCurrency++; continue; }
    const x = valuation(p, vBy.get(p.symbol), quotes[p.symbol] ?? null);
    if (x.value === null) { noPrice++; continue; }
    value += x.value; cost += x.cost; counted++;
  }
  const pnl = value - cost;
  return { value, cost, pnl, pnlPct: cost > 0 ? (pnl / cost) * 100 : null, counted, otherCurrency, noPrice };
}

const EMPTY: Position = { symbol: "", quantity: 0, avgCost: 0, currency: "USD", market: "us", layer: "riesgo", notes: null };

/** Pestaña Cartera (spec etapa 1 §8): posiciones con veredicto, riesgo calculado y medición contra SPY. */
export function Cartera() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const [risk, setRisk] = useState<{ date: string; report: RiskReport } | null>(null);
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [form, setForm] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, Tags | null>>({});
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [quotesAt, setQuotesAt] = useState<string | null>(null);
  const [quotesErr, setQuotesErr] = useState<string | null>(null);
  const [editingTags, setEditingTags] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, v, r, m] = await Promise.all([api.cartera.positions(), api.cartera.verdicts(), api.cartera.risk(), api.cartera.measurement()]);
    setPositions(p);
    setVerdicts(v);
    setRisk(r);
    setMeasurement(m);
    const t: Record<string, Tags | null> = {};
    await Promise.all(p.map(async (x) => { t[x.symbol] = await api.taxonomy.get(x.symbol).catch(() => null); }));
    setTags(t);
    // Precios vivos aparte: la tabla se pinta con lo guardado y los precios llegan cuando llegan.
    void api.cartera.quotes().then((r) => { setQuotes(r.quotes); setQuotesAt(r.asOf); setQuotesErr(null); }).catch((e) => setQuotesErr(String(e)));
  }, []);
  useEffect(() => {
    load().catch((e) => setMsg(String(e)));
  }, [load]);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.cartera.run();
      setMsg(`${s.verdicts.length} veredictos para ${s.date}. Medidos: ${s.measured.measured7} a 7d, ${s.measured.measured30} a 30d.${s.errors.length ? ` Errores: ${s.errors.map((e) => `${e.symbol}: ${e.error}`).join(" · ")}` : ""}`);
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!form) return;
    setBusy(true);
    try {
      await api.cartera.upsertPosition({ ...form, symbol: form.symbol.toUpperCase(), quantity: Number(form.quantity), avgCost: Number(form.avgCost) });
      setForm(null);
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function remove(symbol: string) {
    if (!confirm(`¿Borrar ${symbol} de la cartera?`)) return;
    await api.cartera.deletePosition(symbol);
    await load();
  }

  const vBy = new Map(verdicts.map((v) => [v.symbol, v]));
  const date = verdicts[0]?.verdictDate;
  const tot = totals(positions, vBy, quotes);
  const priced = Object.values(quotes).filter((q) => q !== null).length;
  const quotesNote = quotesErr
    ? `precios vivos no disponibles (${quotesErr}); se usa el cierre del veredicto`
    : quotesAt
      ? `precios de las ${hhmm(quotesAt)}${priced < positions.length ? ` · ${positions.length - priced} sin precio vivo (usa el cierre del veredicto)` : ""}`
      : "cargando precios…";
  const totNote = [tot.otherCurrency ? `${tot.otherCurrency} en otra moneda` : "", tot.noPrice ? `${tot.noPrice} sin precio` : ""].filter(Boolean).join(", ");

  return (
    <>
      <div className="card row">
        <b>Cartera real</b>
        <span className="muted">{date ? `veredictos del ${date}` : "sin veredictos todavía"}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="ghost" onClick={() => setForm({ ...EMPTY })} disabled={busy}>Agregar posición</button>
        <button className="primary" onClick={run} disabled={busy}>{busy ? "Corriendo…" : "Actualizar veredictos"}</button>
      </div>
      {msg && <div className="card">{msg}</div>}
      {positions.length > 0 && (
        <div className="card">
          <div className="kpis">
            <div className="kpi"><b>{usd(tot.value)}</b><span>valor total{totNote ? ` (sin ${totNote})` : ""}</span></div>
            <div className="kpi"><b>{usd(tot.cost)}</b><span>costo total</span></div>
            <div className="kpi"><b className={cls(tot.pnl)}>{signed(tot.pnl)}</b><span>P&amp;L</span></div>
            <div className="kpi"><b className={cls(tot.pnlPct)}>{pct(tot.pnlPct)}</b><span>P&amp;L %</span></div>
          </div>
          <div className="muted" style={{ marginTop: 6 }}>{quotesNote}</div>
        </div>
      )}
      {form && (
        <div className="card form-row">
          <input placeholder="símbolo" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
          <input type="number" placeholder="cantidad" value={form.quantity || ""} onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })} />
          <input type="number" placeholder="costo promedio" value={form.avgCost || ""} onChange={(e) => setForm({ ...form, avgCost: Number(e.target.value) })} />
          <select value={form.market} onChange={(e) => setForm({ ...form, market: e.target.value as Position["market"] })}>
            <option value="us">US</option><option value="adr">ADR</option><option value="ar">Argentina</option>
          </select>
          <select value={form.layer} onChange={(e) => setForm({ ...form, layer: e.target.value as Position["layer"] })}>
            <option value="riesgo">riesgo (stop duro)</option><option value="nucleo">núcleo</option><option value="cobertura">cobertura</option>
          </select>
          <input placeholder="notas" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value || null })} />
          <button className="primary" onClick={save} disabled={busy || !form.symbol || form.quantity <= 0 || form.avgCost <= 0}>Guardar</button>
          <button className="ghost" onClick={() => setForm(null)}>Cancelar</button>
        </div>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <table>
          <thead><tr><th>símbolo</th><th>cant.</th><th>costo</th><th>precio</th><th>valor</th><th>P&amp;L</th><th>P&amp;L %</th><th>peso</th><th>veredicto</th><th>stop</th><th>objetivo</th><th>etiquetas</th><th></th></tr></thead>
          <tbody>
            {positions.map((p) => {
              const v = vBy.get(p.symbol);
              return (
                <Row key={p.symbol} p={p} v={v} q={quotes[p.symbol] ?? null} tags={tags[p.symbol] ?? null} open={open === p.symbol} onToggle={() => setOpen(open === p.symbol ? null : p.symbol)} onEdit={() => setForm({ ...p })} onRemove={() => remove(p.symbol)} editingTags={editingTags === p.symbol} onEditTags={() => setEditingTags(editingTags === p.symbol ? null : p.symbol)} onTagsSaved={() => { setEditingTags(null); void load(); }} />
              );
            })}
            {!positions.length && <tr><td colSpan={13} className="muted">Sin posiciones. Agregá una o corré <span className="mono">pnpm import:v1</span>.</td></tr>}
          </tbody>
        </table>
      </div>
      {risk && <Risk r={risk.report} date={risk.date} />}
      {measurement && <MeasurementCard m={measurement} />}
    </>
  );
}

function Row({ p, v, q, tags, open, onToggle, onEdit, onRemove, editingTags, onEditTags, onTagsSaved }: { p: Position; v: Verdict | undefined; q: Quote | null; tags: Tags | null; open: boolean; onToggle: () => void; onEdit: () => void; onRemove: () => void; editingTags: boolean; onEditTags: () => void; onTagsSaved: () => void }) {
  const x = valuation(p, v, q);
  const priceTitle = !q ? "sin precio vivo: cierre del veredicto" : x.live ? `último precio${q.asOf ? ` ${new Date(q.asOf).toLocaleString("es-AR")}` : ""}` : "precio de su última rueda, no de hoy";
  return (
    <>
      <tr>
        <td><SymbolLink symbol={p.symbol} /> <span className="muted">{p.market}{p.layer !== "riesgo" ? ` · ${p.layer}` : ""}</span></td>
        <td className="mono">{f2(p.quantity)}</td>
        <td className="mono">{f2(p.avgCost)}</td>
        <td className="mono" style={{ whiteSpace: "nowrap" }}>
          <span className={q && x.live ? "" : "muted"} title={priceTitle}>{f2(x.price)}</span>
          {q && q.changePct !== null && <span className={x.live ? cls(q.changePct) : "muted"} style={{ marginLeft: 6, fontSize: 11 }} title="variación contra el cierre previo">{pct2(q.changePct)}</span>}
        </td>
        <td className="mono">{usd(x.value)}</td>
        <td className={`mono ${cls(x.pnl)}`}>{signed(x.pnl)}</td>
        <td className={`mono ${cls(x.pnlPct)}`}>{pct(x.pnlPct)}</td>
        <td className="mono">{v ? `${v.weightPct.toFixed(1)}%` : "—"}</td>
        <td>{v ? <span className={`verb ${v.verb}`}>{v.verb}</span> : <span className="muted">sin veredicto</span>}</td>
        <td className="mono">{f2(v?.stop)}</td>
        <td className="mono">{f2(v?.target)}</td>
        <td><TagChips tags={tags} /></td>
        <td style={{ whiteSpace: "nowrap" }}>
          {v && <button className="ghost" onClick={onToggle}>{open ? "Cerrar" : "Ver"}</button>}{" "}
          <button className="ghost" onClick={onEdit}>Editar</button>{" "}
          <button className="ghost" onClick={onEditTags}>Etiquetas</button>{" "}
          <button className="ghost" onClick={onRemove}>Borrar</button>
        </td>
      </tr>
      {editingTags && <tr><td colSpan={13}><TagEditor symbol={p.symbol} current={tags} onSaved={onTagsSaved} onCancel={onEditTags} /></td></tr>}
      {open && v && (
        <tr>
          <td colSpan={13}>
            <div><b>Por qué:</b> {v.reason}</div>
            {v.narrative && <div style={{ marginTop: 6 }}><b>Modelo:</b> {v.narrative}{v.degradedBy && <span className="muted"> (degradó el veredicto)</span>}</div>}
            {v.warning && <div className="warn" style={{ marginTop: 6 }}><b>Aviso:</b> {v.warning}</div>}
            <div className="muted mono" style={{ marginTop: 6 }}>cierre {f2(v.close)} · spot {f2(v.spot)} · ganancia a esa fecha {pct(v.gainPct)} · SPY {f2(v.spyClose)} · {v.verdictDate}</div>
          </td>
        </tr>
      )}
    </>
  );
}

function Risk({ r, date }: { r: RiskReport; date: string }) {
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(" · ");
  return (
    <div className="card">
      <b>Riesgo de cartera</b> <span className="muted">({date})</span>
      <div className="kpis" style={{ marginTop: 8 }}>
        <div className="kpi"><b>${money(r.totalValue)}</b><span>valor a cierre</span></div>
        <div className="kpi"><b>{f2(r.portfolioBeta)}</b><span>beta vs SPY (63 ruedas)</span></div>
        <div className="kpi"><b className="bad">{pct(r.stressSpyMinus20Pct)}</b><span>si SPY cae 20% (lineal)</span></div>
        <div className="kpi"><b>{r.correlatedPairs.length}</b><span>pares con correlación &gt; 0.7</span></div>
      </div>
      {r.concentration.warnings.map((w) => <div key={w} className="warn" style={{ marginTop: 6 }}>⚠ {w}</div>)}
      <div style={{ marginTop: 8 }}><b>País:</b> {top(r.concentration.byCountry)}</div>
      <div><b>Industria:</b> {top(r.concentration.byIndustry)}</div>
      {Object.keys(r.concentration.bySector ?? {}).length > 0 && <div><b>Sector:</b> {top(r.concentration.bySector)}</div>}
      {Object.keys(r.concentration.byTheme ?? {}).length > 0 && <div><b>Temas:</b> {top(r.concentration.byTheme)}</div>}
      {r.correlatedPairs.length > 0 && <div><b>Correlacionados:</b> {r.correlatedPairs.map((p) => `${p.a}–${p.b} ${p.corr.toFixed(2)}`).join(" · ")}</div>}
      <div className="muted" style={{ marginTop: 6 }}>Liquidez (días para salir al 10% del volumen): {r.liquidity.map((l) => `${l.symbol} ${f2(l.daysToLiquidate, 1)}`).join(" · ")}</div>
      {r.notes.map((n) => <div key={n} className="muted">{n}</div>)}
    </div>
  );
}

function MeasurementCard({ m }: { m: Measurement }) {
  const verbs = ["VENDER", "REVISAR", "MANTENER", "SUMAR"] as const;
  const cell = (b: { n: number; hitRate: number | null; avgAlpha: number | null }) => (b.n ? `${b.n} · ${b.hitRate === null ? "—" : `${(b.hitRate * 100).toFixed(0)}%`} · ${pct(b.avgAlpha)}` : "—");
  return (
    <div className="card">
      <b>Medición contra SPY</b> <span className="muted">{m.total} veredictos, {m.pending} pendientes de medir</span>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>verbo</th><th>7 días (n · acierto · alpha medio)</th><th>30 días</th></tr></thead>
        <tbody>{verbs.map((v) => <tr key={v}><td><span className={`verb ${v}`}>{v}</span></td><td className="mono">{cell(m.byVerb[v].h7)}</td><td className="mono">{cell(m.byVerb[v].h30)}</td></tr>)}</tbody>
      </table>
      <div className="muted" style={{ marginTop: 6 }}>VENDER acierta si el papel rindió menos que SPY después; MANTENER/SUMAR si rindió más; REVISAR no se puntúa. Los MANTENER diarios de una misma posición están correlacionados: leé la tendencia, no el n.</div>
    </div>
  );
}
