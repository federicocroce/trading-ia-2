import { useCallback, useEffect, useState } from "react";
import { api, type ArgentinaData, type Candidate, type PlanLine, type Watchlist, type CandidateDetail, type ContributionPlan, type MacroAr, type RadarMeasurement, type RadarTop, type ScanStatus, type TaxonomyOptions } from "./api";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";
import { HELP, RadarHelpModal, Th } from "./RadarHelp";
import { SymbolSearch } from "./SymbolSearch";
import { flagLabel } from "./flags";
import { VerificationSections } from "./Verification";

const HELP_CONVICCION = HELP["conviccion"]!.short;

const f2 = (n: number | null | undefined, d = 2) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : n.toFixed(d));
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
const AXIS_LABEL: Record<string, string> = { valuation: "valuación", quality: "calidad", growth: "crecimiento", balance: "balance", rs3m: "FR 3m", rs6m: "FR 6m", rs12m: "FR 12m", distSma200Pct: "vs SMA200", atrPct: "ATR%" };

/** Sub-pestañas del Radar, cada una con su URL (`?tab=radar&sub=etfs`). */
const SUBS = [["resumen", "Resumen"], ["acciones", "Acciones US"], ["seguimiento", "Seguimiento"], ["etfs", "ETFs"], ["argentina", "Argentina"], ["medicion", "Medición"]] as const;
type Sub = (typeof SUBS)[number][0];
const readSub = (): Sub => {
  const v = new URLSearchParams(window.location.search).get("sub");
  return SUBS.some(([k]) => k === v) ? (v as Sub) : "resumen";
};

