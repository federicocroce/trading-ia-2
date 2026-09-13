import { SymbolLink } from "./SymbolLink";

/**
 * Tabla de comparables.
 *
 * 13/9, primera versión: tenía unidades, mediana y fecha, pero el dueño la miró y dijo "no entiendo qué es
 * esa tabla". Tenía razón por tres motivos, y uno era un error mío:
 *
 * 1. No decía para qué estaba. Es la EVIDENCIA del puntaje: la app compara a la empresa contra estas otras
 *    del mismo negocio, métrica por métrica, y de ahí salen el score y el "rank 1 de 9". Sin decirlo, era
 *    una grilla de números sin pregunta.
 * 2. No decía hacia dónde es mejor cada columna. En P/E lo bajo es bueno; en margen, lo alto. Sin eso no se
 *    puede leer si APH con 39,7× contra 66,0× está bien o mal.
 * 3. La mediana estaba MAL: la recalculaba acá, excluyendo a la propia empresa y sin descartar los P/E
 *    negativos. Mostraba "mediana del grupo (8)" y 67,3× cuando el puntaje usaba 66,0× sobre nueve. Ahora
 *    viene del servidor, del mismo cálculo que el puntaje (`groupMedians`), y no se recalcula acá nunca.
 *
 * Y se marca en verde o rojo si la propia está mejor o peor que la mediana, que es exactamente la lectura
 * que el puntaje hace de cada columna.
 */
export interface PeerRow {
  symbol: string;
  metrics: Record<string, number | null>;
}

type Unidad = "x" | "%" | "r";
const COLUMNAS: Array<{ key: string; label: string; unidad: Unidad; mejor: "bajo" | "alto"; ayuda: string }> = [
  { key: "peTTM", label: "P/E", unidad: "x", mejor: "bajo", ayuda: "Precio sobre ganancia de los últimos 12 meses: cuántos años de ganancia pagás. Más bajo es más barato. Vacío = no gana plata, y entonces no cuenta para la mediana." },
  { key: "evEbitdaTTM", label: "EV/EBITDA", unidad: "x", mejor: "bajo", ayuda: "Lo mismo que el P/E pero incluyendo la deuda de la empresa. Sirve para comparar empresas con deudas distintas. Más bajo es más barato." },
  { key: "psTTM", label: "P/S", unidad: "x", mejor: "bajo", ayuda: "Precio sobre ventas. Útil cuando todavía no hay ganancia. Más bajo es más barato." },
  { key: "roeTTM", label: "ROE", unidad: "%", mejor: "alto", ayuda: "Cuánto gana por cada 100 que ponen los accionistas. Más alto es mejor, salvo que el patrimonio esté cerca de cero: ahí el número se infla solo." },
  { key: "operatingMarginTTM", label: "margen op.", unidad: "%", mejor: "alto", ayuda: "De cada 100 de ventas, cuánto queda después de los costos del negocio. Más alto es mejor." },
  { key: "revenueGrowthTTMYoy", label: "crec. ingresos", unidad: "%", mejor: "alto", ayuda: "Cuánto crecieron las ventas de los últimos 12 meses contra los 12 anteriores. Más alto es mejor." },
  { key: "totalDebt/totalEquityAnnual", label: "deuda/patr.", unidad: "r", mejor: "bajo", ayuda: "Veces que la deuda supera al patrimonio. Más bajo es más sano. Arriba de 20 el patrimonio prácticamente no existe." },
];

const fmt = (v: number | null | undefined, unidad: Unidad) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unidad === "%") return `${v.toFixed(1)}%`;
  if (unidad === "x") return `${v.toFixed(1)}×`;
  return v.toFixed(2);
};

/** ¿La propia está mejor que la mediana en esta columna? null si falta alguno de los dos. */
const mejorQueLaMediana = (propia: number | null | undefined, med: number | null | undefined, mejor: "bajo" | "alto"): boolean | null => {
  if (propia === null || propia === undefined || med === null || med === undefined || !Number.isFinite(propia)) return null;
  if (propia === med) return null;
  return mejor === "bajo" ? propia < med : propia > med;
};

export function PeersTable({ own, ownMetrics, peers, medians, asOf }: { own: string; ownMetrics: Record<string, number | null>; peers: PeerRow[]; medians?: Record<string, number | null> | null | undefined; asOf?: string | null | undefined }) {
  if (!peers.length) return null;
  const n = peers.length + 1;
  return (
    <div style={{ marginTop: 10 }}>
      <b>Contra quién se compara</b>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        La app puntúa a {own} comparándola con {peers.length} empresas del mismo negocio. En cada columna mira si {own} está mejor o peor que
        la <b>mediana del grupo</b> (el valor del medio de los {n}, ella incluida). De eso salen el score y el ranking que aparecen arriba.
        En verde, donde {own} le gana a la mediana; en rojo, donde pierde.
      </div>
      <table style={{ marginTop: 6 }}>
        <thead>
          <tr>
            <th>empresa</th>
            {COLUMNAS.map((c) => (
              <th key={c.key} title={c.ayuda} style={{ cursor: "help" }}>
                {c.label}
                <div className="muted" style={{ fontSize: 10, fontWeight: 400 }}>{c.mejor === "bajo" ? "↓ mejor" : "↑ mejor"}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>{own}</b></td>
            {COLUMNAS.map((c) => {
              const v = ownMetrics[c.key];
              const gana = mejorQueLaMediana(v, medians?.[c.key], c.mejor);
              return <td key={c.key} className={`mono ${gana === true ? "ok" : gana === false ? "bad" : ""}`}>{fmt(v, c.unidad)}</td>;
            })}
          </tr>
          <tr>
            <td className="muted" title="El valor del medio del grupo, la propia incluida, con las mismas reglas que el puntaje. Es contra esto que se mide cada columna.">mediana de los {n}</td>
            {COLUMNAS.map((c) => <td key={c.key} className="mono muted">{medians ? fmt(medians[c.key], c.unidad) : "—"}</td>)}
          </tr>
          {peers.map((p) => (
            <tr key={p.symbol}>
              <td><SymbolLink symbol={p.symbol} /></td>
              {COLUMNAS.map((c) => <td key={c.key} className="mono">{fmt(p.metrics[c.key], c.unidad)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Datos del último barrido de fundamentals{asOf ? `, del ${asOf}` : ""}, no de hoy. Pasá el mouse por el nombre de cada columna para ver qué mide.
      </div>
    </div>
  );
}
