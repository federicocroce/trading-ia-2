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
 *
 * MEDIDA el 10/10/2026 (hasta ahí era criterio mío). Velas de la app, 910 acciones de EE.UU., sep-2024 a oct-2026;
 * fechas oficiales de la Fed (17 decisiones) y del BLS para la inflación (24 publicaciones). Cierre anterior a cierre
 * del día, ATR de los 14 días previos:
 *
 *   día          cae >1 ATR   cae >2 ATR   retorno medio
 *   normal          12,7%        1,75%        +0,11%
 *   inflación       13,1%        1,26%        +0,08%
 *   Fed             18,7%        3,43%        −0,41%
 *
 * Son 17 fechas, no 14.000 observaciones (las acciones se mueven juntas). Por fecha: la mediana de acciones que caen
 * más de 1 ATR es 16% en día de Fed contra 10% en día normal, y 10 de 16 días de Fed quedan arriba de la mediana
 * normal. Con tasas subiendo es consistente: las cuatro decisiones de abril a septiembre de 2026 cayeron peor que el
 * 85% de los días normales. La regla se sostiene.
 *
 * Y por eso NO hay regla para la inflación: el día del dato no se distingue de un día normal en las acciones que
 * compra la app. Agregarla sería frenar sin evidencia.
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
