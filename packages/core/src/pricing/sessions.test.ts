import { describe, expect, it } from "vitest";
import { completedCandles, localDateTime, marketOf } from "./sessions.js";

const candle = (date: string) => ({ date, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe("localDateTime", () => {
  it("convierte un instante UTC a fecha y minutos locales de Nueva York", () => {
    expect(localDateTime(new Date("2026-09-09T13:44:00Z"), "America/New_York")).toEqual({ date: "2026-09-09", minutes: 9 * 60 + 44 });
    expect(localDateTime(new Date("2026-09-10T02:30:00Z"), "America/New_York")).toEqual({ date: "2026-09-09", minutes: 22 * 60 + 30 });
  });
});

describe("completedCandles", () => {
  const series = [candle("2026-09-08"), candle("2026-09-09")];
  it("antes de las 16:10 de Nueva York descarta la vela de hoy", () => {
    expect(completedCandles(series, new Date("2026-09-09T13:44:00Z"))).toEqual([candle("2026-09-08")]);
    expect(completedCandles(series, new Date("2026-09-09T20:05:00Z"))).toEqual([candle("2026-09-08")]); // 16:05 ET
  });
  it("después del cierre la conserva", () => {
    expect(completedCandles(series, new Date("2026-09-09T20:11:00Z"))).toEqual(series); // 16:11 ET
    expect(completedCandles(series, new Date("2026-09-10T12:00:00Z"))).toEqual(series);
  });
  it("si la última vela no es de hoy no toca nada (fin de semana, feriado)", () => {
    expect(completedCandles([candle("2026-09-04")], new Date("2026-09-06T15:00:00Z"))).toEqual([candle("2026-09-04")]);
    expect(completedCandles([], new Date())).toEqual([]);
  });
  it("BYMA cierra a las 17:10 de Buenos Aires", () => {
    expect(completedCandles(series, new Date("2026-09-09T19:30:00Z"), "ar")).toEqual([candle("2026-09-08")]); // 16:30 ART
    expect(completedCandles(series, new Date("2026-09-09T20:15:00Z"), "ar")).toEqual(series); // 17:15 ART
  });
  it("marketOf: .BA es ar, el resto us", () => {
    expect(marketOf("GGAL.BA")).toBe("ar");
    expect(marketOf("ggal")).toBe("us");
  });
});
