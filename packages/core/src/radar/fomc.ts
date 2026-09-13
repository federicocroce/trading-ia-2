/**
 * Reunión de la Fed y primer tramo del plan (2026-09-13). Puro.
 *
 * El 13/9 recomendé en el chat esperar a la decisión de la Fed del miércoles 16 antes del primer tramo: el mercado
 * daba una suba como lo más probable, con el bono a 10 años en 4,97%. Era un criterio mío que la app no tenía, y el
 * dueño pidió que no quede solo en el chat. Regla: si hay una decisión dentro de los próximos 3 días hábiles (o es
 * hoy), el primer tramo va desde el día hábil siguiente a la decisión.
 *
 * Sin probabilidad de mercado a propósito: la app no tiene una fuente gratuita y confiable de futuros de la tasa, y
 * esperar hasta 3 días hábiles cuesta poco se espere un cambio o no. Las fechas vienen de `config/fomc.json`.
 */
export const FOMC_WINDOW_BUSINESS_DAYS = 3;

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const isBusinessDay = (t: number) => {
  const d = new Date(t).getUTCDay();
  return d !== 0 && d !== 6;
};

/** Días hábiles (lunes a viernes) después de `from` y hasta `to` inclusive. 0 si `to` es `from`. */
function businessDaysUntil(from: string, to: string): number {
  let n = 0;
  for (let t = Date.parse(from) + DAY; t <= Date.parse(to); t += DAY) if (isBusinessDay(t)) n++;
  return n;
}

function nextBusinessDay(date: string): string {
  let t = Date.parse(date) + DAY;
  while (!isBusinessDay(t)) t += DAY;
  return iso(t);
}

/** Si hay que esperar a la Fed: la decisión y el primer día hábil después. null si no hay decisión cerca. */
export function firstTrancheFrom(today: string, decisions: string[], window = FOMC_WINDOW_BUSINESS_DAYS): { decision: string; from: string } | null {
  const next = [...decisions].filter((d) => d >= today).sort()[0];
  if (!next || businessDaysUntil(today, next) > window) return null;
  return { decision: next, from: nextBusinessDay(next) };
}
