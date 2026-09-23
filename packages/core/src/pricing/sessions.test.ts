import { describe, expect, it } from "vitest";
import { completedCandles, lastCompletedSession, localDateTime, marketOf, quoteIsStale } from "./sessions.js";

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

/**
 * Una cotización de ayer mostrada como si fuera de hoy (23/9/2026). AII no operó en IEX en toda la rueda, así
 * que el hub seguía sirviendo el último trade de ayer con `stale: false`: la app decía 26,005 mientras la acción
 * valía 25,33 (−2,6%). El umbral de 30 horas existe para el papel que dejó de operar, pero con el mercado
 * abierto una cotización de otro día es vieja aunque tenga 20 horas.
 */
describe("quoteIsStale", () => {
  const ayer = "2026-09-22T19:59:33Z"; // último trade de AII, 15:59 ET del martes

  it("con la rueda de hoy abierta, una cotización de ayer es vieja", () => {
    expect(quoteIsStale(ayer, new Date("2026-09-23T16:42:00Z"))).toBe(true); // 12:42 ET, mercado abierto
  });
  it("antes de la apertura, la cotización de ayer es la buena", () => {
    expect(quoteIsStale(ayer, new Date("2026-09-23T12:00:00Z"))).toBe(false); // 08:00 ET, pre-mercado
  });
  it("una cotización posterior al reloj no es vieja (relojes desfasados)", () => {
    expect(quoteIsStale("2026-09-23T16:40:00Z", new Date("2026-09-09T15:00:00Z"))).toBe(false);
  });
  it("una cotización de hoy nunca es vieja", () => {
    expect(quoteIsStale("2026-09-23T16:40:00Z", new Date("2026-09-23T16:42:00Z"))).toBe(false);
  });
  it("el sábado la del viernes no es vieja: no hay rueda contra la cual estarlo", () => {
    expect(quoteIsStale("2026-09-18T19:59:00Z", new Date("2026-09-19T16:00:00Z"))).toBe(false);
  });
  it("pero un papel que dejó de operar sí, pasadas 30 horas", () => {
    expect(quoteIsStale("2026-09-18T19:59:00Z", new Date("2026-09-20T16:00:00Z"))).toBe(true);
  });
  it("un feriado de mitad de semana no vuelve vieja la del día anterior", () => {
    // Acción de Gracias, jueves 26/11/2026: a las 11:00 ET la del miércoles al cierre es la que corresponde.
    expect(quoteIsStale("2026-11-25T21:00:00Z", new Date("2026-11-26T16:00:00Z"))).toBe(false);
  });
});
