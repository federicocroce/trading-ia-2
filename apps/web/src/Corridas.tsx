import { useState } from "react";
import { api, type CatchUpStatus } from "./api";

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—");

/** Botón del encabezado: última corrida del pipeline. Click: panel con cada paso, su hora, su resultado y un botón para correrlo solo. */
export function CorridasButton({ st, onChanged }: { st: CatchUpStatus | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const errors = st?.steps.filter((s) => s.lastError).length ?? 0;
  const due = st?.due.length ?? 0;
  const cls = !st ? "muted" : st.running ? "warn" : errors ? "bad" : due ? "warn" : "ok";
  const text = !st ? "sin API" : st.running ? `corriendo ${st.current ? st.steps.find((s) => s.id === st.current)?.label ?? st.current : ""}…` : `última corrida ${fmt(st.lastRunAt)}`;
  return (
    <>
      <button className="ghost" onClick={() => setOpen(true)} title="Estado de cada paso del pipeline: cuándo corrió, con qué resultado, y correrlo a mano.">
        <span className={cls}>●</span> {text}{errors > 0 && <span className="bad"> · {errors} con error</span>}{!errors && due > 0 && !st?.running && <span className="warn"> · {due} pendiente{due > 1 ? "s" : ""}</span>}
      </button>
      {open && st && <CorridasModal st={st} onClose={() => setOpen(false)} onChanged={onChanged} />}
    </>
  );
}

function CorridasModal({ st, onClose, onChanged }: { st: CatchUpStatus; onClose: () => void; onChanged: () => void }) {
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
      <div className="modal" onClick={(e) => e.stopPropagation()}>
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
      </div>
    </div>
  );
}
