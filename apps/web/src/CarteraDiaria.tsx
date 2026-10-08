import type { CurveResponse } from "./api";
import { diferenciaConCosto, filasDiarias, lecturaPicos, picos } from "./diaADia";
import { GananciaAcumuladaChart, GananciaDiariaChart } from "./DiariaChart";

const usd = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n < 0 ? "-" : ""}${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`);
const signed = (n: number | null | undefined, d = 0) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n > 0 ? "+" : ""}${usd(n, d)}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const pct2 = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(2)}%`);
const cls = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "" : n > 0 ? "ok" : n < 0 ? "bad" : "");

/**
 * Sub-pestaña "Día a día" de Cartera (1/10): cuánto ganaste o perdiste cada rueda en plata, el acumulado, y los
 * dos máximos históricos contra hoy.
 *
 * Todo sale de los puntos de la curva, que ya traen el aporte y la ganancia de cada día (`flowUsd`, `gainUsd`).
 * Por eso el día que aportás 6.500 esta pantalla no dice que ganaste 6.500: el aporte va en su columna.
 *
 * Tres números de esta pantalla NO son los de la pestaña Resumen, y cada diferencia está escrita abajo:
 * - va al CIERRE del último día con velas, no a los precios vivos de ahora;
 * - la ganancia acumulada es `valor − aportado`, no `valor − costo promedio` (el P&L de la tabla de posiciones);
 * - el % acumulado es sobre lo aportado, no el TWR de la curva.
 */
