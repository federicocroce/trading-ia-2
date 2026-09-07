import { useCallback, useEffect, useState } from "react";
import { api, type Candidate, type CandidateDetail, type ContributionPlan, type RadarMeasurement, type ScanStatus, type TaxonomyOptions } from "./api";
import { TagChips, TagEditor } from "./Tags";

const f2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const AXIS_LABEL: Record<string, string> = { valuation: "valuación", quality: "calidad", growth: "crecimiento", balance: "balance", rs3m: "FR 3m", rs6m: "FR 6m", rs12m: "FR 12m", distSma200Pct: "vs SMA200", atrPct: "ATR%" };

/** Pestaña Radar (spec etapa 2 §12): plan del aporte, candidatos con ficha, ETFs, medición y barrido. */
export function Radar() {
  const [cands, setCands] = useState<Candidate[]>([]);
  const [plan, setPlan] = useState<ContributionPlan | null>(null);
  const [meas, setMeas] = useState<RadarMeasurement | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [opts, setOpts] = useState<TaxonomyOptions | null>(null);
  const [filter, setFilter] = useState<{ verdict: string; sector: string; theme: string; assetClass: string }>({ verdict: "", sector: "", theme: "", assetClass: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter)) if (v) q[k] = v;
    const [c, p, m, s, o] = await Promise.all([api.radar.candidates(q), api.radar.plan(), api.radar.measurement(), api.radar.scanStatus(), api.taxonomy.options()]);
    setCands(c);
    setPlan(p);
    setMeas(m);
    setScan(s);
    setOpts(o);
  }, [filter]);
  useEffect(() => {
    load().catch((e) => setMsg(String(e)));
  }, [load]);
  useEffect(() => {
    if (!scan?.running) return;
    const t = setInterval(() => api.radar.scanStatus().then(setScan).catch(() => null), 5000);
    return () => clearInterval(t);
  }, [scan?.running]);

  async function act(label: string, fn: () => Promise<string>) {
    setBusy(label);
    setMsg(null);
    try {
      setMsg(await fn());
      await load();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
    }
  }
  const stocks = cands.filter((c) => c.kind === "stock");
  const etfs = cands.filter((c) => c.kind === "etf");
  const date = cands[0]?.candidateDate;

  return (
    <>
      <div className="card row">
        <b>Radar</b>
        <span className="muted">{date ? `candidatos del ${date}` : "sin candidatos todavía: barré el universo y rankeá"}</span>
        <div style={{ flex: 1 }} />
        <button className="ghost" disabled={!!busy || !!scan?.running} onClick={() => act("scan", async () => { await api.radar.scan(); setScan(await api.radar.scanStatus()); return "Barrido iniciado en segundo plano (≈1 h). Podés seguir usando la app."; })}>Barrer universo</button>
        <button className="ghost" disabled={!!busy} onClick={() => act("rank", async () => { const r = await api.radar.rank(); return `Ranking: ${r.candidates.length} candidatos, ${r.errors.length} errores.`; })}>{busy === "rank" ? "Rankeando…" : "Rankear"}</button>
        <button className="ghost" disabled={!!busy} onClick={() => act("refresh", async () => `Refrescados ${(await api.radar.refresh()).refreshed} candidatos.`)}>Refrescar</button>
        <button className="primary" disabled={!!busy} onClick={() => act("plan", async () => `Plan ${(await api.radar.buildPlan()).month} regenerado.`)}>Regenerar plan</button>
      </div>
      {msg && <div className="card">{msg}</div>}
      {scan && (scan.running || scan.last) && (
        <div className="card">
          <div className="row">
            <b>Barrido del universo</b>
            {scan.running ? <span className="muted">corriendo desde {scan.startedAt ? new Date(scan.startedAt).toLocaleTimeString() : "—"} · {scan.progress ? `${scan.progress.stage} ${scan.progress.done}/${scan.progress.total}` : "listando…"}</span> : <span className="muted">último: {scan.last ? `${scan.last.listed} listados · ${scan.last.prefiltered} pre-filtro · ${scan.last.fundamentalsOk} con fundamentals · ${scan.last.excluded} excluidos · ${scan.last.errors} errores${scan.last.stopped ? " · detenido" : ""}` : "—"}</span>}
            {scan.running && <button className="ghost" onClick={() => api.radar.stopScan().then(() => api.radar.scanStatus()).then(setScan)}>Detener</button>}
          </div>
          {scan.running && scan.progress && <div className="progress" style={{ marginTop: 6 }}><div style={{ width: `${Math.min(100, (100 * scan.progress.done) / Math.max(1, scan.progress.total))}%` }} /></div>}
          {scan.status && <div className="muted mono" style={{ marginTop: 6 }}>{Object.entries(scan.status).map(([k, v]) => `${k} ${v}`).join(" · ")}</div>}
        </div>
      )}
      {plan && <PlanCard p={plan} />}
      {opts && (
        <div className="card form-row">
          <span className="muted">Filtrar:</span>
          <select value={filter.verdict} onChange={(e) => setFilter({ ...filter, verdict: e.target.value })}><option value="">verdict</option>{["COMPRAR", "OBSERVAR", "NUCLEO"].map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.assetClass} onChange={(e) => setFilter({ ...filter, assetClass: e.target.value })}><option value="">clase</option>{opts.assetClasses.map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.sector} onChange={(e) => setFilter({ ...filter, sector: e.target.value })}><option value="">sector</option>{opts.sectors.map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.theme} onChange={(e) => setFilter({ ...filter, theme: e.target.value })}><option value="">tema</option>{opts.themes.map((v) => <option key={v}>{v}</option>)}</select>
        </div>
      )}
      <div className="card" style={{ overflowX: "auto" }}>
        <b>Acciones candidatas</b> <span className="muted">({stocks.length})</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>símbolo</th><th>veredicto</th><th>score</th><th>rank</th><th>precio</th><th>entrada</th><th>stop</th><th>objetivo</th><th>tamaño</th><th>riesgo</th><th>etiquetas</th><th></th></tr></thead>
          <tbody>
            {stocks.map((c) => (
              <CandRow key={c.symbol} c={c} open={open === c.symbol} onToggle={() => setOpen(open === c.symbol ? null : c.symbol)} editing={editing === c.symbol} onEdit={() => setEditing(editing === c.symbol ? null : c.symbol)} onSaved={load} />
            ))}
            {!stocks.length && <tr><td colSpan={12} className="muted">Sin acciones candidatas para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <b>ETFs</b> <span className="muted">({etfs.length})</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>símbolo</th><th>veredicto</th><th>FR 3m</th><th>FR 6m</th><th>FR 12m</th><th>vs SMA200</th><th>precio</th><th>stop</th><th>objetivo</th><th>etiquetas</th><th></th></tr></thead>
          <tbody>
            {etfs.map((c) => (
              <tr key={c.symbol}>
                <td><b>{c.symbol}</b></td>
                <td><span className={`verb ${c.verdict}`}>{c.verdict}</span> {c.flags.length > 0 && <span className="flag">{c.flags.join(" · ")}</span>}</td>
                <td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td>
                <td className="mono">{f2(c.close)}</td><td className="mono">{f2(c.stop)}</td><td className="mono">{f2(c.target)}</td>
                <td><TagChips tags={c.tags} /></td>
                <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {meas && <MeasCard m={meas} />}
    </>
  );
}

function CandRow({ c, open, onToggle, editing, onEdit, onSaved }: { c: Candidate; open: boolean; onToggle: () => void; editing: boolean; onEdit: () => void; onSaved: () => Promise<void> }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  useEffect(() => {
    if (open && !detail) api.radar.candidate(c.symbol).then(setDetail).catch(() => null);
  }, [open, detail, c.symbol]);
  return (
    <>
      <tr>
        <td><b>{c.symbol}</b>{c.nthAppearance > 1 && <span className="muted"> ×{c.nthAppearance}</span>}</td>
        <td><span className={`verb ${c.verdict}`}>{c.verdict}</span></td>
        <td className="mono">{f2(c.score)}</td>
        <td className="mono">{c.rankInGroup ?? "—"}/{c.groupSize ?? "—"}</td>
        <td className="mono">{f2(c.close)}</td>
        <td className="mono">{f2(c.entryLow)}–{f2(c.entryHigh)}</td>
        <td className="mono">{f2(c.stop)}</td>
        <td className="mono">{f2(c.target)}</td>
        <td className="mono">{c.sizeQty ?? "—"} · {money(c.sizeUsd)}</td>
        <td className="mono">{c.riskScore ?? "—"}/10</td>
        <td><TagChips tags={c.tags} /></td>
        <td style={{ whiteSpace: "nowrap" }}><button className="ghost" onClick={onToggle}>{open ? "Cerrar" : "Ver"}</button> <button className="ghost" onClick={onEdit}>Etiquetas</button></td>
      </tr>
      {editing && <tr><td colSpan={12}><TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { onEdit(); void onSaved(); }} onCancel={onEdit} /></td></tr>}
      {open && (
        <tr>
          <td colSpan={12}>
            {c.flags.length > 0 && <div>{c.flags.map((f) => <span key={f} className="flag">⚑ {f}</span>)}</div>}
            {c.summary && <div style={{ marginTop: 6 }}><b>Qué hace:</b> {c.summary}</div>}
            {c.whyRanks && <div><b>Por qué rankea:</b> {c.whyRanks}</div>}
            {c.mainRisk && <div><b>Riesgo principal:</b> {c.mainRisk}</div>}
            {c.moat && <div><b>Foso:</b> {c.moat}{c.degradedBy && <span className="warn"> · el modelo degradó el veredicto</span>}</div>}
            <div className="muted mono" style={{ marginTop: 6 }}>ejes (z vs pares): {Object.entries(c.axes).map(([k, v]) => `${AXIS_LABEL[k] ?? k} ${f2(v)}`).join(" · ")}</div>
            {detail && (
              <>
                {detail.fundamentals && (
                  <div className="muted mono" style={{ marginTop: 6 }}>
                    cap. {money(detail.fundamentals.mcapUsd)} · volumen {money(detail.fundamentals.dollarVolumeUsd)}/día · próximos resultados {detail.fundamentals.nextEarnings ?? "—"} · insiders 90d compras {detail.fundamentals.insiderBuys90d ?? "—"} / ventas {detail.fundamentals.insiderSells90d ?? "—"}
                    {detail.fundamentals.analyst && ` · analistas: ${detail.fundamentals.analyst.strongBuy + detail.fundamentals.analyst.buy} compran, ${detail.fundamentals.analyst.hold} mantienen, ${detail.fundamentals.analyst.sell + detail.fundamentals.analyst.strongSell} venden`}
                    {detail.fundamentals.earningsSurprises?.length ? ` · sorpresas: ${detail.fundamentals.earningsSurprises.map((s) => `${s.period.slice(0, 7)} ${pct(s.surprisePercent)}`).join(", ")}` : ""}
                  </div>
                )}
                {detail.peers.length > 0 && (
                  <table style={{ marginTop: 8 }}>
                    <thead><tr><th>par</th><th>P/E</th><th>EV/EBITDA</th><th>P/S</th><th>ROE</th><th>margen op.</th><th>crec. ingresos</th><th>deuda/patr.</th></tr></thead>
                    <tbody>
                      {[{ symbol: `${c.symbol} (propia)`, metrics: detail.fundamentals?.metrics ?? {} }, ...detail.peers].map((p) => (
                        <tr key={p.symbol}><td>{p.symbol}</td><td className="mono">{f2(p.metrics["peTTM"], 1)}</td><td className="mono">{f2(p.metrics["evEbitdaTTM"], 1)}</td><td className="mono">{f2(p.metrics["psTTM"], 1)}</td><td className="mono">{f2(p.metrics["roeTTM"], 1)}</td><td className="mono">{f2(p.metrics["operatingMarginTTM"], 1)}</td><td className="mono">{f2(p.metrics["revenueGrowthTTMYoy"], 1)}</td><td className="mono">{f2(p.metrics["totalDebt/totalEquityAnnual"])}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function PlanCard({ p }: { p: ContributionPlan }) {
  return (
    <div className="card">
      <b>Plan del aporte {p.month}</b> <span className="muted">{money(p.totalUsd)}</span>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>símbolo</th><th>tipo</th><th>monto</th><th>por qué</th><th>alpha 30d</th><th>alpha 90d</th></tr></thead>
        <tbody>
          {p.lines.map((l, i) => <tr key={i}><td><b>{l.symbol}</b></td><td><span className="chip">{l.kind}</span></td><td className="mono">{money(l.amountUsd)}</td><td>{l.rationale}</td><td className="mono">{pct(l.alpha30dPct)}</td><td className="mono">{pct(l.alpha90dPct)}</td></tr>)}
        </tbody>
      </table>
      {p.notes.map((n) => <div key={n} className="muted" style={{ marginTop: 4 }}>{n}</div>)}
    </div>
  );
}

function MeasCard({ m }: { m: RadarMeasurement }) {
  const cell = (b: { n: number; avgAlpha: number | null; hitRate: number | null }) => (b.n ? `${b.n} · ${pct(b.avgAlpha)}${b.hitRate === null ? "" : ` · ${(b.hitRate * 100).toFixed(0)}%`}` : "—");
  const diff = (h: "h7" | "h30" | "h90") => { const d = m.comprarVsObservar[h]; return d.diff === null ? "—" : `${pct(d.diff)} (n ${d.nComprar}/${d.nObservar})`; };
  return (
    <div className="card">
      <b>Medición contra SPY</b> <span className="muted">{m.total} apariciones, {m.pending} pendientes de medir</span>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>veredicto</th><th>7 días (n · alpha · acierto)</th><th>30 días</th><th>90 días</th></tr></thead>
        <tbody>
          {Object.entries(m.byVerdict).map(([v, b]) => <tr key={v}><td><span className={`verb ${v}`}>{v}</span></td><td className="mono">{cell(b.h7)}</td><td className="mono">{cell(b.h30)}</td><td className="mono">{cell(b.h90)}</td></tr>)}
          <tr><td><b>COMPRAR − OBSERVAR</b></td><td className="mono">{diff("h7")}</td><td className="mono">{diff("h30")}</td><td className="mono">{diff("h90")}</td></tr>
        </tbody>
      </table>
      <div className="muted" style={{ marginTop: 6 }}>OBSERVAR es el grupo de control: si COMPRAR no le gana, los filtros no agregan valor. Los NUCLEO no se eligen; se compran por calendario.</div>
    </div>
  );
}
