/**
 * Columnas y celdas de la tabla de comparables. Puro, para poder probarlo sin dibujar nada.
 *
 * Son las 12 métricas del puntaje (`AXIS_METRICS` en packages/core/src/radar/ranking.ts), en el orden de sus ejes y con
 * su mismo sentido; el test lo compara. Hasta el 15/9 la tabla mostraba 7 y decía "de eso salen el score y el ranking":
 * faltaban margen neto, crecimiento a 5 años, crecimiento de EPS, crecimiento del trimestre y liquidez corriente.
 */
export type Unidad = "x" | "%" | "r";
export type Eje = "valuación" | "calidad" | "crecimiento" | "balance";
export interface Columna { key: string; label: string; unidad: Unidad; mejor: "bajo" | "alto"; eje: Eje; ayuda: string }

export const COLUMNAS: Columna[] = [
  { key: "peTTM", label: "P/E", unidad: "x", mejor: "bajo", eje: "valuación", ayuda: "Precio sobre ganancia de los últimos 12 meses: cuántos años de ganancia pagás. Más bajo es más barato. Vacío = no gana plata, y entonces no cuenta para la mediana." },
  { key: "evEbitdaTTM", label: "EV/EBITDA", unidad: "x", mejor: "bajo", eje: "valuación", ayuda: "Lo mismo que el P/E pero incluyendo la deuda de la empresa. Sirve para comparar empresas con deudas distintas. Más bajo es más barato." },
  { key: "psTTM", label: "P/S", unidad: "x", mejor: "bajo", eje: "valuación", ayuda: "Precio sobre ventas. Útil cuando todavía no hay ganancia. Más bajo es más barato." },
  { key: "roeTTM", label: "ROE", unidad: "%", mejor: "alto", eje: "calidad", ayuda: "Cuánto gana por cada 100 que ponen los accionistas. Más alto es mejor, salvo que el patrimonio esté cerca de cero: ahí el número se infla solo." },
  { key: "operatingMarginTTM", label: "margen op.", unidad: "%", mejor: "alto", eje: "calidad", ayuda: "De cada 100 de ventas, cuánto queda después de los costos del negocio. Más alto es mejor." },
  { key: "netProfitMarginTTM", label: "margen neto", unidad: "%", mejor: "alto", eje: "calidad", ayuda: "De cada 100 de ventas, cuánto queda de ganancia después de todo (intereses e impuestos incluidos). Más alto es mejor." },
  { key: "revenueGrowthTTMYoy", label: "crec. ingresos 12m", unidad: "%", mejor: "alto", eje: "crecimiento", ayuda: "Cuánto crecieron las ventas de los últimos 12 meses contra los 12 anteriores. Más alto es mejor. En bancos el puntaje no lo usa: el dato de Finnhub no es confiable (NBN +124% contra +4% real)." },
  { key: "revenueGrowth5Y", label: "crec. ingresos 5a", unidad: "%", mejor: "alto", eje: "crecimiento", ayuda: "Crecimiento anual promedio de las ventas en 5 años. Más alto es mejor." },
  { key: "epsGrowthTTMYoy", label: "crec. EPS 12m", unidad: "%", mejor: "alto", eje: "crecimiento", ayuda: "Cuánto creció la ganancia por acción de los últimos 12 meses contra los 12 anteriores. Más alto es mejor." },
  { key: "revenueGrowthQuarterlyYoy", label: "crec. ingresos trim.", unidad: "%", mejor: "alto", eje: "crecimiento", ayuda: "Ventas del último trimestre contra el mismo del año anterior. Pesa igual que el año: un trimestre en baja no queda tapado. En bancos el puntaje no lo usa." },
  { key: "totalDebt/totalEquityAnnual", label: "deuda/patr.", unidad: "r", mejor: "bajo", eje: "balance", ayuda: "Veces que la deuda supera al patrimonio. Más bajo es más sano. Arriba de 20 el patrimonio prácticamente no existe." },
  { key: "currentRatioAnnual", label: "liquidez", unidad: "r", mejor: "alto", eje: "balance", ayuda: "Activo corriente sobre pasivo corriente: cuántas veces cubre lo que vence en el año. Más alto es más holgado." },
];

export const fmt = (v: number | null | undefined, unidad: Unidad) => {
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

export const NO_CUENTA = "El puntaje no lo usa para esta empresa: en bancos, el crecimiento de ingresos que da Finnhub no es confiable (NBN +124% contra +4% real). Se muestra, pero no suma ni resta.";

/**
 * Celda de la propia empresa. Verde si le gana a la mediana, rojo si pierde, gris si el puntaje no usa esa métrica para
 * ella. El 15/9 NBN tenía su 123,9% en verde contra una mediana de 53,2% que el ranking no usa.
 */
export function celdaPropia(i: { key: string; valor: number | null | undefined; mediana: number | null | undefined; excluida: boolean }): { texto: string; clase: string; title: string | undefined } {
  const col = COLUMNAS.find((c) => c.key === i.key)!;
  const texto = fmt(i.valor, col.unidad);
  if (i.excluida) return { texto, clase: "muted", title: NO_CUENTA };
  const gana = mejorQueLaMediana(i.valor, i.mediana, col.mejor);
  return { texto, clase: gana === true ? "ok" : gana === false ? "bad" : "", title: undefined };
}
