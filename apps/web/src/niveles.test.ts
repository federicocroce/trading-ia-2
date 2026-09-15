import { describe, expect, it } from "vitest";
import { baseDelDia, cambioDelPeriodo, distanciaAlStop, notaDelSeguimiento, notaVelaParcial, relacionDeLaOrden, rotuloDelStop } from "./niveles";

describe("relacionDeLaOrden", () => {
  it("APH el 14/9: la ficha decía 18,0 a 1 midiendo desde el precio en vivo (79,04, a 1,6% del stop); la orden del Radar es 2 a 1 desde el techo", () => {
    const r = relacionDeLaOrden({ stop: 77.81, target: 101.18, price: 79.04, entryHigh: 85.6, desde: "Radar" })!;
    expect(r.ratio).toBeCloseTo(2, 1);
    expect(r.base).toBe(85.6);
    expect(r.texto).toBe("relación 2,0 : 1 desde el techo de compra 85,60, como en el Radar");
  });
  it("C2 (15/9): con posición no hay relación. TSM decía \"relación 67,8 : 1 desde el precio actual\" con el precio pegado al stop: (533,92 − 414,57) / (414,57 − 412,81)", () => {
    expect(relacionDeLaOrden({ stop: 412.81, target: 533.92, price: 414.57, entryHigh: 453.18, desde: "Cartera" })).toBeNull();
  });
  it("sin techo de compra, el Radar también mide desde el precio; sin stop u objetivo del lado correcto, no hay relación", () => {
    expect(relacionDeLaOrden({ stop: 90, target: 120, price: 100, entryHigh: null, desde: "Radar" })!.base).toBe(100);
    expect(relacionDeLaOrden({ stop: 101, target: 120, price: 100, entryHigh: null, desde: "Radar" })).toBeNull();
    expect(relacionDeLaOrden({ stop: 90, target: null, price: 100, entryHigh: 102, desde: "Radar" })).toBeNull();
  });
});

describe("distanciaAlStop (C2, 15/9)", () => {
  it("TSM el 15/9: con posición va la distancia al stop, no una relación; a 0,42% y 0,2 ATR (ATR 10,13), con aviso", () => {
    const d = distanciaAlStop({ price: 414.57, stop: 412.81, atr: 10.1286 })!;
    expect(d.pct).toBeCloseTo(0.4245, 3);
    expect(d.enAtr).toBeCloseTo(0.174, 2);
    expect(d.texto).toBe("a 0,42% del stop (0,2 ATR) desde el precio actual");
    expect(d.aviso).toBe("pegado al stop: a menos de 1 ATR, el movimiento de un día normal lo puede tocar");
  });
  it("lejos del stop no hay aviso; sin ATR, el aviso sale igual por estar a menos de 1%", () => {
    expect(distanciaAlStop({ price: 100, stop: 90, atr: 2 })!.aviso).toBeNull();
    const sinAtr = distanciaAlStop({ price: 100, stop: 99.5, atr: null })!;
    expect(sinAtr.texto).toBe("a 0,50% del stop desde el precio actual");
    expect(sinAtr.aviso).toBe("pegado al stop: a menos de 1%");
  });
  it("con el precio debajo del stop no hay distancia que mostrar (lo dice el aviso de precio debajo del stop)", () => {
    expect(distanciaAlStop({ price: 77.52, stop: 77.67, atr: 2 })).toBeNull();
    expect(distanciaAlStop({ price: null, stop: 77.67, atr: 2 })).toBeNull();
  });
});

describe("rotuloDelStop (C2, 15/9)", () => {
  it("NVDA el 15/9: fila OBSERVAR sin objetivo (bajo el stop); la línea decía \"stop de compra\" y es el stop dinámico, arriba del precio", () => {
    expect(rotuloDelStop({ desde: "Radar", target: null })).toBe("stop dinámico");
  });
  it("una compra que se puede ejecutar tiene su stop de compra; con posición, el stop de la posición", () => {
    expect(rotuloDelStop({ desde: "Radar", target: 103.17 })).toBe("stop de compra");
    expect(rotuloDelStop({ desde: "Cartera", target: 533.92 })).toBe("stop");
  });
});

