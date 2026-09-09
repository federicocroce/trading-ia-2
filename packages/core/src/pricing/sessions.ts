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

/** Descarta la última vela si es la sesión de hoy y todavía no cerró (cierre + 10 minutos). */
export function completedCandles(candles: Candle[], now: Date, market: MarketId = "us"): Candle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const m = MARKETS[market];
  const { date, minutes } = localDateTime(now, m.tz);
  return last.date === date && minutes < m.closeMinutes ? candles.slice(0, -1) : candles;
}
