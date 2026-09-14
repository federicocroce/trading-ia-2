import { Fragment, useCallback, useEffect, useState } from "react";
import { instruccionRadar, planStatusFor } from "./instruccion";
import { InstruccionChip, RadarVerdict, invalidatePlan } from "./plan";
import { api, isHistorical, type ArgentinaData, type Candidate, type PlanLine, type Watchlist, type CandidateDetail, type ContributionPlan, type MacroAr, type GrupoMedicion, type Horizonte, type RadarMeasurement, type RadarTop, type ScanStatus, type TaxonomyOptions } from "./api";
import { TagChips, TagEditor } from "./Tags";
import { SymbolLink } from "./SymbolLink";
import { EntryCell } from "./Entry";
import { HELP, RadarHelpModal, Th } from "./RadarHelp";
import { SymbolSearch } from "./SymbolSearch";
import { Flags, countSalvedades } from "./flags";
import { VerificationSections } from "./Verification";
import { PeersTable } from "./Peers";


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
        {isHistorical() && <span className="muted">modo histórico: sin acciones</span>}
        {!isHistorical() && <button className="ghost" disabled={!!busy || !!scan?.running} onClick={() => act("scan", async () => { await api.radar.scan(); setScan(await api.radar.scanStatus()); return "Barrido iniciado en segundo plano (≈1 h). Podés seguir usando la app."; })}>Barrer universo</button>}
        {!isHistorical() && <button className="ghost" disabled={!!busy} onClick={() => act("rank", async () => { const r = await api.radar.rank(); return `Ranking: ${r.candidates.length} candidatos, ${r.errors.length} errores.`; })}>{busy === "rank" ? "Rankeando…" : "Rankear"}</button>}
        {!isHistorical() && <button className="ghost" disabled={!!busy} onClick={() => act("refresh", async () => `Refrescados ${(await api.radar.refresh()).refreshed} candidatos.`)}>Refrescar</button>}
        {!isHistorical() && <button className="ghost" disabled={!!busy} onClick={() => act("argentina", async () => { const r = await api.radar.refreshArgentina(); return `Argentina: ${r.acciones} acciones, ${r.cedears} CEDEARs, ${r.errors.length} errores.`; })}>{busy === "argentina" ? "Argentina…" : "Refrescar Argentina"}</button>}
        {!isHistorical() && <button className="primary" disabled={!!busy} onClick={() => act("plan", async () => { const np = await api.radar.buildPlan(plan?.totalUsd); invalidatePlan(); return `Plan ${np.month} rearmado para ${money(np.totalUsd)}.`; })}>Rearmar plan</button>}
      </div>
      {msg && <div className="card">{msg}</div>}
      <div className="card row" style={{ gap: 8 }}>
        <div className="seg">
          {SUBS.map(([k, label]) => {
            const n = k === "acciones" ? stocks.length : k === "seguimiento" ? watch?.items.length : k === "etfs" ? etfs.length : k === "argentina" ? (ar?.adrs?.length ?? ar?.acciones.length) : undefined;
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
      {sub === "resumen" && plan && <PlanCard p={plan} top={top} radarDate={cands[0]?.candidateDate ?? null} busy={busy === "plan"} onBuild={async (amountUsd) => { await act("plan", async () => { const np = await api.radar.buildPlan(amountUsd); setPlan(np); invalidatePlan(); return `Plan ${np.month} armado para ${money(np.totalUsd)}.`; }); }} />}
      {sub === "resumen" && !plan && <div className="card muted">Todavía no hay plan: poné un monto y apretá "Rearmar plan". Hasta que exista, la app no dice COMPRAR en ninguna pantalla.</div>}
      {sub === "acciones" && opts && (
        <div className="card form-row">
          <span className="muted">Filtrar:</span>
          <select value={filter.verdict} onChange={(e) => setFilter({ ...filter, verdict: e.target.value })}><option value="">veredicto</option>{([["COMPRAR", "pasan los filtros"], ["OBSERVAR", "observar"], ["NUCLEO", "núcleo"]] as const).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
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
              <CandRow key={c.symbol} c={c} plan={plan} open={open === c.symbol} onToggle={() => setOpen(open === c.symbol ? null : c.symbol)} editing={editing === c.symbol} onEdit={() => setEditing(editing === c.symbol ? null : c.symbol)} onSaved={load} />
            ))}
            {!stocks.length && <tr><td colSpan={12} className="muted">Sin acciones candidatas para este filtro.</td></tr>}
          </tbody>
        </table>
      </div>}
      {sub === "etfs" && <div className="card" style={{ overflowX: "auto" }}>
        <b>ETFs</b> <span className="muted">({etfs.length})</span>
        <table style={{ marginTop: 8 }}>
          <thead><tr><Th k="simbolo" /><Th k="veredicto" /><Th k="fr3m" /><Th k="fr6m" /><Th k="fr12m" /><Th k="sma200" /><Th k="precio" /><Th k="entrada" /><Th k="stop" /><Th k="objetivoEtf" /><Th k="etiquetas" /><th></th></tr></thead>
          <tbody>
            {etfs.map((c) => (
              <tr key={c.symbol}>
                <td><SymbolLink symbol={c.symbol} /></td>
                <td><RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={plan} /> {c.flags.length > 0 && <Flags flags={c.flags} inline />}</td>
                <td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td>
                <td className="mono">{f2(c.close)}</td>
                {/* La columna "cuándo entrar" faltaba y sin ella la fila era ilegible: EWT el 12/9 salía
                    COMPRAR con precio 110,91 y objetivo 110,69, o sea un objetivo DEBAJO del precio. No
                    estaba mal calculado: el objetivo se mide desde la franja de compra (106,75–107,83), a la
                    que hay que esperar. Sin la franja a la vista, el 2 a 1 parecía un error de la app. */}
                <td><EntryCell e={c.entry} fallback={c.verdict === "NUCLEO" ? <span className="muted">a mercado</span> : <span className="muted">—</span>} /></td>
                <td className="mono">{f2(c.stop)}</td>
                <td className="mono">{f2(c.target)}{c.target !== null && c.entry && <span className="muted"> {pct(((c.target - (c.entry.high ?? c.close)) / (c.entry.high ?? c.close)) * 100)} desde la entrada</span>}</td>
                <td><TagChips tags={c.tags} /></td>
                <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void load(); }} onCancel={() => setEditing(null)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {sub === "seguimiento" && watch && <WatchCard w={watch} plan={plan} setWatch={setWatch} editing={editing} setEditing={setEditing} reload={load} />}
      {sub === "argentina" && ar && <ArgentinaCard d={ar} plan={plan} editing={editing} setEditing={setEditing} reload={load} />}
      {sub === "medicion" && meas && <MeasCard m={meas} />}
    </>
  );
}

function CandRow({ c, plan, open, onToggle, editing, onEdit, onSaved }: { c: Candidate; plan: ContributionPlan | null; open: boolean; onToggle: () => void; editing: boolean; onEdit: () => void; onSaved: () => Promise<void> }) {
  const [detail, setDetail] = useState<CandidateDetail | null>(null);
  useEffect(() => {
    if (open && !detail) api.radar.candidate(c.symbol).then(setDetail).catch(() => null);
  }, [open, detail, c.symbol]);
  return (
    <>
      <tr>
        <td><SymbolLink symbol={c.symbol} />{c.nthAppearance > 1 && <span className="muted"> ×{c.nthAppearance}</span>}</td>
        {/* COMPRAR solo si el plan la compra; si no, CANDIDATA y por qué (14/9). */}
        <td style={{ maxWidth: 320 }}><RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={plan} /></td>
        <td className="mono">{f2(c.score)}</td>
        <td className="mono">{c.rankInGroup ?? "—"}/{c.groupSize ?? "—"}</td>
        <td className="mono">{f2(c.close)}</td>
        <td><EntryCell e={c.entry} fallback={<span className="mono">{f2(c.entryLow)}–{f2(c.entryHigh)}</span>} /></td>
        <td className="mono">{f2(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
        {/* El % sale del techo de la franja, igual que el objetivo, y va apagado: es 2× el riesgo, no un pronóstico. */}
        <td className="mono">{f2(c.target)}{c.target !== null && <span className="muted"> {pct(((c.target - (c.entryHigh ?? c.close)) / (c.entryHigh ?? c.close)) * 100)}</span>}</td>
        <td className="mono" title={c.sizeQty && c.entryHigh ? `${c.sizeQty} acciones × ${f2(c.entryHigh)} (el techo de la franja de compra, que es lo que vas a pagar) = ${money(c.sizeUsd)}. Con el precio de hoy la cuenta no cierra, y por eso el precio va acá al lado.` : undefined}>{c.sizeQty ?? "—"} · {money(c.sizeUsd)}{c.sizeQty !== null && c.entryHigh !== null && <span className="muted"> a {f2(c.entryHigh)}</span>}</td>
        <td className="mono">{c.riskScore ?? "—"}/10</td>
        <td><TagChips tags={c.tags} /></td>
        <td style={{ whiteSpace: "nowrap" }}><button className="ghost" onClick={onToggle}>{open ? "Cerrar" : "Ver"}</button> <button className="ghost" onClick={onEdit}>Etiquetas</button></td>
      </tr>
      {editing && <tr><td colSpan={12}><TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { onEdit(); void onSaved(); }} onCancel={onEdit} /></td></tr>}
      {open && (
        <tr>
          <td colSpan={12}>
            {c.flags.length > 0 && (
              <div>
                <Flags flags={c.flags} />
                <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                  {countSalvedades(c.flags) === 0
                    ? "Ninguna salvedad: todas las banderas son a favor o son datos que faltan."
                    : `${countSalvedades(c.flags)} ${countSalvedades(c.flags) === 1 ? "salvedad" : "salvedades"}. Con dos de calidad o litigio el veredicto pasa a OBSERVAR solo.`}
                </div>
              </div>
            )}
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
                <VerificationSections statements={detail.statements} events={detail.events} analystActions={detail.analystActions} analystTargets={c.analystTargets} close={c.close} metricsRaw={detail.fundamentals?.metricsRaw} verification={detail.verification ?? null} newsScannedTo={detail.newsScannedTo ?? null} />
                <PeersTable own={c.symbol} ownMetrics={detail.fundamentals?.metrics ?? {}} peers={detail.peers} medians={detail.medians ?? null} asOf={detail.fundamentals?.statementsAsOf ?? null} />
              </>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

const ars = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `$${n.toLocaleString("es-AR", { maximumFractionDigits: n >= 100 ? 0 : 2 })}`);
const delta = (cur: number | null, prev: number | null | undefined) => (cur !== null && prev !== null && prev !== undefined && prev !== 0 ? (cur / prev - 1) * 100 : null);
const CEDEAR_FLAG: Record<string, string> = { en_linea: "en línea", caro_vs_ccl: "caro vs CCL", barato_vs_ccl: "barato vs CCL", ratio_dudoso: "ratio dudoso" };

/** Lista de seguimiento: tickers elegidos a mano con las mismas reglas que un candidato. */
function WatchCard({ w, plan, setWatch, editing, setEditing, reload }: { w: Watchlist; plan: ContributionPlan | null; setWatch: (w: Watchlist) => void; editing: string | null; setEditing: (s: string | null) => void; reload: () => Promise<void> }) {
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
              <td style={{ maxWidth: 320 }}><RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={plan} /> {c.flags.length > 0 && <Flags flags={c.flags} inline />}</td>
              <td className="mono">{c.score === null ? <span className="muted" title="No está en el universo del Radar (o no pasó el quality bar): sin rank contra pares.">—</span> : f2(c.score)}</td>
              <td className="mono">{c.rankInGroup !== null ? `${c.rankInGroup}/${c.groupSize}` : "—"}</td>
              <td className="mono">{f2(c.close)}</td>
              <td><EntryCell e={c.entry} fallback={c.entryLow !== null ? <span className="mono">{f2(c.entryLow)}–{f2(c.entryHigh)}</span> : <span className="muted">—</span>} /></td>
              <td className="mono">{f2(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
              <td className="mono">{f2(c.target)}{c.target !== null && <span className="muted"> {pct(((c.target - (c.entryHigh ?? c.close)) / (c.entryHigh ?? c.close)) * 100)}</span>}</td>
              <td className="mono">{c.sizeQty ?? "—"}{c.sizeUsd !== null && <span className="muted"> · {money(c.sizeUsd)}{c.entryHigh !== null && ` a ${f2(c.entryHigh)}`}</span>}</td>
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
function ArgentinaCard({ d, plan, editing, setEditing, reload }: { d: ArgentinaData; plan: ContributionPlan | null; editing: string | null; setEditing: (s: string | null) => void; reload: () => Promise<void> }) {
  const m = d.macro;
  // El anterior es el más reciente ESTRICTAMENTE anterior a la fecha del macro que se está mirando, no "el
  // penúltimo de la lista". En modo histórico el penúltimo podía ser posterior a la fecha vista, y aun en
  // vivo hay huecos: el 13/9 la serie salta del 11 al 13 y la variación comparaba dos días, no uno. La
  // fecha contra la que se compara ahora se muestra, que es lo que hacía falta para poder leer el número.
  const prev: MacroAr | undefined = m ? [...d.series].filter((x) => x.date < m.date).sort((a, b) => a.date.localeCompare(b.date)).at(-1) : undefined;
  const acciones = [...d.acciones].sort((a, b) => (a.verdict === b.verdict ? (b.axes["rs6m"] ?? -Infinity) - (a.axes["rs6m"] ?? -Infinity) : a.verdict === "COMPRAR" ? -1 : 1));
  const dCcl = delta(m?.ccl ?? null, prev?.ccl);
  const dRp = delta(m?.riesgoPais ?? null, prev?.riesgoPais);
  // Tres fechas distintas que la pantalla presentaba como una sola (12/9): el macro se pide en vivo y es de
  // hoy; las filas de acciones y CEDEARs son de la última corrida de Argentina (ese día, del 10); y el
  // precio de BYMA dentro de cada fila es el de su última rueda cerrada. El encabezado decía "macro del 11"
  // y abajo mostraba una tabla del 10 sin decirlo, así que todo se leía como del mismo día.
  const adrs = [...(d.adrs ?? [])].sort((a, b) => (a.verdict === b.verdict ? (b.axes["rs6m"] ?? -Infinity) - (a.axes["rs6m"] ?? -Infinity) : a.verdict === "COMPRAR" ? -1 : 1));
  const fechaFilas = [...adrs, ...d.acciones, ...d.cedears][0]?.candidateDate ?? null;
  const desfasada = m !== null && fechaFilas !== null && fechaFilas !== m.date;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <b>Argentina</b> <span className="muted">{m ? `macro del ${m.date}` : "sin datos: apretá Refrescar Argentina"}{fechaFilas && ` · tablas de la corrida del ${fechaFilas}`}</span>
      {desfasada && (
        <div className="warn" style={{ fontSize: 12, marginTop: 4 }}>
          El macro de arriba es del {m!.date} y las tablas de abajo son de la corrida del {fechaFilas}: no son del mismo día.
          Los precios en dólares de las filas están convertidos al CCL de SU corrida, no al de arriba. Apretá Refrescar Argentina para igualarlas.
        </div>
      )}
      {m && (
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><b>{ars(m.ccl)}</b><span>dólar CCL{dCcl !== null && prev && <> · <span className={dCcl > 0 ? "bad" : "ok"}>{pct(dCcl)}</span> vs {prev.date}</>}</span></div>
          <div className="kpi"><b>{ars(m.mep)}</b><span>MEP</span></div>
          <div className="kpi"><b>{ars(m.oficial)}</b><span>oficial</span></div>
          <div className="kpi"><b>{pct(m.brechaPct)}</b><span>brecha CCL / oficial</span></div>
          <div className="kpi"><b>{ars(m.blue)}</b><span>blue</span></div>
          <div className="kpi"><b>{m.riesgoPais ?? "—"}</b><span>riesgo país{dRp !== null && prev && <> · <span className={dRp > 0 ? "bad" : "ok"}>{pct(dRp)}</span> vs {prev.date}</>}</span></div>
          <div className="kpi"><b>{m.mervalUsd !== null ? `US$ ${m.mervalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : "—"}</b><span>Merval en dólares{m.mervalDate && m.mervalDate !== m.date ? <> · <span className="warn">índice del {m.mervalDate}, CCL del {m.date}</span></> : ""}</span></div>
        </div>
      )}
      {/* Lo que el dueño puede comprar. Hasta el 13/9 la pestaña mostraba solo las acciones locales, en pesos
          y contra el Merval: una pregunta que él no tiene, porque compra en dólares y puede ir directo al
          ADR. Y el retorno en pesos contra el Merval no es el que se lleva quien tiene el ADR. */}
      <div style={{ marginTop: 12 }}>
        <b>Empresas argentinas que podés comprar en dólares</b> <span className="muted">({adrs.length}) su ADR en Nueva York, medido contra el SPY igual que el resto del Radar</span>
      </div>
      <table style={{ marginTop: 6 }}>
        <thead><tr><Th k="simbolo">ADR</Th><th>acción local</th><Th k="veredicto" /><Th k="fr3m" /><Th k="fr6m" /><Th k="fr12m" /><Th k="sma200" /><Th k="precio">precio US$</Th><Th k="entrada" /><Th k="stop" /><Th k="objetivoEtf" /><th></th></tr></thead>
        <tbody>
          {adrs.map((c) => (
            <tr key={c.symbol}>
              <td><SymbolLink symbol={c.symbol} /></td>
              <td>{c.peerGroup[0] ? <SymbolLink symbol={c.peerGroup[0]} /> : <span className="muted">—</span>}</td>
              {/* El plan en dólares no compra papeles argentinos (decisión del dueño, 14/9): nunca dicen COMPRAR. La
                  excepción es el ADR que ya evalúa el Radar de acciones (PAM): ese sí lo considera el plan, con su motivo. */}
              <td><RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={c.kind === "stock" ? plan : null} {...(c.kind === "stock" ? {} : { context: "argentina" as const })} /> {c.flags.length > 0 && <Flags flags={c.flags} inline />}</td>
              {c.kind === "stock"
                // Este ADR ya lo evalúa el ranking de acciones de EE.UU., que guarda puntajes contra pares y no
                // fuerza relativa. Las cuatro columnas salían vacías sin explicación: se dice qué hay en su lugar.
                ? <td colSpan={4} className="muted" style={{ fontSize: 12 }} title="Este ADR también está en el ranking de acciones de EE.UU., que lo evalúa con fundamentals contra pares además de la tendencia. Esa evaluación es más completa y es la que se muestra.">del ranking de acciones: score {f2(c.score)} · {c.rankInGroup ?? "—"} de {c.groupSize ?? "—"} entre pares</td>
                : <><td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td></>}
              <td className="mono">{f2(c.close)}</td>
              <td><EntryCell e={c.entry} fallback={<span className="muted">—</span>} /></td>
              <td className="mono">{f2(c.stop)}</td>
              <td className="mono">{f2(c.target)}</td>
              <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} />}</td>
            </tr>
          ))}
          {!adrs.length && <tr><td colSpan={12} className="muted">Sin ADRs todavía: apretá Refrescar Argentina.</td></tr>}
        </tbody>
      </table>

      <details style={{ marginTop: 14 }}>
        <summary style={{ cursor: "pointer" }}><b>Solo en pesos</b> <span className="muted">({acciones.length} acciones de BYMA sin ADR y {d.cedears.length} CEDEARs): para comprarlas necesitás pesos y un broker argentino</span></summary>
      <div style={{ marginTop: 12 }}><b>Acciones de BYMA sin ADR</b> <span className="muted">({acciones.length}) contra el Merval, en pesos: no tienen versión en Nueva York</span></div>
      <table style={{ marginTop: 6 }}>
        <thead><tr><Th k="simbolo" /><Th k="veredicto" /><Th k="fr3m">FR 3m</Th><Th k="frMerval">FR 6m</Th><Th k="fr12m">FR 12m</Th><Th k="sma200" /><Th k="precioArs" /><Th k="precioUsd" /><Th k="stop" /><Th k="objetivo" /><Th k="etiquetas" /><th></th></tr></thead>
        <tbody>
          {acciones.map((c) => (
            <tr key={c.symbol}>
              <td><SymbolLink symbol={c.symbol} /></td>
              <td><RadarVerdict symbol={c.symbol} verdict={c.verdict} plan={null} context="argentina" /> {c.flags.length > 0 && <Flags flags={c.flags} inline />}</td>
              <td className="mono">{pct(c.axes["rs3m"])}</td><td className="mono">{pct(c.axes["rs6m"])}</td><td className="mono">{pct(c.axes["rs12m"])}</td><td className="mono">{pct(c.axes["distSma200Pct"])}</td>
              <td className="mono" title={c.axes["velaDias"] ? `Cierre de una rueda ${c.axes["velaDias"]} día(s) anterior a la corrida del ${c.candidateDate}.` : undefined}>{ars(c.close)}{!!c.axes["velaDias"] && c.axes["velaDias"]! > 1 && <span className="muted"> ·{c.axes["velaDias"]}d</span>}</td>
              <td className="mono" title={c.axes["ccl"] ? `Convertido al CCL ${c.axes["ccl"]!.toFixed(2)} de la corrida del ${c.candidateDate}, que puede no ser el CCL de arriba.` : undefined}>{c.axes["closeUsd"] !== null && c.axes["closeUsd"] !== undefined ? `US$ ${c.axes["closeUsd"].toFixed(2)}` : "—"}{c.axes["ccl"] ? <span className="muted"> @{c.axes["ccl"]!.toFixed(0)}</span> : null}</td>
              <td className="mono">{ars(c.stop)}{c.stop !== null && <span className="muted"> {pct(((c.stop - c.close) / c.close) * 100)}</span>}</td>
              <td className="mono">{ars(c.target)}{c.target !== null && <span className={c.target > c.close ? "ok" : "bad"}> {pct(((c.target - c.close) / c.close) * 100)}</span>}</td>
              <td><TagChips tags={c.tags} /></td>
              <td><button className="ghost" onClick={() => setEditing(editing === c.symbol ? null : c.symbol)}>Etiquetas</button>{editing === c.symbol && <TagEditor symbol={c.symbol} current={c.tags} onSaved={() => { setEditing(null); void reload(); }} onCancel={() => setEditing(null)} />}</td>
            </tr>
          ))}
          {!acciones.length && <tr><td colSpan={12} className="muted">Sin acciones argentinas todavía.</td></tr>}
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
      </details>
    </div>
  );
}

/** Plan del aporte: con el aporte del mes o con el monto que tengas líquido. Muestra el ticket para ejecutar. */
type PlanSort = "prioridad" | "conviccion" | "objetivo";
// "objetivo" ordena por el doble de la distancia al stop: el nombre lo dice para que nadie lo lea como ganancia.
const PLAN_SORT_LABEL: Record<PlanSort, string> = { prioridad: "prioridad de compra", conviccion: "convicción", objetivo: "distancia al stop (no es ganancia)" };
const readPlanSort = (): PlanSort => { try { const v = localStorage.getItem("plan.sort"); return v === "conviccion" || v === "objetivo" ? v : "prioridad"; } catch { return "prioridad"; } };
// Desde el techo de la franja, el mismo precio desde el que se calcula el objetivo (13/9); sin franja, desde el cierre.
const gainPct = (l: PlanLine) => { const base = l.entryHigh ?? l.close; return l.target && base ? (l.target / base - 1) * 100 : null; };
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

/**
 * "Qué comprar hoy" (14/9): el plan ES la recomendación. Hasta el 14/9 arriba había una tarjeta de ranking por
 * convicción que listaba candidatas que el plan no compraba (NBN con reservas, ORRF sin verificar, TSM pendiente), y
 * el dueño leía dos recomendaciones distintas en la misma pantalla. Ahora arriba va solo lo que se compra, con su
 * porqué desplegable, y abajo, plegadas, las candidatas que no entran con su motivo.
 */
function PlanCard({ p, top, radarDate, onBuild, busy }: { p: ContributionPlan; top: RadarTop | null; radarDate: string | null; onBuild: (amountUsd: number) => Promise<void>; busy: boolean }) {
  const [amount, setAmount] = useState<string>(String(p.totalUsd));
  const [sort, setSort] = useState<PlanSort>(readPlanSort);
  const [why, setWhy] = useState<string | null>(null);
  const changeSort = (s: PlanSort) => { setSort(s); try { localStorage.setItem("plan.sort", s); } catch { /* sin almacenamiento: no pasa nada */ } };
  const lines = sortPlanLines(p.lines, sort);
  const qty = (l: PlanLine) => (l.close ? Math.floor(l.amountUsd / l.close) : null);
  const risk = p.lines.reduce((s, l) => s + (l.stop && l.close && l.stop < l.close ? (qty(l) ?? 0) * (l.close - l.stop) : 0), 0);
  const pickOf = new Map((top?.picks ?? []).map((x) => [x.symbol, x]));
  // Las notas que cambian QUÉ hacer o CUÁNDO van arriba de la tabla; las informativas, abajo.
  const esInstruccion = (n: string) => /^La Fed decide|lugar(es)? de posiciones nuevas|^No se sumó|^Hoy se ejecutan/.test(n);
  // Con el plan que se rearma solo después de cada corrida esto no debería pasar; si pasa, se dice.
  const viejo = p.builtAt && radarDate ? p.builtAt.slice(0, 10) < radarDate : false;
  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <div className="row">
        {/* La fecha de armado dice de cuándo es lo que se está mirando (13/9: "¿es el mismo plan que ayer?"). */}
        <b style={{ fontSize: 16 }}>Qué comprar hoy</b> <span className="muted">plan de {money(p.totalUsd)}{p.builtAt && ` · armado el ${p.builtAt.slice(0, 10)} ${p.builtAt.slice(11, 16)}`}</span>
        <div style={{ flex: 1 }} />
        <span className="muted">Ordenar por</span>
        <select value={sort} onChange={(e) => changeSort(e.target.value as PlanSort)} title="Prioridad de compra: el orden en que el sistema asigna la plata (núcleo, sumar, nuevas por convicción, seguimiento). % al objetivo: ojo, es dos veces la distancia al stop, así que ordena por volatilidad.">
          {(Object.keys(PLAN_SORT_LABEL) as PlanSort[]).map((k) => <option key={k} value={k}>{PLAN_SORT_LABEL[k]}</option>)}
        </select>
        <span className="muted">Tengo para invertir USD</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void onBuild(Number(amount)); }} style={{ width: 110 }} className="mono" />
        <button className="primary" disabled={busy || !(Number(amount) > 0)} onClick={() => void onBuild(Number(amount))}>{busy ? "Armando…" : "Armar plan con este monto"}</button>
      </div>
      {p.notes.filter(esInstruccion).map((n) => <div key={n} className="warn" style={{ marginTop: 6 }}>{n}</div>)}
      <table style={{ marginTop: 8 }}>
        <thead><tr><Th k="simbolo" /><th>qué hacer</th><th>monto</th><Th k="cantidad" /><Th k="precio" /><Th k="cuandoEntrar" /><Th k="stopPlan" /><Th k="objetivoPlan" /><th>por qué</th><Th k="alpha30" /><Th k="alpha90" /></tr></thead>
        <tbody>
          {lines.map((l) => (
            <Fragment key={`${l.kind}:${l.symbol}`}>
            <tr>
              <td><SymbolLink symbol={l.symbol} /></td>
              <td><InstruccionChip ins={instruccionRadar(l.kind === "nucleo" ? "NUCLEO" : "COMPRAR", planStatusFor(l.symbol, p))} detail={false} /></td>
              <td className="mono">{money(l.amountUsd)}</td>
              <td className="mono">{qty(l) ?? "—"}</td>
              <td className="mono">{f2(l.close)}</td>
              <td><EntryCell e={l.entry} fallback={l.entryHigh ? <span className="mono">hasta {f2(l.entryHigh)}</span> : l.kind === "nucleo" || l.kind === "sumar" ? <span className="muted" title="El núcleo se compra al precio que esté: es aporte periódico, no una operación.">a mercado</span> : <span className="muted">—</span>} /></td>
              <td className="mono">{l.stop ? <>{f2(l.stop)}{l.close && <span className="muted"> {pct(((l.stop - l.close) / l.close) * 100)}</span>}</> : l.kind === "nucleo" ? <span className="muted" title="El núcleo no se vende por stop: se compra y se mantiene. Es la base de la cartera, no una apuesta.">sin stop</span> : "—"}</td>
              {/* El objetivo no es una ganancia esperada: es el doble de la distancia al stop, así que sigue a la
                  volatilidad y no a la empresa. Se muestra sin el % en verde, que se leía como pronóstico, y al
                  lado va el retorno real de 12 meses, que sí dice algo de la empresa. */}
              <td className="mono">
                {l.kind === "nucleo" ? (
                  <span className="muted" title="Sin objetivo: el núcleo se mantiene años, no se vende al llegar a un precio.">se mantiene</span>
                ) : l.target ? (
                  <>
                    {f2(l.target)}
                    <div className="muted" style={{ fontSize: 11 }} title="No es un pronóstico ni una ganancia esperada: es el precio donde la operación paga dos veces lo que arriesga hasta el stop. Por eso acompaña a la distancia del stop, no a la empresa.">2× el riesgo</div>
                  </>
                ) : "—"}
                {l.ret12mPct !== null && l.ret12mPct !== undefined && (
                  <div className={l.ret12mPct >= 0 ? "ok" : "bad"} style={{ fontSize: 11 }} title="Retorno de los últimos 12 meses con dividendos. Es lo que pasó, no lo que va a pasar, pero al menos habla de la empresa.">{pct(l.ret12mPct)} 12 m</div>
                )}
              </td>
              <td>{l.rationale}{pickOf.has(l.symbol) && <> <button className="ghost" style={{ fontSize: 11 }} onClick={() => setWhy(why === l.symbol ? null : l.symbol)}>{why === l.symbol ? "cerrar" : "ver por qué"}</button></>}</td>
              <td className="mono">{l.alpha30dPct !== null ? pct(l.alpha30dPct) : <span className="muted" title="Se completa 30 días después del plan: cuánto le ganó (o perdió) esta línea a SPY.">en 30 días</span>}</td>
              <td className="mono">{l.alpha90dPct !== null ? pct(l.alpha90dPct) : <span className="muted" title="Se completa 90 días después del plan.">en 90 días</span>}</td>
            </tr>
            {why === l.symbol && pickOf.get(l.symbol) && (() => {
              const k = pickOf.get(l.symbol)!;
              return (
                <tr><td colSpan={11}>
                  {k.summary && <div className="muted">{k.summary}</div>}
                  <ul className="why">{k.reasons.map((r) => <li key={r} className="ok">✓ {r}</li>)}{k.cautions.map((r) => <li key={r} className="warn">⚠ {r}</li>)}</ul>
                  <div className="muted mono">{k.consensus ? `consenso de analistas ${f2(k.consensus.target)} (${pct(k.consensus.upsidePct)} desde ${f2(k.base)})` : "sin consenso de analistas"} · convicción {k.conviction.toFixed(2)}</div>
                  {k.mainRisk && <div className="muted"><b>Riesgo principal:</b> {k.mainRisk}</div>}
                </td></tr>
              );
            })()}
            </Fragment>
          ))}
        </tbody>
      </table>
      {viejo && (
        <div className="warn" style={{ marginTop: 6 }}>
          Este plan se armó el {p.builtAt!.slice(0, 10)} y el Radar ya tiene una corrida del {radarDate}. Se rearma solo después de cada corrida;
          si ves esto, la última no llegó a rearmarlo. Apretá "Armar plan con este monto" antes de comprar.
        </div>
      )}
      {sort === "objetivo" && <div className="warn" style={{ marginTop: 6 }}>Ordenado por distancia al stop. El objetivo es exactamente dos veces esa distancia: medido sobre los 26 COMPRAR de hoy, la correlación entre los dos números es 1,0000. Ordena por volatilidad, no por calidad, y no dice nada de cuánto puede ganar la empresa. El orden de compra del sistema es "prioridad de compra".</div>}
      {risk > 0 && <div className="muted" style={{ marginTop: 6 }}>Si todas las líneas con stop lo tocan, perdés {money(risk)}. Los ETFs de núcleo no llevan stop: se compran y se quedan.</div>}
      {p.leftOut && p.leftOut.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary style={{ cursor: "pointer" }}><b>Candidatas que hoy NO se compran</b> <span className="muted">({p.leftOut.length}) pasan los filtros del Radar pero no entran al plan, y acá dice por qué</span></summary>
          <table style={{ marginTop: 6 }}><tbody>{p.leftOut.map((x) => <tr key={x.symbol}><td><SymbolLink symbol={x.symbol} /></td><td><InstruccionChip ins={instruccionRadar("COMPRAR", planStatusFor(x.symbol, p))} /></td></tr>)}</tbody></table>
        </details>
      )}
      {p.notes.filter((n) => !esInstruccion(n) && !n.startsWith("No entraron esta vez")).map((n) => <div key={n} className="muted" style={{ marginTop: 4 }}>{n}</div>)}
      <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>Regla: mientras el núcleo esté bajo su objetivo va el 60% del monto al núcleo; SUMAR hasta el 30% del resto; nuevas por convicción repartidas parejo, más una de tu seguimiento. Mirá "cuándo entrar" antes de ejecutar: lo que dice "esperar" se deja como orden limitada al precio indicado y se revisa a las 15 ruedas, no se compra a mercado. Cargá las operaciones en Cartera cuando las hagas.</div>
    </div>
  );
}

const HORIZONTES: Horizonte[] = ["h7", "h30", "h90"];
const DIAS: Record<Horizonte, number> = { h7: 7, h30: 30, h90: 90 };

/** Tabla de un grupo medido contra un índice. Los dos grupos no se pueden promediar entre sí. */
function TablaMedicion({ g, indice }: { g: GrupoMedicion; indice: string }) {
  const cell = (b: { n: number; avgAlpha: number | null; hitRate: number | null }) => (b.n ? `${b.n} · ${pct(b.avgAlpha)}${b.hitRate === null ? "" : ` · ${(b.hitRate * 100).toFixed(0)}%`}` : "—");
  const diff = (h: Horizonte) => { const d = g.comprarVsObservar[h]; return d.diff === null ? "—" : `${pct(d.diff)} (n ${d.nComprar}/${d.nObservar})`; };
  return (
    <table style={{ marginTop: 8 }}>
      <thead><tr><th>veredicto (vs {indice})</th><th>7 días (n · alpha · acierto)</th><th>30 días</th><th>90 días</th></tr></thead>
      <tbody>
        {/* Categorías del filtro, no instrucciones: el COMPRAR del Radar es "pasaba los filtros", o sea CANDIDATA (14/9). */}
        {Object.entries(g.byVerdict).map(([v, b]) => <tr key={v}><td><span className={`verb ${v === "COMPRAR" ? "CANDIDATA" : v}`}>{v === "COMPRAR" ? "CANDIDATA" : v === "NUCLEO" ? "NÚCLEO" : v}</span></td><td className="mono">{cell(b.h7)}</td><td className="mono">{cell(b.h30)}</td><td className="mono">{cell(b.h90)}</td></tr>)}
        <tr><td><b>CANDIDATA − OBSERVAR</b></td><td className="mono">{diff("h7")}</td><td className="mono">{diff("h30")}</td><td className="mono">{diff("h90")}</td></tr>
      </tbody>
    </table>
  );
}

/**
 * Medición. Dos cosas que esta tarjeta decía mal hasta el 13/9:
 *
 * "756 apariciones, 756 pendientes de medir" se leía como una deuda de la app, y era imposible que fuera
 * otra cosa: el Radar empezó el 7 de septiembre y una medición a 7 días no puede existir antes del 14. Un
 * contador que no puede llegar a cero no informa nada. Ahora se separa lo que espera a que pase el tiempo
 * (con la fecha en que llega) de lo que está vencido, que es lo único que sí es un problema.
 *
 * Y las filas argentinas miden su alpha contra el MERVAL, porque es contra el Merval que se rankean. Iban a
 * caer en esta misma tabla rotulada "contra SPY" a partir del 14, promediando dos cosas distintas.
 */
function MeasCard({ m }: { m: RadarMeasurement }) {
  const e = m.estado;
  return (
    <div className="card">
      <b>Medición</b> <span className="muted">{m.total} apariciones guardadas</span>
      {e && (
        <div className="muted" style={{ marginTop: 6, fontSize: 12 }}>
          {HORIZONTES.map((h) => {
            const x = e[h];
            return (
              <div key={h}>
                <b>{DIAS[h]} días:</b> {x.medidas} medidas
                {x.esperando > 0 && <> · {x.esperando} esperando a que pasen los {DIAS[h]} días{x.primera && <> (la primera llega el {x.primera})</>}</>}
                {x.vencidas > 0 && <span className="warn"> · {x.vencidas} vencidas sin medir</span>}
              </div>
            );
          })}
        </div>
      )}
      <TablaMedicion g={{ byVerdict: m.byVerdict, comprarVsObservar: m.comprarVsObservar, filas: 0 }} indice="SPY" />
      {m.merval && m.merval.filas > 0 && (
        <>
          <div style={{ marginTop: 10 }}><b>Argentina</b> <span className="muted">({m.merval.filas} apariciones) se miden contra el Merval, que es el índice contra el que se rankean. No se pueden promediar con las de arriba.</span></div>
          <TablaMedicion g={m.merval} indice="Merval" />
        </>
      )}
      <div className="muted" style={{ marginTop: 6 }}>OBSERVAR es el grupo de control: si las candidatas no le ganan, los filtros no agregan valor. Lo del núcleo no se elige; se compra por calendario.</div>
    </div>
  );
}