export function CarteraDiaria({ r, costUsd }: { r: CurveResponse | null; /** Costo promedio de las posiciones (el del P&L del Resumen), para decir en cuánto difiere de lo aportado. null si falta el precio de alguna. */ costUsd: number | null }) {
  if (!r) return <div className="card muted">Cargando la curva…</div>;
  if (r.error) return <div className="card"><b>Día a día</b> <span className="warn">no se pudo calcular: {r.error}</span></div>;
  const c = r.curve;
  if (!c) return <div className="card muted">Todavía no hay operaciones cargadas en dólares: sin ellas no hay historia que mostrar.</div>;
  const filas = filasDiarias(c.points);
  const p = picos(c.points);
  const hoy = filas[0];
  if (!p || !hoy) return <div className="card muted">La curva no tiene ni una rueda todavía.</div>;
  const l = lecturaPicos(p, c.to, (n) => `USD ${usd(n)}`);
  const conAporte = filas.filter((f) => f.flowUsd !== 0).length;
  const vsCosto = diferenciaConCosto(hoy.investedUsd, costUsd, c.adjustmentsUsd ?? 0, (n) => `USD ${usd(n)}`);

  return (
    <>
      <div className="card">
        <b>Día a día</b> <span className="muted">desde {c.from} · {c.sessions} ruedas · todo al cierre del {c.to}{c.complete ? "" : " · curva incompleta"}</span>
        <div className="kpis" style={{ marginTop: 8 }}>
          <div className="kpi"><b>{usd(hoy.valueUsd)}</b><span>valor al cierre del {c.to}</span></div>
          <div className="kpi"><b className={cls(hoy.gainTotalUsd)}>{signed(hoy.gainTotalUsd)}</b><span>ganancia acumulada (valor − aportado)</span></div>
          <div className="kpi"><b className={cls(hoy.gainTotalPct)}>{pct(hoy.gainTotalPct)}</b><span>sobre los {usd(hoy.investedUsd)} aportados (el total de la curva, {pct(c.portfolio.totalPct)}, es TWR)</span></div>
          <div className="kpi"><b className={cls(hoy.gainDayUsd)}>{signed(hoy.gainDayUsd)}</b><span>en la rueda del {c.to} ({pct2(hoy.returnPct)}){hoy.flowUsd !== 0 ? ` · ese día aportaste ${signed(hoy.flowUsd)}` : ""}</span></div>
        </div>
      </div>

      {/* Los dos máximos, que son distintos: con un aporte por mes el valor toca máximo sin que hayas ganado nada. */}
      <div className="card">
        <b>Máximo histórico contra hoy</b>
        <div style={{ marginTop: 8 }}><span className="muted">En plata:</span> {l.valor}</div>
        <div style={{ marginTop: 6 }}><span className="muted">En rendimiento:</span> {l.rendimiento}</div>
        {!p.rendimiento.esHoy && (
          <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
            Esos {Math.abs(p.rendimiento.puntos).toFixed(1)} puntos son una caída del {p.rendimiento.caidaPct.toFixed(1)}% desde ese máximo. La "caída máx." de la curva ({c.portfolio.maxDrawdownPct.toFixed(1)}%) es la peor de toda la serie: si el pozo más hondo fue otro día, no es el mismo número.
          </div>
        )}
      </div>

      <div className="card">
        <b>Ganancia acumulada en dólares</b> <span className="muted">valor menos aportado, rueda por rueda. Un aporte no mueve esta línea; la raya punteada es el máximo.</span>
        <GananciaAcumuladaChart points={c.points} />
        <div style={{ marginTop: 10 }}><b>Ganancia de cada día</b> <span className="muted">en dólares, ya sin los aportes{conAporte ? ` (${conAporte} ${conAporte === 1 ? "rueda tiene" : "ruedas tienen"} aportes o ventas)` : ""}</span></div>
        <GananciaDiariaChart points={c.points} />
      </div>

      <div className="card" style={{ maxHeight: 460, overflow: "auto" }}>
        <table>
          <thead>
            <tr>
              <th>fecha</th>
              <th title="Valor de mercado de las tenencias al cierre de ese día.">valor</th>
              <th title="Lo que ganaste o perdiste ESE día en plata, ya sin el aporte: valor de hoy − valor de ayer − aporte del día.">del día</th>
              <th title="El mismo retorno del día que usa la curva (TWR): un aporte no cuenta como ganancia.">% del día</th>
              <th title="Valor menos aportado hasta ese día: la ganancia de toda la historia.">acumulada</th>
              {/* 1/10: esta columna se llamaba "% acum." y la tarjeta de máximos dice "+51,7% acumulado (TWR)"
                  para el mismo día: dos cuentas distintas con la misma palabra. Acá se nombra la base. */}
              <th title="La ganancia acumulada dividida por lo aportado hasta ese día. NO es el total de la curva (TWR), que mide el rendimiento de tu plata en el tiempo y da otro número para el mismo día.">% sobre aportado</th>
              <th title="Aportes netos del día: compras menos ventas, más lo que un traspaso trae sin operación que lo explique. No es ganancia.">aporte</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.date}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>
                  {f.date}
                  {f.date === p.valor.date && <span className="chip" style={{ marginLeft: 6 }} title="El día que la cartera valió más en plata.">máx. valor</span>}
                  {f.date === p.rendimiento.date && <span className="chip" style={{ marginLeft: 6 }} title="El día que tu plata rendía más (índice TWR).">máx. rend.</span>}
                </td>
                <td className="mono">{usd(f.valueUsd)}</td>
                <td className={`mono ${cls(f.gainDayUsd)}`}>{signed(f.gainDayUsd)}</td>
                <td className={`mono ${cls(f.returnPct)}`}>{pct2(f.returnPct)}</td>
                <td className={`mono ${cls(f.gainTotalUsd)}`}>{signed(f.gainTotalUsd)}</td>
                <td className={`mono ${cls(f.gainTotalPct)}`}>{pct(f.gainTotalPct)}</td>
                <td className="mono">{f.flowUsd === 0 ? <span className="muted">—</span> : signed(f.flowUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cada diferencia contra la pestaña Resumen, dicha acá: si dos pantallas muestran números distintos de lo
          mismo, la que no explica por qué es la que está mal. */}
      <div className="card muted" style={{ fontSize: 12 }}>
        Todo en esta pantalla es al <b>cierre del {c.to}</b>, el último día con velas guardadas: el "valor ahora" del Resumen usa precios vivos y no tiene por qué coincidir.{" "}
        La <b>ganancia acumulada</b> es valor menos aportado ({usd(hoy.investedUsd)} puestos){c.adjustmentsUsd ? `, con los ${usd(c.adjustmentsUsd)} que un traspaso trae sin operación que lo explique contados como aporte` : ""}; el <b>P&amp;L</b> de la tabla de posiciones es valor menos costo promedio de lo que tenés hoy. Sobre una cartera con ventas o traspasos no dan lo mismo, y las dos están bien.{vsCosto ? ` ${vsCosto}` : ""}{" "}
        El <b>% acumulado</b> de la última columna es sobre lo aportado; el <b>total de la curva</b> ({pct(c.portfolio.totalPct)}) es TWR, el rendimiento de tu plata en el tiempo, donde un aporte no cuenta como ganancia: son dos preguntas distintas.{" "}
        Un dividendo reinvertido sí es ganancia del día (no entró plata y la tenencia vale más); un traspaso entre plataformas es la foto del saldo, no una compra.
        {c.warnings.length > 0 && <div style={{ marginTop: 6 }}>La curva tiene {c.warnings.length} {c.warnings.length === 1 ? "aviso" : "avisos"}: están en el Resumen, abajo de la curva.</div>}
      </div>
    </>
  );
}
