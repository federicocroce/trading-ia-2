import { useEffect, useState } from "react";
import { api, type Registro, type TipoRegistro } from "./api";
import { SymbolLink } from "./SymbolLink";

/**
 * Registro de aciertos (10/10): "si hubieras hecho lo que dijo la app". Decisión del dueño: la confianza tiene que salir
 * de resultados medidos, no de explicaciones. Cada señal se mide desde el día en que se dijo, contra el S&P en el
 * mismo lapso. Una compra acierta si le gana al S&P; una venta o un veto aciertan si después rindieron menos.
 */
const TITULO: Record<TipoRegistro, string> = { compra_plan: "Compras del plan", venta_cartera: "Ventas de Cartera", veto_analista: "Vetos del analista" };
const ACIERTO: Record<TipoRegistro, string> = { compra_plan: "le ganó al S&P", venta_cartera: "rindió menos que el S&P (vender evitó la diferencia)", veto_analista: "rindió menos que el S&P (no comprar evitó la diferencia)" };
const pct = (n: number | null) => (n === null ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1).replace(".", ",")}%`);
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function RegistroCard() {
  const [r, setR] = useState<Registro | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.radar.registro().then(setR).catch((e: unknown) => setErr(String(e))); }, []);
  if (err) return <div className="card"><b>Registro</b> <span className="warn">no se pudo cargar: {err}</span></div>;
  if (!r) return <div className="card muted">Cargando el registro…</div>;
  return (
    <div className="card">
      <b>Registro de aciertos</b> <span className="muted">desde el {dm(r.desde)} · cada señal desde el día en que se dijo, contra el S&P en el mismo lapso</span>
      <table style={{ marginTop: 8 }}>
        <thead><tr><th>señal</th><th>cuántas</th><th>medidas</th><th>retorno medio</th><th>contra el S&P</th><th>acertó</th><th>qué es acertar</th></tr></thead>
        <tbody>
          {r.resumen.map((s) => (
            <tr key={s.tipo}>
              <td>{TITULO[s.tipo]}</td><td>{s.senales}</td><td>{s.medidas}</td><td>{pct(s.retornoMedioPct)}</td><td>{pct(s.alfaMedioPct)}</td>
              <td>{s.aciertoPct === null ? <span className="muted">sin medir todavía</span> : `${s.aciertoPct}%`}</td><td className="muted">{ACIERTO[s.tipo]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(["venta_cartera", "compra_plan", "veto_analista"] as const).map((tipo) => {
        const filas = r.filas.filter((f) => f.tipo === tipo).sort((a, b) => a.desde.localeCompare(b.desde));
        if (!filas.length) return null;
        return (
          <details key={tipo} style={{ marginTop: 10 }} open={tipo === "venta_cartera"}>
            <summary style={{ cursor: "pointer" }}>{TITULO[tipo]} ({filas.length})</summary>
            <table style={{ marginTop: 6 }}>
              <thead><tr><th>símbolo</th><th>desde</th><th>precio entonces</th><th>último</th><th>retorno</th><th>S&P</th><th>diferencia</th><th>acertó</th><th className="muted">detalle</th></tr></thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.symbol}-${f.desde}`}>
                    <td><SymbolLink symbol={f.symbol} /></td><td>{dm(f.desde)}</td><td>{f.precioDesde ?? "—"}</td><td>{f.precioHoy ?? "—"}{f.hoy ? <span className="muted"> ({dm(f.hoy)})</span> : null}</td>
                    <td>{pct(f.retornoPct)}</td><td>{pct(f.spyPct)}</td><td>{pct(f.alfaPct)}</td>
                    <td>{f.acerto === null ? <span className="muted">recién</span> : f.acerto ? "sí" : "no"}</td><td className="muted">{f.detalle ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        );
      })}
      <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>Precio de cierre del día de la señal contra el último cierre. Una señal de hoy se mide desde la próxima rueda. Las compras del plan se registran desde el 10/10: antes el plan se guardaba uno por mes y no quedaba historia diaria.</div>
    </div>
  );
}
