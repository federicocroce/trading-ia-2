/**
 * La fecha de una corrida (2026-09-11). Puro.
 *
 * Todo el código usaba `new Date().toISOString().slice(0, 10)`, que es la fecha en UTC. En Argentina
 * (UTC−3) eso significa que a partir de las 21:00 la app cree que es el día siguiente. Una corrida a las
 * 22:17 del 11 de septiembre escribió 130 filas fechadas el 12: precios de dos ruedas atrás guardados con
 * fecha de mañana, `nthAppearance` adelantado un día (lo que acerca el "residente crónico" antes de tiempo),
 * el selector de corridas mostrando una fecha futura, y veredictos dados vuelta. El chequeo de consistencia
 * lo cazó con 63 hallazgos graves de precio.
 *
 * La fecha de la corrida es la del calendario donde está la persona que la mira, no la de Greenwich.
 */
export function todayLocal(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
