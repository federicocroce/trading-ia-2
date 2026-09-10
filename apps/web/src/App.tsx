import { useCallback, useEffect, useState } from "react";
import { api, type CatchUpStatus, type Thesis } from "./api";
import { Cartera } from "./Cartera";
import { Radar } from "./Radar";
import { Ticker } from "./Ticker";
import { Novedades } from "./Novedades";
import { Sidebar } from "./Sidebar";
import { Tape } from "./Tape";
import { CorridasButton } from "./Corridas";

const TABS = ["hoy", "cartera", "radar", "proposed", "open", "history", "calibration"] as const;
type Tab = (typeof TABS)[number];
const isTab = (x: string | null): x is Tab => x !== null && (TABS as readonly string[]).includes(x);

/** La navegación vive en la URL: `?tab=radar` es la pestaña y `?symbol=NBN` la ficha por ticker (pueden convivir). Sin `tab` o con uno inválido cae en Cartera. */
function readLocation(): { tab: Tab; symbol: string | null } {
  const q = new URLSearchParams(window.location.search);
  const t = q.get("tab");
  return { tab: isTab(t) ? t : "hoy", symbol: q.get("symbol")?.toUpperCase() ?? null };
}

/** Arma la URL nueva a partir de la actual y la empuja al historial sin recargar. `symbol: null` saca la ficha; lo que no se pasa queda como está. */
function pushLocation(patch: { tab?: Tab; symbol?: string | null }) {
  const url = new URL(window.location.href);
  if (patch.tab !== undefined) {
    url.searchParams.set("tab", patch.tab);
    url.searchParams.delete("sub"); // la sub-pestaña es de cada pestaña
  }
  if (patch.symbol !== undefined) {
    if (patch.symbol) url.searchParams.set("symbol", patch.symbol.toUpperCase());
    else url.searchParams.delete("symbol");
  }
  if (url.href !== window.location.href) window.history.pushState({}, "", url);
}