/** Pestaña Radar (spec etapa 2 §12): plan del aporte, candidatos con ficha, ETFs, medición y barrido. */
export function Radar() {
  const [sub, setSub] = useState<Sub>(readSub);
  useEffect(() => {
    const onPop = () => setSub(readSub());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const goSub = (k: Sub) => {
    const url = new URL(window.location.href);
    url.searchParams.set("sub", k);
    if (url.href !== window.location.href) window.history.pushState({}, "", url);
    setSub(k);
  };
  const [cands, setCands] = useState<Candidate[]>([]);
  const [plan, setPlan] = useState<ContributionPlan | null>(null);
  const [top, setTop] = useState<RadarTop | null>(null);
  const [ar, setAr] = useState<ArgentinaData | null>(null);
  const [watch, setWatch] = useState<Watchlist | null>(null);
  const [meas, setMeas] = useState<RadarMeasurement | null>(null);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [opts, setOpts] = useState<TaxonomyOptions | null>(null);
  const [filter, setFilter] = useState<{ verdict: string; sector: string; theme: string; assetClass: string }>({ verdict: "", sector: "", theme: "", assetClass: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    const q: Record<string, string> = {};
    for (const [k, v] of Object.entries(filter)) if (v) q[k] = v;
    const [c, p, m, s, o, t, a, w] = await Promise.all([api.radar.candidates(q), api.radar.plan(), api.radar.measurement(), api.radar.scanStatus(), api.taxonomy.options(), api.radar.top(5), api.radar.argentina(), api.radar.watchlist()]);
    setCands(c);
    setPlan(p);
    setTop(t);
    setAr(a);
    setWatch(w);
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
        <button className="ghost" disabled={!!busy} onClick={() => act("argentina", async () => { const r = await api.radar.refreshArgentina(); return `Argentina: ${r.acciones} acciones, ${r.cedears} CEDEARs, ${r.errors.length} errores.`; })}>{busy === "argentina" ? "Argentina…" : "Refrescar Argentina"}</button>
        <button className="primary" disabled={!!busy} onClick={() => act("plan", async () => `Plan ${(await api.radar.buildPlan()).month} regenerado.`)}>Regenerar plan</button>
      </div>
      {msg && <div className="card">{msg}</div>}
      <div className="card row" style={{ gap: 8 }}>
        <div className="seg">
          {SUBS.map(([k, label]) => {
            const n = k === "acciones" ? stocks.length : k === "seguimiento" ? watch?.items.length : k === "etfs" ? etfs.length : k === "argentina" ? ar?.acciones.length : undefined;
            return <button key={k} className={sub === k ? "active" : ""} onClick={() => goSub(k)}>{label}{n !== undefined ? ` (${n})` : ""}</button>;
          })}
        </div>
        <div style={{ flex: 1 }} />
        <button className="ghost" onClick={() => setHelp(true)}>¿Qué significa cada columna?</button>
        {help && <RadarHelpModal onClose={() => setHelp(false)} />}
      </div>
      {scan && (scan.running || (scan.last && sub === "acciones")) && (
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
      {sub === "resumen" && top && <TopPicks t={top} plan={plan} />}
      {sub === "resumen" && plan && <PlanCard p={plan} busy={busy === "plan"} onBuild={async (amountUsd) => { await act("plan", async () => { const np = await api.radar.buildPlan(amountUsd); setPlan(np); return `Plan ${np.month} armado para ${money(np.totalUsd)}.`; }); }} />}
      {sub === "acciones" && opts && (
        <div className="card form-row">
          <span className="muted">Filtrar:</span>
          <select value={filter.verdict} onChange={(e) => setFilter({ ...filter, verdict: e.target.value })}><option value="">verdict</option>{["COMPRAR", "OBSERVAR", "NUCLEO"].map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.assetClass} onChange={(e) => setFilter({ ...filter, assetClass: e.target.value })}><option value="">clase</option>{opts.assetClasses.map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.sector} onChange={(e) => setFilter({ ...filter, sector: e.target.value })}><option value="">sector</option>{opts.sectors.map((v) => <option key={v}>{v}</option>)}</select>
          <select value={filter.theme} onChange={(e) => setFilter({ ...filter, theme: e.target.value })}><option value="">tema</option>{opts.themes.map((v) => <option key={v}>{v}</option>)}</select>
        </div>
      )}
      {sub === "acciones" && <div className="card" style={{ overflowX: "auto" }}>
        <b>Acciones candidatas</b> <span className="muted">({stocks.length})</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><Th k="simbolo" /><Th k="veredicto" /><Th k="score" /><Th k="rank" /><Th k="precio" /><Th k="entrada" /><Th k="stop" /><Th k="objetivo" /><Th k="tamano" /><Th k="riesgo" /><Th k="etiquetas" /><th></th></tr></thead>
          <tbody>
            {stocks.map((c) => (
              <CandRow key={c.symbol} c={c} open={open === c.symbol} onToggle={() => setOpen(open === c.symbol ? null : c.symbol)} editing={editing === c.symbol} onEdit={() => setEditing(editing === c.symbol ? null : c.symbol)} onSaved={load} />
            ))}
            {!stocks.length && <tr><td colSpan={12} className="muted">Sin acciones candidatas para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>}
      {sub === "etfs" && <div className="card" style={{ overflowX: "auto" }}>
        <b>ETFs</b> <span className="muted">({etfs.length})</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><Th k="simbolo" /><Th k="veredicto" /><Th k="fr3m" /><Th k="fr6m" /><Th k="fr12m" /><Th k="sma200" /><Th k="precio" /><Th k="stop" /><Th k="objetivo" /><Th k="etiquetas" /><th></th></tr></thead>
          <tbody>
            {etfs.map((c) => (
              <tr key={c.symbol}>
                <td><SymbolLink symbol={c.symbol} /></td>
                <td><span className={`verb ${c.verdict}`}>{c.verdict}</span> {c.flags.length > 0 && <span className="flag">{c.flags.map(flagLabel).join(" · ")}</span>}</td>
                <td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td>
                <td className="mono">{f2(c.close)}</td><td className="mono">{f2(c.stop)}</td><td className="mono">{f2(c.target)}</td>
                <td><TagChips tags={c.tags} /></td>
                <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {sub === "seguimiento" && watch && <WatchCard w={watch} setWatch={setWatch} editing={editing} setEditing={setEditing} reload={load} />}
      {sub === "argentina" && ar && <ArgentinaCard d={ar} editing={editing} setEditing={setEditing} reload={load} />}
      {sub === "medicion" && meas && <MeasCard m={meas} />}
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
        <td><SymbolLink symbol={c.symbol} />{c.nthAppearance > 1 && <span className="muted"> ×{c.nthAppearance}</span>}</td>
        <td><span className={`verb ${c.verdict}`}>{c.verdict}</span></td>
        <td className="mono">{f2(c.score)}</td>
        <td className="mono">{c.rankInGroup ?? "—"}/{c.groupSize ?? "—"}</td>
        <td className="mono">{f2(c.close)}</td>
        <td className="mono">{f2(c.entryLow)}–{f2(c.entryHigh)}</td>
        <td className="mono">{f2(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
        <td className="mono">{f2(c.target)}{c.target !== null && <span className={c.target > c.close ? "ok" : "bad"}> {pct(((c.target - c.close) / c.close) * 100)}</span>}</td>
        <td className="mono">{c.sizeQty ?? "—"} · {money(c.sizeUsd)}</td>
        <td className="mono">{c.riskScore ?? "—"}/10</td>
        <td><TagChips tags={c.tags} /></td>
        <td style={{ whiteSpace: "nowrap" }}><button className="ghost" onClick={onToggle}>{open ? "Cerrar" : "Ver"}</button> <button className="ghost" onClick={onEdit}>Etiquetas</button></td>
      </tr>
      {editing && <tr><td colSpan={12}><TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { onEdit(); void onSaved(); }} onCancel={onEdit} /></td></tr>}
      {open && (
        <tr>
          <td colSpan={12}>
            {c.flags.length > 0 && <div>{c.flags.map((f) => <span key={f} className="flag">⚑ {flagLabel(f)}</span>)}</div>}
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
                <VerificationSections statements={detail.statements} events={detail.events} analystActions={detail.analystActions} analystTargets={c.analystTargets} close={c.close} metricsRaw={detail.fundamentals?.metricsRaw} />
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

/** Los COMPRAR con más convicción: cada factor que el Radar ya calculó, en palabras, con lo que acompaña y lo que no. */
function TopPicks({ t, plan }: { t: RadarTop; plan: ContributionPlan | null }) {
  const nucleo = plan?.lines.filter((l) => l.kind === "nucleo") ?? [];
  const nucleoUsd = nucleo.reduce((s, l) => s + l.amountUsd, 0);
  return (
    <div className="card">
      <b>Lo que más recomienda hoy</b> <span className="muted">{t.date ? `candidatos del ${t.date}` : ""} · convicción = fundamentals contra pares × tamaño del grupo, más banderas, menos riesgo y concentración</span>
      {plan && nucleo.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <span className="verb NUCLEO">NUCLEO</span> Antes que cualquier acción, el plan de {plan.month} manda {money(nucleoUsd)} de {money(plan.totalUsd)} al núcleo ({nucleo.map((l) => l.symbol).join(", ")}): {nucleo[0]?.rationale}.
        </div>
      )}
      {Object.keys(t.overweight).length > 0 && <div className="muted" style={{ marginTop: 4 }}>Ya estás cargado en: {Object.entries(t.overweight).map(([k, v]) => `${k} ${v.toFixed(1)}%`).join(", ")}. Los candidatos de esos temas suman menos.</div>}
      {t.picks.length === 0 ? <div className="muted" style={{ marginTop: 8 }}>Ningún COMPRAR califica todavía.</div> : (
        <div className="picks">
          {t.picks.map((p, i) => (
            <div key={p.symbol} className={`pick ${p.allAligned ? "aligned" : ""}`}>
              <div className="row" style={{ alignItems: "baseline" }}>
                <span className="muted mono">{i + 1}.</span>
                <SymbolLink symbol={p.symbol}><b style={{ fontSize: 18, fontFamily: "ui-monospace, Menlo, monospace" }}>{p.symbol}</b></SymbolLink>
                <span className="mono muted help" title={HELP_CONVICCION}>convicción {p.conviction.toFixed(2)}</span>
                {p.allAligned ? <span className="verb COMPRAR">todo acompaña</span> : <span className="verb OBSERVAR">con salvedades</span>}
                <div style={{ flex: 1 }} />
                <span className="mono"><span className="ok">{pct(p.gainPct)}</span> / <span className="bad">{pct(p.lossPct)}</span></span>
              </div>
              {p.summary && <div className="muted" style={{ marginTop: 4 }}>{p.summary}</div>}
              <ul className="why">{p.reasons.map((r) => <li key={r} className="ok">✓ {r}</li>)}{p.cautions.map((r) => <li key={r} className="warn">⚠ {r}</li>)}</ul>
              <div className="muted mono" style={{ marginTop: 4 }}>entrar hasta {f2(p.entryHigh)} · stop {f2(p.stop)} · objetivo {f2(p.target)} · tamaño {p.sizeQty ?? "—"} ({money(p.sizeUsd)})</div>
              {p.mainRisk && <div className="muted" style={{ marginTop: 2 }}><b>Riesgo principal:</b> {p.mainRisk}</div>}
            </div>
          ))}
        </div>
      )}
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>El objetivo no es un pronóstico: es el precio donde la operación paga 2 veces lo que arriesga hasta el stop. Si el score anticipa algo lo va a decir la medición contra SPY a 7/30/90 días.</div>
    </div>
  );
}

const ars = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("es-AR", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`);
const delta = (cur: number | null, prev: number | null | undefined) => (cur !== null && prev !== null && prev !== undefined && prev !== 0 ? (cur / prev - 1) * 100 : null);
const CEDEAR_FLAG: Record<string, string> = { en_linea: "en línea", caro_vs_ccl: "caro vs CCL", barato_vs_ccl: "barato vs CCL", ratio_dudoso: "ratio dudoso" };

/** Lista de seguimiento: tickers elegidos a mano con las mismas reglas que un candidato. */
function WatchCard({ w, setWatch, editing, setEditing, reload }: { w: Watchlist; setWatch: (w: Watchlist) => void; editing: string | null; setEditing: (s: string | null) => void; reload: () => Promise<void> }) {
  const [err, setErr] = useState<string | null>(null);
  const rows = [...w.rows].sort((a, b) => (a.verdict === b.verdict ? (b.score ?? -Infinity) - (a.score ?? -Infinity) : a.verdict === "COMPRAR" ? -1 : 1));
  const rowFor = new Map(rows.map((r) => [r.symbol, r]));
  const withoutRow = w.items.filter((i) => !rowFor.has(i.symbol)).map((i) => i.symbol);
  async function remove(s: string) {
    setWatch(await api.radar.removeWatch(s));
  }
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="row">
        <b>Seguimiento</b> <span className="muted help" title={HELP["seguimiento"]!.short}>({w.items.length}) tus tickers, con las reglas del Radar aunque el ranking no los elija</span>
        <div style={{ flex: 1 }} />
        <div style={{ width: 340 }}><SymbolSearch existing={new Set(w.items.map((i) => i.symbol))} onAdd={async (s) => { setErr(null); try { setWatch(await api.radar.addWatch(s)); window.dispatchEvent(new Event("watchlist:changed")); } catch (e) { setErr(String(e)); } }} /></div>
      </div>
      {err && <div className="err">{err}</div>}
      {withoutRow.length > 0 && <div className="muted" style={{ marginTop: 6 }}>Sin datos todavía: {withoutRow.join(", ")} (se completan en el próximo refresco).</div>}
      <table style={{ marginTop: 8 }}>
        <thead><tr><Th k="simbolo" /><Th k="veredicto" /><Th k="score" /><Th k="rank" /><Th k="precio" /><Th k="entrada" /><Th k="stop" /><Th k="objetivo" /><Th k="tamano" /><Th k="riesgo" /><Th k="etiquetas" /><th></th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.symbol}>
              <td><SymbolLink symbol={c.symbol} />{c.nthAppearance > 1 && <span className="muted"> ×{c.nthAppearance}</span>}</td>
              <td><span className={`verb ${c.verdict}`}>{c.verdict}</span> {c.flags.length > 0 && <span className="flag">{c.flags.map(flagLabel).join(" · ")}</span>}</td>
              <td className="mono">{c.score === null ? <span className="muted" title="No está en el universo del Radar (o no pasó el quality bar): sin rank contra pares.">—</span> : f2(c.score)}</td>
              <td className="mono">{c.rankInGroup !== null ? `${c.rankInGroup}/${c.groupSize}` : "—"}</td>
              <td className="mono">{f2(c.close)}</td>
              <td className="mono">{c.entryLow !== null ? `${f2(c.entryLow)}–${f2(c.entryHigh)}` : "—"}</td>
              <td className="mono">{f2(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
              <td className="mono">{f2(c.target)}{c.target !== null && <span className={c.target > c.close ? "ok" : "bad"}> {pct(((c.target - c.close) / c.close) * 100)}</span>}</td>
              <td className="mono">{c.sizeQty ?? "—"}{c.sizeUsd !== null && <span className="muted"> · {money(c.sizeUsd)}</span>}</td>
              <td className="mono">{c.riskScore !== null ? `${c.riskScore}/10` : "—"}</td>
              <td><TagChips tags={c.tags} /></td>
              <td className="row" style={{ gap: 4 }}>
                <button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>
                <button className="ghost" title="Sacar de la lista" onClick={() => void remove(c.symbol)}>Quitar</button>
                {editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} />}
              </td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={12} className="muted">Todavía no seguís ningún ticker. Agregá uno arriba.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Argentina (etapa 3): macro del día, acciones de BYMA contra el Merval y CEDEARs contra el CCL. */
function ArgentinaCard({ d, editing, setEditing, reload }: { d: ArgentinaData; editing: string | null; setEditing: (s: string | null) => void; reload: () => Promise<void> }) {
  const m = d.macro;
  const prev: MacroAr | undefined = d.series.length >= 2 ? d.series[d.series.length - 2] : undefined;
  const acciones = [...d.acciones].sort((a, b) => (a.verdict === b.verdict ? (b.axes["rs6m"] ?? -Infinity) - (a.axes["rs6m"] ?? -Infinity) : a.verdict === "COMPRAR" ? -1 : 1));
  const dCcl = delta(m?.ccl ?? null, prev?.ccl);
  const dRp = delta(m?.riesgoPais ?? null, prev?.riesgoPais);
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <b>Argentina</b> <span className="muted">{m ? `macro del ${m.date}` : "sin datos: apretá Refrescar Argentina"}</span>
      {m && (
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><b>{ars(m.ccl)}</b><span>dólar CCL{dCcl !== null && <> · <span className={dCcl > 0 ? "bad" : "ok"}>{pct(dCcl)}</span></>}</span></div>
          <div className="kpi"><b>{ars(m.mep)}</b><span>MEP</span></div>
          <div className="kpi"><b>{ars(m.oficial)}</b><span>oficial</span></div>
          <div className="kpi"><b>{pct(m.brechaPct)}</b><span>brecha CCL / oficial</span></div>
          <div className="kpi"><b>{ars(m.blue)}</b><span>blue</span></div>
          <div className="kpi"><b>{m.riesgoPais ?? "—"}</b><span>riesgo país{dRp !== null && <> · <span className={dRp > 0 ? "bad" : "ok"}>{pct(dRp)}</span></>}</span></div>
          <div className="kpi"><b>{m.mervalUsd !== null ? `US$ ${m.mervalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</b><span>Merval en dólares</span></div>
        </div>
      )}
      <div style={{ marginTop: 12 }}><b>Acciones de BYMA</b> <span className="muted">({acciones.length}) contra el Merval, en pesos</span></div>
      <table style={{ marginTop: 6 }}>
        <thead><tr><Th k="simbolo" /><Th k="adr" /><Th k="veredicto" /><Th k="fr3m">FR 3m</Th><Th k="frMerval">FR 6m</Th><Th k="fr12m">FR 12m</Th><Th k="sma200" /><Th k="precioArs" /><Th k="precioUsd" /><Th k="stop" /><Th k="objetivo" /><Th k="etiquetas" /><th></th></tr></thead>
        <tbody>
          {acciones.map((c) => (
            <tr key={c.symbol}>
              <td><SymbolLink symbol={c.symbol} /></td>
              <td>{c.peerGroup[0] ? <SymbolLink symbol={c.peerGroup[0]} /> : <span className="muted">—</span>}</td>
              <td><span className={`verb ${c.verdict}`}>{c.verdict}</span> {c.flags.length > 0 && <span className="flag">{c.flags.map(flagLabel).join(" · ")}</span>}</td>
              <td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td>
              <td className="mono">{ars(c.close)}</td><td className="mono">{c.axes["closeUsd"] !== null && c.axes["closeUsd"] !== undefined ? `US$ ${c.axes["closeUsd"].toFixed(2)}` : "—"}</td>
              <td className="mono">{ars(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
              <td className="mono">{ars(c.target)}{c.target !== null && <span className={c.target > c.close ? "ok" : "bad"}> {pct(((c.target - c.close) / c.close) * 100)}</span>}</td>
              <td><TagChips tags={c.tags} /></td>
              <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} />}</td>
            </tr>
          ))}
          {!acciones.length && <tr><td colSpan={13} className="muted">Sin acciones argentinas todavía.</td></tr>}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}><b>CEDEARs</b> <span className="muted">({d.cedears.length}) a qué dólar comprás la acción de EE.UU. si la comprás en pesos</span></div>
      <table style={{ marginTop: 6 }}>
        <thead><tr><Th k="simbolo" /><th>acción US</th><Th k="ratio" /><Th k="precioArs" /><Th k="dolarImplicito" /><Th k="vsCcl" /><th>señal</th><th>equivale en US$</th><th>precio US real</th></tr></thead>
        <tbody>
          {d.cedears.map((c) => {
            const gap = c.axes["gapPct"];
            const flag = c.flags[0] ?? "";
            return (
              <tr key={c.symbol}>
                <td><SymbolLink symbol={c.symbol} /></td>
                <td>{c.peerGroup[0] ? <SymbolLink symbol={c.peerGroup[0]} /> : "—"}</td>
                <td className="mono">{c.axes["ratio"] ?? "—"}</td>
                <td className="mono">{ars(c.close)}</td>
                <td className="mono">{ars(c.axes["impliedCcl"])}</td>
                <td className={`mono ${gap !== null && gap !== undefined ? (Math.abs(gap) > 10 ? "warn" : gap > 2 ? "bad" : gap < -2 ? "ok" : "muted") : ""}`}>{pct(gap)}</td>
                <td><span className={`chip ${flag === "ratio_dudoso" ? "warn" : ""}`}>{CEDEAR_FLAG[flag] ?? flag}</span></td>
                <td className="mono">{c.axes["priceUsd"] !== null && c.axes["priceUsd"] !== undefined ? `US$ ${c.axes["priceUsd"].toFixed(2)}` : "—"}</td>
                <td className="mono">{c.axes["usClose"] !== null && c.axes["usClose"] !== undefined ? `US$ ${c.axes["usClose"].toFixed(2)}` : "—"}</td>
              </tr>
            );
          })}
          {!d.cedears.length && <tr><td colSpan={9} className="muted">Sin CEDEARs todavía.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

/** Plan del aporte: con el aporte del mes o con el monto que tengas líquido. Muestra el ticket para ejecutar. */
type PlanSort = "prioridad" | "conviccion" | "objetivo";
const PLAN_SORT_LABEL: Record<PlanSort, string> = { prioridad: "prioridad de compra", conviccion: "convicción", objetivo: "% al objetivo" };
const readPlanSort = (): PlanSort => { try { const v = localStorage.getItem("plan.sort"); return v === "conviccion" || v === "objetivo" ? v : "prioridad"; } catch { return "prioridad"; } };
const gainPct = (l: PlanLine) => (l.target && l.close ? (l.target / l.close - 1) * 100 : null);
function sortPlanLines(lines: PlanLine[], sort: PlanSort): PlanLine[] {
  if (sort === "prioridad") return lines;
  const KIND_ORDER: Record<PlanLine["kind"], number> = { comprar: 0, seguimiento: 1, sumar: 2, nucleo: 3 };
  const key = sort === "conviccion" ? (l: PlanLine) => l.priority ?? null : gainPct;
  return [...lines].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka !== null && kb !== null && ka !== kb) return kb - ka;
    if ((ka === null) !== (kb === null)) return ka === null ? 1 : -1;
    return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

function PlanCard({ p, onBuild, busy }: { p: ContributionPlan; onBuild: (amountUsd: number) => Promise<void>; busy: boolean }) {
  const [amount, setAmount] = useState<string>(String(p.totalUsd));
  const [sort, setSort] = useState<PlanSort>(readPlanSort);
  const changeSort = (s: PlanSort) => { setSort(s); try { localStorage.setItem("plan.sort", s); } catch { /* sin almacenamiento: no pasa nada */ } };
  const lines = sortPlanLines(p.lines, sort);
  const qty = (l: PlanLine) => (l.close ? Math.floor(l.amountUsd / l.close) : null);
  const KIND: Record<PlanLine["kind"], string> = { nucleo: "núcleo", sumar: "sumar", comprar: "comprar", seguimiento: "seguimiento" };
  const risk = p.lines.reduce((s, l) => s + (l.stop && l.close && l.stop < l.close ? (qty(l) ?? 0) * (l.close - l.stop) : 0), 0);
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="row">
        <b>Plan del aporte {p.month}</b> <span className="muted">{money(p.totalUsd)}</span>
        <div style={{ flex: 1 }} />
        <span className="muted">Ordenar por</span>
        <select value={sort} onChange={(e) => changeSort(e.target.value as PlanSort)} title="Prioridad de compra: el orden en que el sistema asigna la plata (núcleo, sumar, nuevas por convicción, seguimiento). % al objetivo: ojo, es dos veces la distancia al stop, así que ordena por volatilidad.">
          {(Object.keys(PLAN_SORT_LABEL) as PlanSort[]).map((k) => <option key={k} value={k}>{PLAN_SORT_LABEL[k]}</option>)}
        </select>
        <span className="muted">Tengo para invertir USD</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onBuild(Number(amount)); }} style={{ width: 110 }} className="mono" />
        <button className="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void onBuild(Number(amount))}>{busy ? "Armando…" : "Armar plan con este monto"}</button>
      </div>
      <table style={{ marginTop: 8 }}>
        <thead><tr><Th k="simbolo" /><th>tipo</th><th>monto</th><Th k="cantidad" /><Th k="precio" /><Th k="comprarHasta" /><Th k="stopPlan" /><Th k="objetivoPlan" /><th>por qué</th><Th k="alpha30" /><Th k="alpha90" /></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={`${l.kind}:${l.symbol}`}>
              <td><SymbolLink symbol={l.symbol} /></td>
              <td><span className="chip">{KIND[l.kind] ?? l.kind}</span></td>
              <td className="mono">{money(l.amountUsd)}</td>
              <td className="mono">{qty(l) ?? "—"}</td>
              <td className="mono">{f2(l.close)}</td>
              <td className="mono">{l.entryHigh ? f2(l.entryHigh) : l.kind === "nucleo" || l.kind === "sumar" ? <span className="muted">mercado</span> : "—"}</td>
              <td className="mono">{l.stop ? <>{f2(l.stop)}{l.close && <span className="muted"> {pct(((l.stop - l.close) / l.close) * 100)}</span>}</> : l.kind === "nucleo" ? <span className="muted" title="El núcleo no se vende por stop: se compra y se mantiene. Es la base de la cartera, no una apuesta.">sin stop</span> : "—"}</td>
              <td className="mono">{l.target ? <>{f2(l.target)}{l.close && <span className="ok"> {pct(((l.target - l.close) / l.close) * 100)}</span>}</> : l.kind === "nucleo" ? <span className="muted" title="Sin objetivo: el núcleo se mantiene años, no se vende al llegar a un precio. El % es lo que rindió en los últimos 12 meses: contexto, no promesa.">se mantiene{l.ret12mPct !== null && l.ret12mPct !== undefined && <> · {pct(l.ret12mPct)} últimos 12 m</>}</span> : "—"}</td>
              <td>{l.rationale}</td>
              <td className="mono">{l.alpha30dPct !== null ? pct(l.alpha30dPct) : <span className="muted" title="Se completa 30 días después del plan: cuánto le ganó (o perdió) esta línea a SPY.">en 30 días</span>}</td>
              <td className="mono">{l.alpha90dPct !== null ? pct(l.alpha90dPct) : <span className="muted" title="Se completa 90 días después del plan.">en 90 días</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sort === "objetivo" && <div className="warn" style={{ marginTop: 6 }}>Ordenado por % al objetivo: ese % es dos veces la distancia al stop, así que arriba quedan los más volátiles, no los mejores. El orden de compra del sistema es "prioridad de compra".</div>}
      {risk > 0 && <div className="muted" style={{ marginTop: 6 }}>Si todas las líneas con stop lo tocan, perdés {money(risk)}. Los ETFs de núcleo no llevan stop: se compran y se quedan.</div>}
      {p.notes.map((n) => <div key={n} className="muted" style={{ marginTop: 4 }}>{n}</div>)}
      {p.leftOut && p.leftOut.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>Ver todos los que no entraron ({p.leftOut.length})</summary>
          <table style={{ marginTop: 6 }}><tbody>{p.leftOut.map((x) => <tr key={x.symbol}><td><SymbolLink symbol={x.symbol} /></td><td className="muted">{x.reason}</td></tr>)}</tbody></table>
        </details>
      )}
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Regla: mientras el núcleo esté bajo su objetivo va el 60% del monto al núcleo; SUMAR hasta el 30% del resto; nuevas por convicción repartidas parejo, más una de tu seguimiento. Si un precio ya pasó "comprar hasta", no lo corras. Cargá las operaciones en Cartera cuando las hagas.</div>
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
