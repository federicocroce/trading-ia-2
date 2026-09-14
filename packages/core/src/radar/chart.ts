import type { ChartBar } from "./types.js";

/**
 * Vela diaria de la última sesión armada con las barras intradiarias, para la sesión que la base todavía no
 * tiene. Las velas diarias entran con la corrida de la mañana siguiente, así que durante la rueda el gráfico
 * terminaba en el día anterior: el 14/9 APH mostraba su última vela en 83,92 con el precio ya en 79, y la
 * caída del día, la que más importa para decidir, no se veía. `null` si la base ya tiene esa sesión.
 * Nunca se guarda: es solo para dibujar. Los indicadores no se calculan sobre una vela sin cerrar.
 */
export function sessionBarFrom(intraday: ChartBar[], lastStoredDate: string): ChartBar | null {
  const valid = intraday.filter((b) => [b.open, b.high, b.low, b.close].every(Number.isFinite));
  if (!valid.length) return null;
  // Las sesiones de Nueva York y de Buenos Aires caen enteras dentro del mismo día UTC.
  const dayOf = (b: ChartBar) => new Date(b.time * 1000).toISOString().slice(0, 10);
  const last = dayOf(valid[valid.length - 1]!);
  if (last <= lastStoredDate) return null;
  const s = valid.filter((b) => dayOf(b) === last);
  return {
    time: Math.floor(Date.parse(last) / 1000),
    open: s[0]!.open,
    high: Math.max(...s.map((b) => b.high)),
    low: Math.min(...s.map((b) => b.low)),
    close: s[s.length - 1]!.close,
    volume: s.reduce((sum, b) => sum + (b.volume || 0), 0),
    partial: true,
  };
}
