import { useCallback, useEffect, useState, useMemo } from "react";
import { api, isHistorical, type CurveMetrics, type CurveResponse, type Measurement, type Position, type Quote, type RiskReport, type Tags, type Verdict } from "./api";
import { CurveChart } from "./CurveChart";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";
import { usePrices } from "./prices";
import { CarteraVerdict, usePlan } from "./plan";

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
  const [curve, setCurve] = useState<CurveResponse | null>(null);
  const [form, setForm] = useState<Position | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [tags, setTags] = useState<Record<string, Tags | null>>({});
  const { prices: livePrices, live: liveStream, at: quotesAt } = usePrices();
  const quotesErr: string | null = null;
  // Precios vivos del hub (los mismos de la watchlist y la cinta), en la forma que ya usa la tabla.
  const quotes = useMemo<Record<string, Quote | null>>(() => Object.fromEntries(positions.map((p) => { const r = livePrices.get(p.symbol.toUpperCase()); return [p.symbol, r ? { price: r.price, prevClose: r.prevClose, change: r.change, changePct: r.changePct, asOf: r.asOf, currency: r.currency } : null]; })), [positions, livePrices, livePrices.size, quotesAt]);
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
    // La curva se calcula desde lo guardado; si falla, la card lo dice y el resto de la pestaña no espera.
    void api.cartera.curve().then(setCurve).catch((e) => setCurve({ curve: null, error: String(e), computedAt: new Date().toISOString() }));
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
      ? `precios ${liveStream ? "en vivo" : "cada 30 s"}, últimos de las ${hhmm(quotesAt)}${priced < positions.length ? ` · ${positions.length - priced} sin precio vivo (usa el cierre del veredicto)` : ""}`
      : "cargando precios…";
  const totNote = [tot.otherCurrency ? `${tot.otherCurrency} en otra moneda` : "", tot.noPrice ? `${tot.noPrice} sin precio` : ""].filter(Boolean).join(", ");

  return (
    <>
      <div className="card row">
        <b>Cartera real</b>
        <span className="muted">{date ? `veredictos del ${date}` : "sin veredictos todavía"}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <button className="ghost" onClick={() => setForm({ ...EMPTY })} disabled={busy}>Agregar posición</button>
        {!isHistorical() && <button className="primary" onClick={run} disabled={busy}>{busy ? "Corriendo…" : "Actualizar veredictos"}</button>}
      </div>
      {msg && <div className="card">{msg}</div>}
      {positions.length > 0 && (
        <div className="card">
          <div className="kpis">
            {/* Dos valores de cartera conviven en esta pantalla y hasta el 13/9 ninguno decía de cuándo era:
                éste, al precio vivo de ahora, y el "valor a cierre" de la tarjeta de riesgo, que es el del
                cierre de la última corrida. Que no coincidan es correcto; que no se sepa cuál es cuál, no. */}
            <div className="kpi"><b>{usd(tot.value)}</b><span>valor ahora{quotesAt ? `, ${hhmm(quotesAt)}` : ""}{totNote ? ` (sin ${totNote})` : ""}</span></div>
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
          <thead><tr><th>símbolo</th><th>cant.</th><th>costo</th><th>invertido</th><th>precio</th><th>valor</th><th>P&amp;L</th><th>P&amp;L %</th><th>peso</th><th>veredicto</th><th title="Si cierra por debajo, se vende: la tesis se anuló.">stop</th><th title="No es una ganancia esperada: es el doble de la distancia al stop. Un papel tranquilo muestra poco y uno volátil mucho, sin que eso diga cuál es mejor.">objetivo</th><th>etiquetas</th><th></th></tr></thead>
          <tbody>
            {positions.map((p) => {
              const v = vBy.get(p.symbol);
              return (
                <Row key={p.symbol} p={p} v={v} q={quotes[p.symbol] ?? null} tags={tags[p.symbol] ?? null} open={open === p.symbol} onToggle={() => setOpen(open === p.symbol ? null : p.symbol)} onEdit={() => setForm({ ...p })} onRemove={() => remove(p.symbol)} editingTags={editingTags === p.symbol} onEditTags={() => setEditingTags(editingTags === p.symbol ? null : p.symbol)} onTagsSaved={() => { setEditingTags(null); void load(); }} />
              );
            })}
            {!positions.length && <tr><td colSpan={14} className="muted">Sin posiciones. Agregá una o corré <span className="mono">pnpm import:v1</span>.</td></tr>}
          </tbody>
        </table>
      </div>
      {risk && <Risk r={risk.report} date={risk.date} />}
      {curve && <CurveCard r={curve} />}
      {measurement && <MeasurementCard m={measurement} />}
    </>
  );
}

function Row({ p, v, q, tags, open, onToggle, onEdit, onRemove, editingTags, onEditTags, onTagsSaved }: { p: Position; v: Verdict | undefined; q: Quote | null; tags: Tags | null; open: boolean; onToggle: () => void; onEdit: () => void; onRemove: () => void; editingTags: boolean; onEditTags: () => void; onTagsSaved: () => void }) {
  const x = valuation(p, v, q);
  const plan = usePlan();
  const priceTitle = !q ? "sin precio vivo: cierre del veredicto" : x.live ? `último precio${q.asOf ? ` ${new Date(q.asOf).toLocaleString("es-AR")}` : ""}` : "precio de su última rueda, no de hoy";
  return (
    <>
      <tr>
        <td><SymbolLink symbol={p.symbol} /> <span className="muted">{p.market}{p.layer !== "riesgo" ? ` · ${p.layer}` : ""}</span></td>
        <td className="mono">{f2(p.quantity)}</td>
        <td className="mono">{f2(p.avgCost)}</td>
        <td className="mono" title="USD invertidos en el ticker: cantidad × costo promedio">{usd(x.cost)}</td>
        <td className="mono" style={{ whiteSpace: "nowrap" }}>
          <span className={q && x.live ? "" : "muted"} title={priceTitle}>{f2(x.price)}</span>
          {q && q.changePct !== null && <span className={x.live ? cls(q.changePct) : "muted"} style={{ marginLeft: 6, fontSize: 11 }} title="variación contra el cierre previo">{pct2(q.changePct)}</span>}
        </td>
        <td className="mono">{usd(x.value)}</td>
        <td className={`mono ${cls(x.pnl)}`}>{signed(x.pnl)}</td>
        <td className={`mono ${cls(x.pnlPct)}`}>{pct(x.pnlPct)}</td>
        <td className="mono">{v ? `${v.weightPct.toFixed(1)}%` : "—"}</td>
        {/* SUMAR solo si el plan de hoy lo suma: TSM el 14/9 decía SUMAR acá y el plan no lo sumaba. */}
        <td style={{ maxWidth: 260 }}>{v ? <CarteraVerdict symbol={p.symbol} verb={v.verb} plan={plan} /> : <span className="muted">sin veredicto</span>}</td>
        <td className="mono">{f2(v?.stop)}</td>
        {/* El "objetivo" es el precio donde la operación paga dos veces lo que arriesga hasta el stop: es
            aritmética sobre el stop, no una ganancia esperada. En el plan del Radar ya se corrigió; acá
            mostraba el mismo número con el mismo rótulo engañoso. Se deja apagado y con su motivo. */}
        <td className="mono">
          {f2(v?.target)}
          {v?.target !== null && v?.target !== undefined && (
            <div className="muted" style={{ fontSize: 11 }} title="No es una ganancia esperada ni un pronóstico: es el precio donde la operación paga dos veces lo que arriesga hasta el stop. Por eso acompaña a la distancia del stop y no a la empresa.">2× el riesgo</div>
          )}
        </td>
        <td><TagChips tags={tags} /></td>
        <td style={{ whiteSpace: "nowrap" }}>
          {v && <button className="ghost" onClick={onToggle}>{open ? "Cerrar" : "Ver"}</button>}{" "}
          <button className="ghost" onClick={onEdit}>Editar</button>{" "}
          <button className="ghost" onClick={onEditTags}>Etiquetas</button>{" "}
          <button className="ghost" onClick={onRemove}>Borrar</button>
        </td>
      </tr>
      {editingTags && <tr><td colSpan={14}><TagEditor symbol={p.symbol} current={tags} onSaved={onTagsSaved} onCancel={onEditTags} /></td></tr>}
      {open && v && (
        <tr>
          <td colSpan={14}>
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

/**
 * Riesgo de cartera. El 12/9 esta tarjeta mostraba beta 0,62 y "si SPY cae 20% → −12,5%" como ÚNICA medida
 * de daño, mientras la tarjeta de la curva, en la misma pantalla, decía que la caída máxima real había sido
 * 33,6% contra 9,1% del SPY. Las dos cosas eran ciertas: la beta solo mide la parte que se mueve con el
 * mercado, y esta cartera (mineras de cripto, papeles argentinos) se mueve casi toda por lo suyo. Pero la
 * pantalla ponía adelante la tranquilizadora y dejaba la grave en otra tarjeta.
 *
 * Ahora la volatilidad propia va al lado de la beta, y el estrés lineal dice qué proporción del movimiento
 * explica realmente el SPY. Con un R² bajo ese −12,5% no es un techo de pérdida y hay que decirlo ahí mismo.
 */
function Risk({ r, date }: { r: RiskReport; date: string }) {
  // `date` es la fecha de la corrida que produjo este informe: todo lo de esta tarjeta es de ese cierre.
  const top = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v.toFixed(0)}%`).join(" · ");
  const o = r.risk;
  const explicaPoco = o?.r2VsSpy !== null && o?.r2VsSpy !== undefined && o.r2VsSpy < 0.5;
  const vecesSpy = o?.portfolioVolPct && o?.spyVolPct ? o.portfolioVolPct / o.spyVolPct : null;
  return (
    <div className="card">
      <b>Riesgo de cartera</b> <span className="muted">({date})</span>
      <div className="kpis" style={{ marginTop: 8 }}>
        <div className="kpi"><b>${money(r.totalValue)}</b><span>valor al cierre del {date}</span></div>
        <div className="kpi"><b>{f2(r.portfolioBeta)}</b><span>beta vs SPY (63 ruedas)</span></div>
        {o?.portfolioVolPct !== null && o?.portfolioVolPct !== undefined && (
          <div className="kpi"><b className={vecesSpy !== null && vecesSpy > 2 ? "bad" : ""}>{o.portfolioVolPct.toFixed(0)}%</b><span>volatilidad propia{o.spyVolPct !== null && <> · SPY {o.spyVolPct.toFixed(0)}%{vecesSpy !== null && ` (${vecesSpy.toFixed(1)}×)`}</>}</span></div>
        )}
        {o?.worstDayPct !== null && o?.worstDayPct !== undefined && (
          <div className="kpi"><b className="bad">{o.worstDayPct.toFixed(1)}%</b><span>peor rueda de las últimas {o.sessions}</span></div>
        )}
        <div className="kpi"><b className="bad">{pct(r.stressSpyMinus20Pct)}</b><span>si SPY cae 20% (lineal)</span></div>
        <div className="kpi"><b>{r.correlatedPairs.length}</b><span>pares con correlación &gt; 0.7</span></div>
      </div>
      {explicaPoco && (
        <div className="warn" style={{ fontSize: 12, marginTop: 6 }}>
          El SPY explica solo el {Math.round(o!.r2VsSpy! * 100)}% del movimiento de esta cartera: el resto es riesgo propio de cada papel.
          Por eso el −{Math.abs(r.stressSpyMinus20Pct ?? 0).toFixed(1)}% de arriba NO es un techo de pérdida. La cartera puede caer mucho más
          sin que el SPY se mueva, y de hecho ya lo hizo: mirá la caída máxima en la curva, más abajo.
        </div>
      )}
      {r.concentration.warnings.map((w) => <div key={w} className="warn" style={{ marginTop: 6 }}>⚠ {w}</div>)}
      <div style={{ marginTop: 8 }}><b>País:</b> {top(r.concentration.byCountry)}</div>
      <div><b>Industria:</b> {top(r.concentration.byIndustry)}</div>
      {Object.keys(r.concentration.bySector ?? {}).length > 0 && <div><b>Sector:</b> {top(r.concentration.bySector)}</div>}
      {Object.keys(r.concentration.byTheme ?? {}).length > 0 && <div><b>Temas:</b> {top(r.concentration.byTheme)}</div>}
      {r.correlatedPairs.length > 0 && <div><b>Correlacionados:</b> {r.correlatedPairs.map((p) => `${p.a}–${p.b} ${p.corr.toFixed(2)}`).join(" · ")}</div>}
      <Liquidez filas={r.liquidity} />
      {r.notes.map((n) => <div key={n} className="muted">{n}</div>)}
    </div>
  );
}

/** Curva de la cartera real desde las operaciones: TWR, XIRR, volatilidad y drawdown contra SPY, con la lectura por regla. */
function CurveCard({ r }: { r: CurveResponse }) {
  if (r.error) return <div className="card"><b>Curva de la cartera</b> <span className="warn">no se pudo calcular: {r.error}</span></div>;
  const c = r.curve;
  if (!c) return null;
  const p1 = (n: number | null) => (n === null ? "—" : `${n.toFixed(1)}%`);
  const row = (label: string, m: CurveMetrics) => (
    <tr>
      <td>{label}</td>
      <td className={`mono ${cls(m.totalPct)}`}>{pct(m.totalPct)}</td>
      <td className={`mono ${cls(m.annualPct)}`}>{pct(m.annualPct)}</td>
      <td className={`mono ${cls(m.xirrPct)}`}>{pct(m.xirrPct)}</td>
      <td className="mono">{p1(m.volPct)}</td>
      <td className="mono bad">{m.maxDrawdownPct ? `-${m.maxDrawdownPct.toFixed(1)}%` : "0.0%"}</td>
    </tr>
  );
  return (
    <div className="card">
      <b>Curva de la cartera</b>{" "}
      <span className="muted">desde {c.from} · {c.sessions} ruedas · vale {usd(c.valueUsd)} sobre {usd(c.investedUsd)} aportados{c.dividendsUsd ? ` · dividendos ${usd(c.dividendsUsd)}` : ""}{c.complete ? "" : " · incompleta"}</span>
      <div style={{ marginTop: 8 }}>{c.reading}</div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th></th><th>total</th><th>anual (TWR)</th><th>XIRR</th><th>volatilidad</th><th>caída máx.</th></tr></thead>
        <tbody>{row("Tu cartera", c.portfolio)}{row("SPY", c.spy)}</tbody>
      </table>
      {c.sameMoneyInSpy && <div style={{ marginTop: 6 }}>La misma plata puesta en SPY en las mismas fechas valdría hoy <b>{usd(c.sameMoneyInSpy.valueUsd)}</b>; tenés <b>{usd(c.valueUsd)}</b>.</div>}
      <CurveChart points={c.points} />
      {c.warnings.map((w) => <div key={w} className="warn" style={{ marginTop: 6 }}>⚠ {w}</div>)}
      <div className="muted" style={{ marginTop: 6 }}>TWR: retorno ponderado por tiempo, un aporte no cuenta como ganancia; anualizado solo con 60 ruedas o más. XIRR: retorno de tu plata con las fechas reales; el de SPY es la misma plata en las mismas fechas. Caída máxima sobre el índice, no sobre el valor: vender no es caer. SPY sin dividendos.</div>
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


/**
 * Liquidez. El 12/9 esta línea mostraba ocho ceros: todas las posiciones salen en fracciones de rueda
 * (la mayor, PAM, en 0,02 días) y `toFixed(1)` las aplastaba a "0.0". Ocho ceros seguidos no informan que
 * la cartera es líquida: parecen un dato roto, y la regla dura dice que un número que no cambia ninguna
 * decisión no puede estar ahí como si la cambiara.
 *
 * Ahora se dice la conclusión primero y solo se detallan las que tardarían de verdad. El dato crudo sigue
 * disponible en el title de cada símbolo, que es donde tiene sentido mirarlo.
 */
const UMBRAL_DIAS = 0.5;
function Liquidez({ filas }: { filas: RiskReport["liquidity"] }) {
  const conDato = filas.filter((l) => l.daysToLiquidate !== null);
  if (!conDato.length) return <div className="muted" style={{ marginTop: 6 }}>Liquidez: sin volumen para calcularla.</div>;
  const lentas = conDato.filter((l) => l.daysToLiquidate! >= UMBRAL_DIAS).sort((a, b) => b.daysToLiquidate! - a.daysToLiquidate!);
  const peor = conDato.reduce((a, b) => (b.daysToLiquidate! > a.daysToLiquidate! ? b : a));
  const horas = (d: number) => (d >= 1 ? `${d.toFixed(1)} ruedas` : `${Math.max(1, Math.round(d * 6.5 * 60))} min de rueda`);
  return (
    <div className="muted" style={{ marginTop: 6 }}>
      Liquidez: {lentas.length === 0
        ? <>las {conDato.length} posiciones se venden enteras en menos de media rueda vendiendo al 10% del volumen diario. La más lenta es <b>{peor.symbol}</b> ({horas(peor.daysToLiquidate!)}).</>
        : <>{lentas.length} {lentas.length === 1 ? "posición tarda" : "posiciones tardan"} más de media rueda en venderse al 10% del volumen: {lentas.map((l) => `${l.symbol} ${horas(l.daysToLiquidate!)}`).join(" · ")}.</>}
      {" "}
      <span title={conDato.map((l) => `${l.symbol}: ${l.daysToLiquidate!.toFixed(4)} ruedas · volumen medio 30d US$ ${Math.round(l.avgDollarVolume30d ?? 0).toLocaleString("en-US")}`).join("\n")}>ver el detalle</span>
    </div>
  );
}