describe("cambioDelPeriodo (C6, 15/9)", () => {
  const dia = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  // APH, velas reales de la base: 14/8 (apertura 82,825, cierre 83,555), 17/8 (apertura 83,975, cierre 85,435) … 14/9 (78,55).
  const aph = [
    { time: dia("2026-08-13"), open: 82.1, close: 82.7 },
    { time: dia("2026-08-14"), open: 82.825, close: 83.555 },
    { time: dia("2026-08-17"), open: 83.975, close: 85.435 },
    { time: dia("2026-09-11"), open: 82.42, close: 83.92 },
    { time: dia("2026-09-14"), open: 81.2, close: 78.55 },
  ];
  const ahora = dia("2026-09-15T19:00:00Z");
  it("APH el 15/9: \"1M −7,22%\" se medía desde la APERTURA del 17/8 sin decirlo; ahora es cierre contra cierre, desde el del 14/8, y lo dice", () => {
    const p = cambioDelPeriodo({ bars: aph, desde: ahora - 30 * 86_400, precio: 77.912, label: "1M", intradiario: false })!;
    expect(p.base).toBe(83.555);
    expect(p.baseTexto).toBe("desde el cierre del 14/8");
    expect(p.changePercent).toBeCloseTo(((77.912 - 83.555) / 83.555) * 100, 6);
    expect(p.label).toBe("1M");
  });
  it("sin vela anterior a la ventana (1A, 5A), la base es el cierre de la primera", () => {
    const p = cambioDelPeriodo({ bars: aph, desde: null, precio: null, label: "1A", intradiario: false })!;
    expect(p.base).toBe(82.7);
    expect(p.baseTexto).toBe("desde el cierre del 13/8");
    expect(p.changePercent).toBeCloseTo(((78.55 - 82.7) / 82.7) * 100, 6);
  });
  it("intradiario (1D, 1S): desde la apertura de la primera barra, con fecha y hora de Argentina", () => {
    const barras = [{ time: dia("2026-09-15T13:30:00Z"), open: 78.59, close: 78.3 }, { time: dia("2026-09-15T19:00:00Z"), open: 77.6, close: 77.52 }];
    const p = cambioDelPeriodo({ bars: barras, desde: null, precio: 77.52, label: "1D", intradiario: true })!;
    expect(p.base).toBe(78.59);
    expect(p.baseTexto).toBe("desde la apertura del 15/9 a las 10:30");
  });
  it("con menos de dos velas no hay cambio", () => {
    expect(cambioDelPeriodo({ bars: aph.slice(0, 1), desde: null, precio: 80, label: "1M", intradiario: false })).toBeNull();
  });
});

describe("baseDelDia (C6, 15/9)", () => {
  it("TSM: el cambio del día dice contra qué cierre se mide (el guardado del 14/9, el mismo de las velas)", () => {
    expect(baseDelDia("2026-09-14")).toBe("contra el cierre del 14/9");
  });
  it("sin cierre guardado de la sesión anterior, dice que es el de la fuente", () => {
    expect(baseDelDia(null)).toBe("contra el cierre previo de la fuente (todavía no guardado)");
    expect(baseDelDia(undefined)).toBe("contra el cierre previo de la fuente (todavía no guardado)");
  });
});

describe("notaDelSeguimiento (C9, 15/9)", () => {
  // APH en la lista de seguimiento el 15/9: alta el 14/9 a 79,025 con stop 77,81; evaluada con el cierre del 14/9 (78,55).
  const aph = { status: "live" as const, stopLoss: 77.81, lastPrice: 78.55, addedAt: "2026-09-14T17:00:48.529Z" };
  const velas = [{ date: "2026-09-11", close: 83.92 }, { date: "2026-09-14", close: 78.55 }];
  it("APH: \"VIVA −0,6%\" sale de tu nivel del alta (77,81) y del cierre del 14/9, mientras la cabecera dice 77,67 y el precio ya está debajo de los dos", () => {
    const n = notaDelSeguimiento(aph, { precio: 77.52, stopHoy: 77.67, velas })!;
    expect(n.texto).toBe("el estado de la lista se mide con tu nivel del alta (stop 77,81, del 14/9), no con el stop de hoy (77,67), y con el cierre del 14/9 (78,55)");
    expect(n.aviso).toBe("el precio de ahora (77,52) ya está debajo de tu nivel del alta: si cierra así, la lista la marca INVALIDADA");
  });
  it("con el precio arriba no hay aviso; resuelta o sin stop del alta, no hay nota", () => {
    expect(notaDelSeguimiento(aph, { precio: 79, stopHoy: 77.67, velas })!.aviso).toBeNull();
    expect(notaDelSeguimiento({ ...aph, status: "invalidated" }, { precio: 79, stopHoy: 77.67, velas })).toBeNull();
    expect(notaDelSeguimiento({ ...aph, stopLoss: null }, { precio: 79, stopHoy: 77.67, velas })).toBeNull();
  });
});

describe("notaVelaParcial", () => {
  const dia = (iso: string) => Math.floor(Date.parse(iso) / 1000);
  it("si la última vela es la sesión armada con el intradiario, lo dice con su fecha", () => {
    const nota = notaVelaParcial([{ time: dia("2026-09-11"), partial: false }, { time: dia("2026-09-14"), partial: true }]);
    expect(nota).toContain("14/9");
    expect(nota).toContain("todavía no cerró");
  });
  it("sin vela parcial, no hay nota", () => {
    expect(notaVelaParcial([{ time: dia("2026-09-11") }])).toBeNull();
    expect(notaVelaParcial([])).toBeNull();
  });
});
