import { describe, expect, it } from "vitest";
import { completedCandles, lastCompletedSession, localDateTime, marketOf } from "./sessions.js";

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

/**
 * Cuál es la última rueda que YA cerró (23/9/2026). Sin esto nada sabía que faltaba una sesión: el 22/9 Yahoo
 * devolvió la rueda entera de EE.UU. vacía, las velas terminaron el 21/9 y el plan del 23/9 se armó sobre ellas
 * con los controles en cero. Los feriados van en tabla: sin ellos cada feriado del NYSE dejaría a TODOS los
 * símbolos "desfasados" y un control que grita diez veces al año enseña a ignorarlo.
 */
describe("lastCompletedSession", () => {
  it("durante la rueda de hoy la última cerrada es la anterior; después del cierre, hoy", () => {
    expect(lastCompletedSession(new Date("2026-09-23T15:00:00Z"))).toBe("2026-09-22"); // 11:00 ET, mercado abierto
    expect(lastCompletedSession(new Date("2026-09-23T20:15:00Z"))).toBe("2026-09-23"); // 16:15 ET, ya cerró
  });
  it("el fin de semana no cuenta: el lunes temprano la última es el viernes", () => {
    expect(lastCompletedSession(new Date("2026-09-21T13:00:00Z"))).toBe("2026-09-18"); // lunes 09:00 ET
    expect(lastCompletedSession(new Date("2026-09-20T18:00:00Z"))).toBe("2026-09-18"); // domingo
  });
  it("saltea los feriados del NYSE", () => {
    // 7/9/2026 es Labor Day: el martes 8 a las 09:00 ET la última rueda cerrada es el viernes 4.
    expect(lastCompletedSession(new Date("2026-09-08T13:00:00Z"))).toBe("2026-09-04");
    // 19/6/2026 (Juneteenth) cae viernes: el lunes 22 temprano la última es el jueves 18.
    expect(lastCompletedSession(new Date("2026-06-22T13:00:00Z"))).toBe("2026-06-18");
  });
  it("BYMA cierra más tarde: a las 16:30 de Buenos Aires la rueda de hoy todavía no cerró", () => {
    expect(lastCompletedSession(new Date("2026-09-23T19:30:00Z"), "ar")).toBe("2026-09-22");
    expect(lastCompletedSession(new Date("2026-09-23T20:15:00Z"), "ar")).toBe("2026-09-23");
  });
});