export function App() {
  const [{ tab, symbol }, setLocation] = useState(readLocation);
  useEffect(() => {
    // Único listener: atrás/adelante del navegador y goToSymbol (que dispara popstate) releen la URL entera.
    const onPop = () => setLocation(readLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (patch: Parameters<typeof pushLocation>[0]) => {
    pushLocation(patch);
    setLocation(readLocation());
  };
  const closeSymbol = () => navigate({ symbol: null });
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [catchup, setCatchup] = useState<CatchUpStatus | null>(null);
  const [sidebar, setSidebar] = useState<boolean>(() => { try { return localStorage.getItem("sidebar") !== "0"; } catch { return true; } });
  const toggleSidebar = () => { setSidebar((v) => { try { localStorage.setItem("sidebar", v ? "0" : "1"); } catch { /* nada */ } return !v; }); };
  const refreshHealth = useCallback(() => Promise.all([api.health().then(setHealth).catch(() => setHealth(null)), api.catchup.status().then(setCatchup).catch(() => setCatchup(null))]), []);
  async function catchUpNow() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.catchup.run();
      setMsg(r.ran.length ? `Al día: ${r.ran.map((x) => `${x.label} → ${x.ok ? x.detail : `falló (${x.detail})`}`).join(" · ")}` : "No había nada pendiente.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
      void refreshHealth();
    }
  }
  useEffect(() => {
    void refreshHealth();
    // La API se reinicia sola al editar código (tsx watch): reintentar para que el aviso se vaya solo.
    const id = window.setInterval(() => void refreshHealth(), 30_000);
    return () => window.clearInterval(id);
  }, [refreshHealth]);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const s = await api.run();
      setMsg(`Corrida: ${s.newEvents} eventos nuevos, ${s.passed} pasaron el filtro, ${s.proposed.length} tesis propuestas, ${s.rejected.length} rechazadas por edge, ${s.errors.length} errores.`);
      await refreshHealth();
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleKill() {
    if (!health) return;
    const r = await api.killSwitch(!health.killSwitch);
    setHealth({ ...health, killSwitch: r.killSwitch });
  }

  return (
    <>
      <header>
        <h1>thesis-engine</h1>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={tab === t && !symbol ? "active" : ""} onClick={() => navigate({ tab: t, symbol: null })}>
              {{ hoy: "Hoy", cartera: "Cartera", radar: "Radar", proposed: "Propuestas", open: "Abiertas", history: "Historial", calibration: "Calibración" }[t]}
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <span className="tag">paper</span>
        <CorridasButton st={catchup} onChanged={() => void refreshHealth()} />
        {catchup && catchup.due.length > 0 && !catchup.running && <button className="primary" onClick={catchUpNow} disabled={busy} title="Corre solo los pasos que quedaron sin correr. Lo ya hecho no se repite.">{busy ? "Poniéndome al día…" : "Ponerme al día"}</button>}
        <button className="ghost" onClick={run} disabled={busy} title="Fuerza el pipeline de tesis por eventos ahora, aunque ya haya corrido hoy.">
          {busy ? "Corriendo…" : "Correr pipeline"}
        </button>
        <button className={health?.killSwitch ? "primary" : "danger"} onClick={toggleKill} disabled={!health}>
          {health?.killSwitch ? "Kill switch: ON (reactivar)" : "Kill switch"}
        </button>
      </header>
      <Tape />
      <div className="layout">
      <Sidebar open={sidebar} onToggle={toggleSidebar} />
      <main>
        {!health && <div className="err">No se puede hablar con la API (¿está corriendo `pnpm dev:api`?)</div>}
        {msg && <div className="card">{msg}</div>}
        {symbol && <Ticker symbol={symbol} onBack={closeSymbol} />}
        {!symbol && tab === "hoy" && <Novedades />}
        {!symbol && tab === "cartera" && <Cartera />}
        {!symbol && tab === "radar" && <Radar />}
        {!symbol && tab === "proposed" && <ThesisList status="proposed" actions="review" />}
        {!symbol && tab === "open" && <ThesisList status="open,approved" actions="close" />}
        {!symbol && tab === "history" && <ThesisList status="closed,rejected" actions="none" />}
        {!symbol && tab === "calibration" && <Calibration />}
      </main>
      </div>
    </>
  );
}

function ThesisList({ status, actions }: { status: string; actions: "review" | "close" | "none" }) {
  const [list, setList] = useState<Thesis[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(() => api.theses(status).then(setList).catch((e) => setErr(String(e))), [status]);
  useEffect(() => {
    void load();
  }, [load]);

  if (err) return <div className="err">{err}</div>;
  if (!list.length) return <div className="card muted">Nada por acá.</div>;
  return (
    <>
      {list.map((t) => (
        <ThesisCard key={t.id} t={t} actions={actions} onChange={load} />
      ))}
    </>
  );
}

function ThesisCard({ t, actions, onChange }: { t: Thesis; actions: "review" | "close" | "none"; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Awaited<ReturnType<typeof api.thesis>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [happened, setHappened] = useState(true);
  const [reason, setReason] = useState("event_resolved");

  useEffect(() => {
    if (open && !detail) api.thesis(t.id).then(setDetail).catch((e) => setErr(String(e)));
  }, [open, detail, t.id]);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  return (
    <div className="card">
      <div className="row">
        <b style={{ fontSize: 16 }}>{t.ticker}</b>
        <span className={`tag ${t.direction}`}>{t.direction}</span>
        <span className="tag">{t.instrument}</span>
        <span className="tag">{t.eventType}</span>
        <span className="muted">{t.eventDate ?? "sin fecha"}</span>
        <span className="mono">
          pEst {pct(t.pEstimate)} · pMkt {pct(t.pMarket)} · <b>edge {pct(t.edge)}</b> · conf {t.confidence}
        </span>
        <span className="muted mono">entry ≤ {t.entryMax} → target {t.target}</span>
        <div className="spacer" style={{ flex: 1 }} />
        <span className="tag">{t.status}{t.rejectionReason ? ` (${t.rejectionReason})` : ""}</span>
        <button className="ghost" onClick={() => setOpen(!open)}>
          {open ? "Cerrar" : "Ver"}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div className="muted">Invalidación</div>
          <pre>{t.invalidation}</pre>
          <div className="muted">Razonamiento</div>
          <pre>{t.reasoning}</pre>
          <div className="muted mono">fuentes: {t.sources.join(", ")} · prompt {t.promptVersion}</div>
          {detail?.event && (
            <div className="muted mono" style={{ marginTop: 6 }}>
              evento: [{detail.event.source}] {detail.event.title}
            </div>
          )}
          {detail?.orders.length ? (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr><th>orden</th><th>símbolo</th><th>qty</th><th>límite</th><th>fill</th><th>estado</th></tr>
              </thead>
              <tbody>
                {detail.orders.map((o, i) => (
                  <tr key={i}><td>{o.side}</td><td className="mono">{o.symbol}</td><td>{o.qty}</td><td>{o.limitPrice}</td><td>{o.avgFillPrice ?? "—"}</td><td>{o.status}</td></tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {err && <div className="err">{err}</div>}
          {actions === "review" && (
            <div className="row" style={{ marginTop: 12 }}>
              <button className="primary" disabled={busy} onClick={() => act(() => api.approve(t.id))}>Aprobar y ejecutar (paper)</button>
              <input placeholder="motivo del rechazo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} style={{ minWidth: 260 }} />
              <button className="ghost" disabled={busy} onClick={() => act(() => api.reject(t.id, note))}>Rechazar</button>
            </div>
          )}
          {actions === "close" && (
            <div className="row" style={{ marginTop: 12 }}>
              <label>
                ¿Pasó lo predicho?{" "}
                <select value={happened ? "1" : "0"} onChange={(e) => setHappened(e.target.value === "1")}>
                  <option value="1">Sí</option>
                  <option value="0">No</option>
                </select>
              </label>
              <label>
                Motivo{" "}
                <select value={reason} onChange={(e) => setReason(e.target.value)}>
                  {["event_resolved", "invalidation", "target", "risk_stop", "manual"].map((r) => <option key={r}>{r}</option>)}
                </select>
              </label>
              <input placeholder="notas" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="danger" disabled={busy} onClick={() => act(() => api.close(t.id, { predictedOutcomeHappened: happened, closeReason: reason, notes: note }))}>Cerrar posición</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Calibration() {
  const [r, setR] = useState<Awaited<ReturnType<typeof api.calibration>> | null>(null);
  const [p, setP] = useState<Awaited<ReturnType<typeof api.portfolio>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    api.calibration().then(setR).catch((e) => setErr(String(e)));
    api.portfolio().then(setP).catch(() => null);
  }, []);
  if (err) return <div className="err">{err}</div>;
  if (!r) return <div className="card muted">Cargando…</div>;
  const f = (x: number, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "—");
  const crit: Array<[string, string]> = [
    ["enoughSamples", "≥ 30 tesis cerradas"],
    ["calibratesBetterThanMarket", "Brier sistema < Brier mercado"],
    ["positiveExpectancy", "PnL medio por tesis > 0"],
    ["drawdownOk", "Drawdown máx < 15%"],
  ];
  return (
    <>
      {p && (
        <div className="card kpis">
          <div className="kpi"><b>${p.account.equity.toLocaleString()}</b><span>equity (paper)</span></div>
          <div className="kpi"><b className={p.snapshot.dailyPnlUsd >= 0 ? "ok" : "bad"}>{p.snapshot.dailyPnlUsd >= 0 ? "+" : ""}{p.snapshot.dailyPnlUsd.toFixed(0)}</b><span>PnL hoy</span></div>
          {Object.entries(p.snapshot.openByEventType).map(([k, v]) => (
            <div className="kpi" key={k}><b>${v.toLocaleString()}</b><span>abierto en {k}</span></div>
          ))}
        </div>
      )}
      <div className="card kpis">
        <div className="kpi"><b>{r.closed}</b><span>tesis cerradas</span></div>
        <div className="kpi"><b>{(r.hitRate * 100).toFixed(0)}%</b><span>tasa de acierto</span></div>
        <div className="kpi"><b>{f(r.brierSystem)}</b><span>Brier sistema (menor = mejor)</span></div>
        <div className="kpi"><b>{f(r.brierMarket)}</b><span>Brier mercado</span></div>
        <div className="kpi"><b className={r.avgPnlPct >= 0 ? "ok" : "bad"}>{f(r.avgPnlPct, 2)}%</b><span>PnL medio por tesis</span></div>
        <div className="kpi"><b className={r.totalPnlUsd >= 0 ? "ok" : "bad"}>${r.totalPnlUsd.toFixed(0)}</b><span>PnL total</span></div>
        <div className="kpi"><b>{f(r.maxDrawdownPct, 1)}%</b><span>drawdown máx</span></div>
        <div className="kpi"><b>{r.humanRejected}</b><span>rechazadas por vos</span></div>
      </div>
      <div className="card">
        <b>Criterio de salida de paper (DESIGN.md §7)</b>
        <table style={{ marginTop: 8 }}>
          <tbody>
            {crit.map(([k, label]) => (
              <tr key={k}><td>{label}</td><td className={r.criteria[k] ? "ok" : "bad"}>{r.criteria[k] ? "cumple" : "no cumple"}</td></tr>
            ))}
            <tr><td><b>Listo para dinero real</b></td><td className={r.criteria["readyForRealMoney"] ? "ok" : "bad"}><b>{r.criteria["readyForRealMoney"] ? "SÍ" : "NO"}</b></td></tr>
          </tbody>
        </table>
      </div>
      {Object.keys(r.byEventType).length > 0 && (
        <div className="card">
          <b>Por tipo de evento</b>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>tipo</th><th>n</th><th>acierto</th><th>PnL medio</th><th>Brier sist.</th><th>Brier mkt</th></tr></thead>
            <tbody>
              {Object.entries(r.byEventType).map(([k, g]) => (
                <tr key={k}><td>{k}</td><td>{g.n}</td><td>{(g.hitRate * 100).toFixed(0)}%</td><td>{f(g.avgPnlPct, 2)}%</td><td>{f(g.brierSystem)}</td><td>{f(g.brierMarket)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
