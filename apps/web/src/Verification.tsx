import type { AnalystAction, RadarEvent, Statements } from "./api";

const M = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 1e6).toFixed(1)}M`);
const f1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(1));
const pctOf = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || !b ? "—" : `${((a / b) * 100).toFixed(1)}%`);

/** Tres secciones de la verificación (spec verificación §9): estados con núcleo contra reportado, eventos materiales, analistas de 90 días. */
export function VerificationSections({ statements, events, analystActions, close, metricsRaw }: { statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[]; close: number | null; metricsRaw?: Record<string, number | null> | null }) {
  const core = statements?.core ?? null;
  const last4 = statements?.quarters.slice(-4) ?? [];
  const corePe = core?.coreEpsTTM && core.coreEpsTTM > 0 && close ? (close / core.coreEpsTTM).toFixed(1) : "—";
  return (
    <>
      <div style={{ marginTop: 10 }}>
        <b>Estados (SEC)</b>
        {!statements || !last4.length ? (
          <div className="muted">sin estados: las métricas son de Finnhub y pueden incluir extraordinarios</div>
        ) : (
          <>
            <table style={{ marginTop: 4 }}>
              <thead><tr><th>trimestre</th><th>ingresos</th><th>operativo</th><th>neto</th><th>flujo operativo</th><th>extraordinarios</th></tr></thead>
              <tbody>
                {last4.map((q) => (
                  <tr key={q.end}><td className="mono">{q.end}</td><td className="mono">{M(q.revenue)}</td><td className="mono">{M(q.operatingIncome)}</td><td className="mono">{M(q.netIncome)}</td><td className="mono">{M(q.operatingCashFlow)}</td><td className="mono">{q.extraordinary.map((e) => `${e.tag} ${M(e.value)}`).join(", ") || "—"}</td></tr>
                ))}
              </tbody>
            </table>
            {core && (
              <div className="muted mono" style={{ marginTop: 4 }}>
                TTM: ingresos {M(core.revenueTTM)} · operativo núcleo {M(core.coreOperatingIncomeTTM)} ({pctOf(core.coreOperatingIncomeTTM, core.revenueTTM)}) · neto reportado {M(core.netIncomeTTM)} · neto núcleo {M(core.coreNetIncomeTTM)} · P/E núcleo {corePe}{metricsRaw?.["peTTM"] != null && ` (Finnhub ${f1(metricsRaw["peTTM"])})`} · flujo libre {M(core.freeCashFlowTTM)}
                {core.deviationPct !== null && Math.abs(core.deviationPct) > 0.25 && <span className="warn"> · desvío {(core.deviationPct * 100).toFixed(0)}% por extraordinarios</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Eventos materiales (90 días)</b>
        {events.length === 0 ? <div className="muted">ninguno detectado en noticias</div> : events.map((e) => (
          <div key={e.url}><span className={`flag ${e.severity === "grave" ? "bad" : "warn"}`}>{e.severity}</span> <span className="mono">{e.date}</span> · {e.kind} · <a href={e.url} target="_blank" rel="noreferrer">{e.headline}</a>{e.why && <span className="muted"> · {e.why}</span>}</div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Analistas (90 días)</b>
        {analystActions.length === 0 ? <div className="muted">sin acciones reconocidas en titulares</div> : analystActions.map((a) => (
          <div key={a.url} className="mono"><span>{a.date}</span> · {a.firm} · {a.action}{a.rating ? ` ${a.rating}` : ""}{a.target !== null ? ` · objetivo ${a.target}` : ""}{a.target !== null && close ? <span className={a.target > close ? "ok" : "bad"}> ({(((a.target - close) / close) * 100).toFixed(0)}%)</span> : null}</div>
        ))}
      </div>
    </>
  );
}
