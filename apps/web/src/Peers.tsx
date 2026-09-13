import { SymbolLink } from "./SymbolLink";

/**
 * Tabla de comparables (13/9). Antes era una grilla de números crudos sin unidad, sin mediana y sin fecha:
 * "ROE 110.11" al lado de "deuda/patr. 0.05" al lado de "P/E 28.78", y el lector tenía que adivinar cuál era
 * un porcentaje, cuál un múltiplo y cuál una razón. Peor: el score compara cada métrica contra la MEDIANA
 * del grupo y esa mediana no estaba en ninguna parte, así que la tabla no permitía verificar el ranking que
 * la app muestra tres líneas más arriba.
 *
 * Ahora cada columna dice su unidad, hay una fila de mediana (la referencia real del puntaje) y se muestra
 * de cuándo son los fundamentals, que no son de hoy: vienen del último barrido.
 */
export interface PeerRow {
  symbol: string;
  metrics: Record<string, number | null>;
}

const COLUMNAS: Array<{ key: string; label: string; unidad: "x" | "%" | "r"; ayuda: string }> = [
  { key: "peTTM", label: "P/E", unidad: "x", ayuda: "Precio sobre ganancia de los últimos 12 meses. Más bajo es más barato; negativo o vacío = no gana plata." },
  { key: "evEbitdaTTM", label: "EV/EBITDA", unidad: "x", ayuda: "Valor de la empresa (incluida su deuda) sobre su ganancia operativa antes de amortizaciones. Comparable entre empresas con deudas distintas." },
  { key: "psTTM", label: "P/S", unidad: "x", ayuda: "Precio sobre ventas. Sirve cuando todavía no hay ganancia." },
  { key: "roeTTM", label: "ROE", unidad: "%", ayuda: "Ganancia sobre patrimonio. Con el patrimonio cerca de cero o negativo el número es un artefacto, no un mérito." },
  { key: "operatingMarginTTM", label: "margen op.", unidad: "%", ayuda: "Cuánto queda de cada 100 de ventas después de los costos del negocio, antes de intereses e impuestos." },
  { key: "revenueGrowthTTMYoy", label: "crec. ingresos", unidad: "%", ayuda: "Crecimiento de las ventas de los últimos 12 meses contra los 12 anteriores." },
  { key: "totalDebt/totalEquityAnnual", label: "deuda/patr.", unidad: "r", ayuda: "Veces que la deuda supera al patrimonio. Arriba de 20 el patrimonio prácticamente no existe y el ratio deja de medir apalancamiento." },
];

const fmt = (v: number | null | undefined, unidad: "x" | "%" | "r") => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (unidad === "%") return `${v.toFixed(1)}%`;
  if (unidad === "x") return `${v.toFixed(1)}×`;
  return v.toFixed(2);
};

/** Mediana de los valores presentes. Es la referencia contra la que el score mide cada eje. */
export function mediana(xs: Array<number | null | undefined>): number | null {
  const v = xs.filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
};

export function PeersTable({ own, ownMetrics, peers, asOf }: { own: string; ownMetrics: Record<string, number | null>; peers: PeerRow[]; asOf?: string | null | undefined }) {
  if (!peers.length) return null;
  const medianas = Object.fromEntries(COLUMNAS.map((c) => [c.key, mediana(peers.map((p) => p.metrics[c.key]))]));
  return (
    <>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>par</th>
            {COLUMNAS.map((c) => <th key={c.key} title={c.ayuda} style={{ cursor: "help" }}>{c.label} <span className="muted">{c.unidad === "r" ? "(veces)" : c.unidad === "x" ? "(×)" : "(%)"}</span></th>)}
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><b>{own}</b> <span className="muted">(propia)</span></td>
            {COLUMNAS.map((c) => <td key={c.key} className="mono">{fmt(ownMetrics[c.key], c.unidad)}</td>)}
          </tr>
          {/* La mediana del grupo es contra lo que el score mide cada eje: sin ella la tabla no permitía
              verificar el ranking que la app muestra arriba. */}
          <tr>
            <td className="muted" title="Es la referencia del puntaje: el score mide cada métrica en desviaciones típicas contra esta mediana, no contra un promedio.">mediana del grupo ({peers.length})</td>
            {COLUMNAS.map((c) => <td key={c.key} className="mono muted">{fmt(medianas[c.key], c.unidad)}</td>)}
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
        Fundamentals del último barrido{asOf ? `, del ${asOf}` : ""}, no de hoy. El puntaje compara cada métrica contra la mediana de esta tabla.
      </div>
    </>
  );
}
