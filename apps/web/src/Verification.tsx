import type { AnalystAction, AnalystTargets, CandidateVerification, RadarEvent, Statements } from "./api";
import { EXTRAORDINARIOS_AYUDA, extraordinarioLabel } from "./extraordinarios";
import { estadoVerificacion, fuentesTexto, peNucleo } from "./verificacionTextos";

const M = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 1e6).toFixed(1)}M`);
const f1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(1));
const pctOf = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || !b ? "—" : `${((a / b) * 100).toFixed(1)}%`);
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}%`;

/** Cuántos enlaces se muestran de entrada; el resto, al abrir "ver todas". */
const FUENTES_VISIBLES = 8;

/**
 * Verificación web por candidata (spec 2026-09-10): dictamen del modelo con búsqueda, con sus datos y fuentes. Cómo se
 * lee (vigente, del cuestionario anterior, pendiente o sin verificar) sale de `estadoVerificacion` (15/9).
 */
function WebVerification({ v, close, current, fila }: { v: CandidateVerification | null | undefined; close: number | null; current?: boolean | null | undefined; fila?: { verdict: string; flags: string[] } | null | undefined }) {
  const e = estadoVerificacion({ v, current, fila });
  if (!v) return <div className={e.kind === "pendiente" ? "warn" : "muted"}>{e.nota}</div>;
  const lq = v.lastQuarter;

  return (
    <>
      <div><span className={e.chip!.className}>{e.chip!.label}</span>{e.nota && <span className="warn"> {e.nota}</span>} <span className="muted mono">{v.date}</span> · {v.reason}</div>
      {lq && <div className="muted mono">Último trimestre{lq.reportDate ? ` (${lq.reportDate})` : ""}: ingresos {lq.revenueVsConsensus ?? "—"} · EPS {lq.epsVsConsensus ?? "—"}{lq.oneOffs.length ? ` · únicos: ${lq.oneOffs.join("; ")}` : ""}{lq.guidance ? ` · guía: ${lq.guidance}` : ""}</div>}
      {(v.consensusTarget !== null || v.analysts.length > 0) && (
        <div className="muted mono">
          Analistas: objetivo de consenso {v.consensusTarget ?? "—"}{v.consensusTarget !== null && close ? ` (${signedPct(((v.consensusTarget - close) / close) * 100)} vs precio)` : ""}
          {v.analysts.map((a) => ` · ${a.date} ${a.firm} ${a.action}${a.target !== null ? ` ${a.target}` : ""}`).join("")}
        </div>
      )}
      {v.events.map((e) => <div key={`${e.date}|${e.headline}`} className="mono"><span className="warn">{e.date}</span> · {e.kind} · {e.headline}</div>)}
      {v.valuation && <div className="muted">Valuación: {v.valuation}</div>}
      {v.nextEarnings && <div className="muted">Próximos resultados: {v.nextEarnings}</div>}
      {/* Cuántas fuentes tuvo, siempre (15/9: APH con 0 guardadas no decía nada; TSM con 42 mostraba 8 sin decirlo). */}
      <div className={v.sources.length ? "muted" : "warn"}>{fuentesTexto(v.sources.length, FUENTES_VISIBLES)} {v.sources.slice(0, FUENTES_VISIBLES).map((s, i) => <span key={s.url}>{i > 0 ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></span>)}</div>
      {v.sources.length > FUENTES_VISIBLES && <details><summary className="muted">ver las {v.sources.length} fuentes</summary><div className="muted">{v.sources.map((s, i) => <span key={s.url}>{i > 0 ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer">{s.title}</a></span>)}</div></details>}
      <details><summary className="muted">informe completo del modelo</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 12 }}>{v.researchText}</pre></details>
    </>
  );
}

/**
 * Banda de escala del consenso, la misma que usa el núcleo en CONSENSUS_SCALE. Un objetivo fuera de esto no
 * es una opinión audaz: es un precio de otra serie. APH tenía nueve objetivos de julio entre 175 y 215 con la
 * acción en 84 tras un split 2:1, y la ficha los mostraba como potenciales de +109% a +156%. El único de
 * septiembre, de 90, es el que estaba en escala.
 */
const enEscala = (objetivo: number, precio: number) => precio > 0 && objetivo <= precio * 2 && objetivo >= precio * 0.5;

/**
 * Ventana de noticias que la app dice mirar. Tiene que coincidir con EVENT_WINDOW_DAYS del barrido y con el
 * `since` de los dos endpoints que alimentan esta pantalla.
 */
const VENTANA_DIAS = 90;
const desdeHace = (dias: number) => new Date(Date.now() - dias * 86_400_000).toISOString().slice(0, 10);

/**
 * Qué se puede afirmar sobre las noticias de este símbolo (12/9). Tres estados, no dos:
 *
 * `null` = nunca se leyó una noticia. Ese día 47 de 91 filas del Radar y cinco de las ocho posiciones con
 * plata puesta estaban así, y las tres pantallas decían "ninguno detectado en noticias", que es una
 * afirmación sobre el mundo hecha sin haber mirado. Es exactamente el error que el dueño viene marcando:
 * el hueco se presentaba como un resultado.
 */
function EstadoDelBarrido({ scannedTo }: { scannedTo: string | null | undefined }) {
  if (scannedTo === undefined) return null;
  if (scannedTo === null) {
    return <div className="warn" style={{ fontSize: 12 }}>Nunca se leyeron las noticias de este símbolo: lo de abajo está vacío porque nadie miró, no porque no haya pasado nada. Las noticias se leen de las candidatas del ranking y de las posiciones de la cartera.</div>;
  }
  return <div className="muted" style={{ fontSize: 12 }}>Noticias leídas del {desdeHace(VENTANA_DIAS)} al {scannedTo}.</div>;
}

/**
 * `verificationCurrent`: si la verificación es del cuestionario vigente (la ficha lo sabe; sin el dato se muestra como
 * vigente). `fila`: veredicto y banderas de la fila del Radar, para decir "pendiente" en lo que queda COMPRAR (15/9).
 */
export function VerificationSections({ statements, events, analystActions, analystTargets, close, metricsRaw, verification, newsScannedTo, verificationCurrent, fila }: { statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[]; analystTargets?: AnalystTargets | null; close: number | null; metricsRaw?: Record<string, number | null> | null; verification?: CandidateVerification | null; newsScannedTo?: string | null; verificationCurrent?: boolean | null; fila?: { verdict: string; flags: string[] } | null }) {
  const core = statements?.core ?? null;
  const last4 = statements?.quarters.slice(-4) ?? [];
  // Con la misma banda que el núcleo: SNDK el 15/9 daba "P/E núcleo 0,1" por un trimestre con 1.000.000 de acciones.
  const corePe = peNucleo({ close, coreEps: core?.coreEpsTTM, epsFuente: metricsRaw?.["epsTTM"] });
  // Cuántos objetivos de analistas están en otra escala que el precio: el aviso de abajo lo explica.
  const fueraDeEscala = close ? analystActions.filter((a) => a.target !== null && !enEscala(a.target, close)).length : 0;
  return (
    <>
      <div style={{ marginTop: 10 }}>
        <b>Verificación web (modelo con búsqueda)</b>
        <WebVerification v={verification} close={close} current={verificationCurrent} fila={fila} />
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Estados (SEC)</b>
        {!statements || !last4.length ? (
          <div className="muted">sin estados: las métricas son de Finnhub y pueden incluir extraordinarios</div>
        ) : (
          <>
            <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{EXTRAORDINARIOS_AYUDA}</div>
            <table style={{ marginTop: 4 }}>
              <thead><tr><th>trimestre</th><th>ingresos</th><th>operativo</th><th>neto</th><th>flujo operativo</th><th title={EXTRAORDINARIOS_AYUDA} style={{ cursor: "help" }}>extraordinarios</th></tr></thead>
              <tbody>
                {last4.map((q) => (
                  <tr key={q.end}><td className="mono">{q.end}</td><td className="mono">{M(q.revenue)}</td><td className="mono">{M(q.operatingIncome)}</td><td className="mono">{M(q.netIncome)}</td><td className="mono">{M(q.operatingCashFlow)}</td><td className="mono">{q.extraordinary.length === 0 ? "—" : q.extraordinary.map((e) => <div key={e.tag} title={e.tag}><span className={e.value > 0 ? "warn" : ""}>{M(e.value)}</span> <span className="muted">{extraordinarioLabel(e.tag)}</span></div>)}</td></tr>
                ))}
              </tbody>
            </table>
            {core && (
              <div className="muted mono" style={{ marginTop: 4 }}>
                TTM: ingresos {M(core.revenueTTM)} · operativo núcleo {M(core.coreOperatingIncomeTTM)} ({pctOf(core.coreOperatingIncomeTTM, core.revenueTTM)}) · neto reportado {M(core.netIncomeTTM)} · neto núcleo {M(core.coreNetIncomeTTM)} · P/E núcleo <span title={corePe.motivo ?? undefined} className={corePe.motivo ? "warn" : undefined} style={corePe.motivo ? { cursor: "help" } : undefined}>{corePe.texto}{corePe.motivo && " (no creíble)"}</span>{metricsRaw?.["peTTM"] != null && ` (Finnhub ${f1(metricsRaw["peTTM"])})`} · flujo libre {M(core.freeCashFlowTTM)}
                {core.extraordinaryTTM !== 0 && core.deviationPct !== null && Math.abs(core.deviationPct) > 0.25 && <span className="warn"> · desvío {signedPct(core.deviationPct * 100)} por extraordinarios</span>}
              </div>
            )}
            {core && (core.noncontrollingTTM != null || core.receivablesPctRevenue != null || core.lastQuarterYoy) && (
              <div className="muted mono" style={{ marginTop: 2 }}>
                Calidad:
                {core.noncontrollingTTM != null && core.noncontrollingTTM > 0 && <span className={core.coreNetIncomeTTM != null && core.noncontrollingTTM / (core.coreNetIncomeTTM + core.noncontrollingTTM) >= 0.2 ? " warn" : ""}> socios minoritarios {M(core.noncontrollingTTM)} ({pctOf(core.noncontrollingTTM, core.coreNetIncomeTTM != null ? core.coreNetIncomeTTM + core.noncontrollingTTM : null)} de la ganancia, ya restado)</span>}
                {core.receivablesPctRevenue != null && <span className={core.receivablesPctRevenue >= 0.35 ? " warn" : ""}> · cuentas a cobrar {Math.round(core.receivablesPctRevenue * 100)}% de los ingresos</span>}
                {core.lastQuarterYoy && <span className={core.lastQuarterYoy.revenuePct != null && core.lastQuarterYoy.operatingPct != null && core.lastQuarterYoy.revenuePct < 0 && core.lastQuarterYoy.operatingPct >= 50 ? " warn" : ""}> · último trimestre vs año anterior: ingresos {core.lastQuarterYoy.revenuePct == null ? "—" : signedPct(core.lastQuarterYoy.revenuePct)} · operativo {core.lastQuarterYoy.operatingPct == null ? "—" : signedPct(core.lastQuarterYoy.operatingPct)}</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Eventos materiales (90 días)</b>
        <EstadoDelBarrido scannedTo={newsScannedTo} />
        {events.length === 0 ? <div className="muted">{newsScannedTo === null ? "sin eventos guardados" : "ninguno detectado en las noticias leídas"}</div> : events.map((e) => (
          <div key={e.url}><span className={`flag ${e.severity === "grave" ? "bad" : "warn"}`}>{e.severity}</span> <span className="mono">{e.date}</span> · {e.kind} · <a href={e.url} target="_blank" rel="noreferrer">{e.headline}</a>{e.why && <span className="muted"> · {e.why}</span>}</div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Analistas (90 días)</b>
        {analystTargets && analystTargets.n > 0 && (
          <div className="muted mono">
            objetivo mediano {analystTargets.median ?? "—"}
            {analystTargets.median !== null && close ? (enEscala(analystTargets.median, close)
              ? ` (${signedPct(((analystTargets.median - close) / close) * 100)} vs precio)`
              : ` (${(analystTargets.median / close).toFixed(1)}× el precio)`) : ""} · {analystTargets.n} acciones en 90 días · última {analystTargets.latestDate ?? "—"}
          </div>
        )}
        {fueraDeEscala > 0 && (
          <div className="warn" style={{ fontSize: 12 }}>
            {fueraDeEscala} de {analystActions.length} objetivos están en otra escala que el precio, casi siempre porque la
            fuente no ajustó un split. No se les calcula potencial y el sistema no los usa para decidir: mirá la fecha de cada uno
            y comparalo con el más reciente, que sí está en escala.
          </div>
        )}
        {analystActions.length === 0 ? <div className="muted">{newsScannedTo === null ? "sin titulares leídos: no hay de dónde reconocer una acción de analista" : "sin acciones reconocidas en los titulares leídos"}</div> : analystActions.map((a) => (
          <div key={a.url} className="mono"><span>{a.date}</span> · {a.firm} · {a.action}{a.rating ? ` ${a.rating}` : ""}{a.target !== null ? ` · objetivo ${a.target}` : ""}
            {a.target !== null && close ? (enEscala(a.target, close)
              ? <span className={a.target > close ? "ok" : "bad"}> ({(((a.target - close) / close) * 100).toFixed(0)}%)</span>
              : <span className="warn" title={`Objetivo ${(a.target / close).toFixed(1)} veces el precio de hoy. Eso no es una opinión audaz: es un precio de otra serie, casi siempre de antes de un split que la fuente no ajustó.`}> fuera de escala</span>) : null}
          </div>
        ))}
      </div>
    </>
  );
}
