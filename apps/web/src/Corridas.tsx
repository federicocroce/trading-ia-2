import { useState } from "react";
import { api, type CatchUpStatus, type UsageSummary } from "./api";
import { goToTab } from "./SymbolLink";
import { corteDelDia, cuotaDiaria } from "./usoTextos";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");
const n = (v: number) => v.toLocaleString("es-AR");
const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v)}%`);
const usd = (v: number) => `USD ${v.toFixed(3)}`;

/** Botón del encabezado: última corrida del pipeline. Click: panel con cada paso, su hora, su resultado, un botón para correrlo solo, y el uso de fuentes externas del día. */
export function CorridasButton({ st, usage, onChanged }: { st: CatchUpStatus | null; usage: UsageSummary | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const errors = st?.steps.filter((s) => s.lastError).length ?? 0;
  const due = st?.due.length ?? 0;
  const warn = usage?.warnings.length ?? 0;
  const cls = !st ? "muted" : st.running ? "warn" : errors ? "bad" : due || warn ? "warn" : "ok";
  const text = !st ? "sin API" : st.running ? `corriendo ${st.current ? st.steps.find((s) => s.id === st.current)?.label ?? st.current : ""}…` : `última corrida ${fmt(st.lastRunAt)}`;
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)} title="Estado de cada paso del pipeline: cuándo corrió, con qué resultado, correrlo a mano; y cuánto se usó de cada fuente externa hoy.">
        <span className={cls}>●</span> {text}{errors > 0 && <span className="bad"> · {errors} con error</span>}{!errors && due > 0 && !st?.running && <span className="warn"> · {due} pendiente{due > 1 ? "s" : ""}</span>}{warn > 0 && <span className="warn" title={usage?.warnings.join("\n")}> · uso: {warn} aviso{warn > 1 ? "s" : ""}</span>}
      </button>
      {open && st && <CorridasModal st={st} usage={usage} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function CorridasModal({ st, usage, onClose, onChanged }: { st: CatchUpStatus; usage: UsageSummary | null; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  async function run(id: string | null) {
    setBusy(id ?? "*");
    setMsg(null);
    try {
      const r = id ? await api.catchup.runStep(id) : await api.catchup.run();
      setMsg(r.ran.length ? r.ran.map((x) => `${x.label}: ${x.ok ? x.detail : `falló (${x.detail})`}`).join(" · ") : "No había nada pendiente.");
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(null);
      onChanged();
    }
  }
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 1080 }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Corridas del pipeline</h2>
          <div className="row">
            <button className="primary" disabled={!!busy || st.running} onClick={() => void run(null)}>{busy === "*" ? "Corriendo…" : "Ponerme al día (solo lo pendiente)"}</button>
            <button className="ghost" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Cada paso corre solo a su hora si la máquina está prendida; si no, se pone al día al arrancar y cada 30 minutos. Un paso con error queda pendiente y se reintenta en el próximo chequeo; también podés correrlo acá.</p>
        {msg && <div className="card" style={{ marginTop: 6 }}>{msg}</div>}
        <table style={{ marginTop: 8 }}>
          <thead><tr><th>paso</th><th>corre solo</th><th>última corrida buena</th><th>resultado</th><th>último error</th><th>estado</th><th></th></tr></thead>
          <tbody>
            {st.steps.map((s) => (
              <tr key={s.id}>
                <td><b>{s.label}</b></td>
                <td className="muted">{s.schedule}</td>
                <td className="mono">{fmt(s.ranAt)}{s.lastDate && <span className="muted"> · cubre {s.lastDate}</span>}</td>
                <td className="muted" style={{ maxWidth: 320 }}>{s.detail ?? "—"}</td>
                <td className="bad" style={{ maxWidth: 260 }}>{s.lastError ? <span title={s.lastError}>{fmt(s.lastErrorAt)} · {s.lastError.slice(0, 80)}</span> : <span className="muted">—</span>}</td>
                <td>{s.running ? <span className="verb OBSERVAR">corriendo</span> : s.due ? <span className="verb REVISAR" title={`esperada para ${s.expected}`}>pendiente</span> : <span className="ok">✓ al día</span>}</td>
                <td><button className="ghost" disabled={!!busy || st.running} onClick={() => void run(s.id)} title="Correr solo este paso ahora, esté pendiente o no.">{busy === s.id ? "…" : "Correr"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <UsagePanel u={usage} />
      </div>
    </div>
  );
}

/** Uso de fuentes externas del día: una fila por pedido saliente, agrupada contra los límites conocidos del plan gratis. */
function UsagePanel({ u }: { u: UsageSummary | null }) {
  if (!u) return <p className="muted" style={{ marginTop: 14 }}>Uso de fuentes externas: sin datos (la API no respondió).</p>;
  return (
    <>
      <h3 style={{ marginTop: 18 }}>Uso de fuentes externas · {u.date} <button className="ghost" style={{ marginLeft: 8, fontSize: 12, padding: "3px 8px" }} onClick={() => goToTab("uso")}>Ver pestaña Uso</button></h3>
      <p className="muted">Cada pedido a Gemini, Finnhub, Alpaca, SEC o Yahoo queda registrado con su paso, resultado y tiempo. Gemini: la cuota es por modelo y por clave (cada clave es un proyecto), 10 por minuto. La cuota diaria real no la publica Google y en la práctica se agotó entre 15 y 26 llamadas por modelo y clave (10 y 11 de septiembre). {corteDelDia(u.quotaResetAt ?? null)} El costo es lo que valdría en el plan pago.</p>
      {u.warnings.length > 0 && <div className="card bad" style={{ marginTop: 6 }}>{u.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>}
      {u.total.calls === 0 ? (
        <p className="muted">Todavía no hubo pedidos salientes hoy.</p>
      ) : (
        <>
          <table>
            <thead><tr><th>fuente</th><th>llamadas</th><th>con error</th><th>pico por minuto</th><th>límite por minuto</th><th title="Pico del minuto dividido por el límite por minuto.">% del límite por minuto</th></tr></thead>
            <tbody>
              {u.bySource.map((r) => (
                <tr key={r.source}>
                  <td><b>{r.source}</b></td>
                  <td className="mono">{n(r.calls)}</td>
                  <td className={r.errors ? "bad mono" : "mono"}>{n(r.errors)}</td>
                  <td className="mono">{n(r.peakPerMinute)}</td>
                  <td className="mono muted">{r.limitPerMinute ?? "—"}</td>
                  <td className={r.pctMinute !== null && r.pctMinute >= 80 ? "warn mono" : "mono"}>{pct(r.pctMinute)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {u.gemini.rows.length > 0 && (
            <>
              <p className="muted" style={{ marginBottom: 2 }}>Gemini por modelo y clave · tokens {n(u.gemini.tokensIn)} entrada / {n(u.gemini.tokensOut)} salida / {n(u.gemini.tokensThink)} pensamiento · costo equivalente {usd(u.gemini.costUsd)}{u.gemini.failedPct !== null && <span className={u.gemini.failedPct >= 20 ? " warn" : ""}> · falló {pct(u.gemini.failedPct)}</span>}</p>
              <div style={{ overflowX: "auto" }}>
              <table>
                <thead><tr><th>modelo</th><th>clave</th><th>llamadas</th><th>ok</th><th>429 minuto</th><th>429 día</th><th title="429 sin decir qué límite: no es la cuota diaria.">429 sin detalle</th><th>saturado</th><th>validación</th><th>error</th><th>tokens entrada</th><th>salida + pensamiento</th><th>costo</th><th>cuota diaria</th></tr></thead>
                <tbody>
                  {u.gemini.rows.map((g) => {
                    const cuota = cuotaDiaria(g);
                    return (
                      <tr key={`${g.model}#${g.keyIndex}`}>
                        <td className="mono">{g.model}</td>
                        <td className="mono">{g.keyIndex}</td>
                        <td className="mono">{n(g.calls)}</td>
                        <td className="mono ok">{n(g.ok)}</td>
                        <td className={g.rpm ? "warn mono" : "mono muted"}>{n(g.rpm)}</td>
                        <td className={g.rpd ? "bad mono" : "mono muted"}>{n(g.rpd)}</td>
                        <td className={g.limite ? "warn mono" : "mono muted"}>{n(g.limite ?? 0)}</td>
                        <td className={g.saturado ? "warn mono" : "mono muted"}>{n(g.saturado)}</td>
                        <td className={g.validacion ? "warn mono" : "mono muted"}>{n(g.validacion)}</td>
                        <td className={g.error ? "bad mono" : "mono muted"}>{n(g.error)}</td>
                        <td className="mono">{n(g.tokensIn)}</td>
                        <td className="mono">{n(g.tokensOut + g.tokensThink)}</td>
                        <td className="mono">{usd(g.costUsd)}</td>
                        <td className={cuota.tono}>{cuota.texto}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            </>
          )}
          <p className="muted" style={{ marginBottom: 2 }}>Por paso</p>
          <table>
            <thead><tr><th>paso</th><th>fuente</th><th>llamadas</th><th>con error</th><th>tiempo total</th></tr></thead>
            <tbody>
              {u.byStep.map((r) => (
                <tr key={`${r.step}|${r.source}`}>
                  <td><b>{r.step}</b></td>
                  <td className="muted">{r.source}</td>
                  <td className="mono">{n(r.calls)}</td>
                  <td className={r.errors ? "bad mono" : "mono"}>{n(r.errors)}</td>
                  <td className="mono muted">{(r.ms / 1000).toFixed(1)} s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">Total del día: {n(u.total.calls)} llamadas, {n(u.total.errors)} con error, costo equivalente {usd(u.total.costUsd)}.</p>
        </>
      )}
    </>
  );
}
