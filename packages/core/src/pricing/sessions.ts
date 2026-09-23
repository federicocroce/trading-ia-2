import type { Candle } from "../cartera/types.js";

/**
 * Sesiones cerradas. Yahoo y Alpaca devuelven la vela en curso del día durante la rueda; tomarla como
 * cierre produce stops, objetivos y cierres falsos (caso ZVRA 2026-09-09). Sin red: solo reloj y zona horaria.
 */
export type MarketId = "us" | "ar";
const MARKETS: Record<MarketId, { tz: string; closeMinutes: number }> = {
  us: { tz: "America/New_York", closeMinutes: 16 * 60 + 10 },
  ar: { tz: "America/Argentina/Buenos_Aires", closeMinutes: 17 * 60 + 10 },
};

export function localDateTime(now: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24; // algunos runtimes devuelven "24" a medianoche
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + Number(get("minute")) };
}

export const marketOf = (symbol: string): MarketId => (symbol.toUpperCase().endsWith(".BA") ? "ar" : "us");

/**
 * Feriados del NYSE. Van a mano porque no hay red acá y porque son diez fechas al año que se publican con
 * años de anticipación. Existen para `lastCompletedSession`: sin ellos, cada feriado dejaría a TODOS los
 * símbolos "desfasados" y un control que grita diez veces al año enseña a ignorarlo. Verificados contra las
 * velas guardadas: el 7/9/2026 (Labor Day) y el 19/6/2026 (Juneteenth) no tienen rueda en la base.
 * Los medios días (cierre 13:00) no están: el control se atrasa unas horas y vuelve solo, que es el lado
 * seguro (no avisa de más). BYMA todavía no tiene tabla: para `ar` solo cuentan los fines de semana.
 */
export const US_MARKET_HOLIDAYS: ReadonlySet<string> = new Set([
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24",
]);
const HOLIDAYS: Record<MarketId, ReadonlySet<string>> = { us: US_MARKET_HOLIDAYS, ar: new Set() };

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Mediodía UTC para que sumar y restar días no se cruce con ningún cambio de horario. */
const atNoon = (date: string) => new Date(`${date}T12:00:00Z`);
const esRueda = (d: Date, market: MarketId) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && !HOLIDAYS[market].has(iso(d));

/**
 * La última rueda que YA cerró. Es el calendario contra el que se contrasta hasta dónde llegan las velas:
 * `completedCandles` sabe descartar la vela de hoy, pero nada sabía que faltaba una sesión del medio. El 22/9/2026
 * Yahoo devolvió la rueda entera de EE.UU. vacía, las velas terminaron el 21/9 y el plan del 23/9 se armó sobre
 * ellas con los controles en cero, porque cada chequeo comparaba lo guardado contra lo guardado.
 */
export function lastCompletedSession(now: Date, market: MarketId = "us"): string {
  const m = MARKETS[market];
  const { date, minutes } = localDateTime(now, m.tz);
  const d = atNoon(date);
  if (minutes < m.closeMinutes) d.setUTCDate(d.getUTCDate() - 1); // la rueda de hoy todavía no cerró
  while (!esRueda(d, market)) d.setUTCDate(d.getUTCDate() - 1);
  return iso(d);
}

/** Descarta la última vela si es la sesión de hoy y todavía no cerró (cierre + 10 minutos). */
export function completedCandles(candles: Candle[], now: Date, market: MarketId = "us"): Candle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const m = MARKETS[market];
  const { date, minutes } = localDateTime(now, m.tz);
  return last.date === date && minutes < m.closeMinutes ? candles.slice(0, -1) : candles;
}
