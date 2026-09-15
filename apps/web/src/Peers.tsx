import { SymbolLink } from "./SymbolLink";
import { COLUMNAS, NO_CUENTA, celdaPropia, fmt, type Eje } from "./comparablesTabla";

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
 *
 * 15/9: decía "de eso salen el score y el ranking" con 7 de las 12 métricas del puntaje; ahora están las 12, agrupadas
 * por eje (`COLUMNAS`). Y en bancos pintaba en verde un crecimiento de ingresos que el ranking no usa (NBN 123,9%
 * contra una mediana de 53,2% calculada sin la industria de los pares): lo que el puntaje no usa va en gris.
 */
export interface PeerRow {
  symbol: string;
  metrics: Record<string, number | null>;
  /** Métricas que el puntaje no usa para esa empresa (en bancos, el crecimiento de ingresos de Finnhub). */
  excluded?: string[];
}

const EJES: Eje[] = ["valuación", "calidad", "crecimiento", "balance"];

export function PeersTable({ own, ownMetrics, peers, medians, asOf, ownExcluded }: { own: string; ownMetrics: Record<string, number | null>; peers: PeerRow[]; medians?: Record<string, number | null> | null | undefined; asOf?: string | null | undefined; ownExcluded?: string[] | undefined }) {
  if (!peers.length) return null;
  const n = peers.length + 1;
  const hayExcluidas = (ownExcluded?.length ?? 0) > 0 || peers.some((p) => p.excluded?.length);
  return (
    <div style={{ marginTop: 10 }}>
      <b>Contra quién se compara</b>
      <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
        La app puntúa a {own} comparándola con {peers.length} empresas del mismo negocio, en las {COLUMNAS.length} métricas de abajo. En cada columna mira si {own} está mejor o peor que
        la <b>mediana del grupo</b> (el valor del medio de los {n}, ella incluida). De eso salen el score y el ranking que aparecen arriba.
        En verde, donde {own} le gana a la mediana; en rojo, donde pierde.{hayExcluidas && " En gris, lo que el puntaje no usa para esa empresa (en bancos, el crecimiento de ingresos de Finnhub, que no es confiable)."}
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ marginTop: 6 }}>
          <thead>
            <tr>
              <th />
              {EJES.map((eje) => <th key={eje} colSpan={COLUMNAS.filter((c) => c.eje === eje).length} className="muted" style={{ fontSize: 10, fontWeight: 400, textTransform: "uppercase", letterSpacing: 0.4, textAlign: "center" }}>{eje}</th>)}
            </tr>
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
                const celda = celdaPropia({ key: c.key, valor: ownMetrics[c.key], mediana: medians?.[c.key], excluida: !!ownExcluded?.includes(c.key) });
                return <td key={c.key} className={`mono ${celda.clase}`} title={celda.title}>{celda.texto}</td>;
              })}
            </tr>
            <tr>
              <td className="muted" title="El valor del medio del grupo, la propia incluida, con las mismas reglas que el puntaje. Es contra esto que se mide cada columna.">mediana de los {n}</td>
              {COLUMNAS.map((c) => <td key={c.key} className="mono muted" title={medians && medians[c.key] === null ? "Sin mediana: ninguna empresa del grupo tiene un dato que el puntaje use en esta columna." : undefined}>{medians ? fmt(medians[c.key], c.unidad) : "—"}</td>)}
            </tr>
            {peers.map((p) => (
              <tr key={p.symbol}>
                <td><SymbolLink symbol={p.symbol} /></td>
                {COLUMNAS.map((c) => {
                  const fuera = !!p.excluded?.includes(c.key);
                  return <td key={c.key} className={`mono${fuera ? " muted" : ""}`} title={fuera ? NO_CUENTA : undefined}>{fmt(p.metrics[c.key], c.unidad)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
        Datos del último barrido de fundamentals{asOf ? `, del ${asOf}` : ""}, no de hoy. Pasá el mouse por el nombre de cada columna para ver qué mide.
      </div>
    </div>
  );
}
