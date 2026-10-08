import { describe, expect, it } from "vitest";
import { diferenciaConCosto, filasDiarias, lecturaPicos, picos } from "./diaADia";
import type { CurvePoint } from "./api";

/** Un punto de la curva con los campos que ahora trae (`flowUsd`, `gainUsd`, `returnPct`, `investedUsd`). */
const pt = (date: string, value: number, index: number, invested: number, flow = 0, gain = 0, returnPct = 0): CurvePoint =>
  ({ date, value, index, spyIndex: 100, flowUsd: flow, gainUsd: gain, returnPct, investedUsd: invested });

/**
 * El caso que importa: el valor tocó máximo el 02, cayó, y después aportaste. Hoy valés menos que el máximo
 * pero con 500 más puestos: la resta en plata (400) dice menos de lo que pasó.
 */
const SERIE: CurvePoint[] = [
  pt("2026-01-01", 1000, 100, 1000, 1000, 0, 0),
  pt("2026-01-02", 2000, 200, 1000, 0, 1000, 100),
  pt("2026-01-03", 1100, 110, 1000, 0, -900, -45),
  pt("2026-01-04", 1600, 110, 1500, 500, 0, 0),
];

describe("filasDiarias", () => {
  it("más nuevo arriba, con el aporte del día y la ganancia acumulada contra lo aportado", () => {
    const filas = filasDiarias(SERIE);
    expect(filas.map((f) => f.date)).toEqual(["2026-01-04", "2026-01-03", "2026-01-02", "2026-01-01"]);
    // Hoy: 1.600 con 1.500 aportados. La ganancia acumulada es 100, no los 500 que entraron ese día.
    expect(filas[0]).toEqual({ date: "2026-01-04", valueUsd: 1600, gainDayUsd: 0, returnPct: 0, flowUsd: 500, investedUsd: 1500, gainTotalUsd: 100, gainTotalPct: 6.67 });
    expect(filas[2]).toEqual({ date: "2026-01-02", valueUsd: 2000, gainDayUsd: 1000, returnPct: 100, flowUsd: 0, investedUsd: 1000, gainTotalUsd: 1000, gainTotalPct: 100 });
  });

  it("sin puntos no hay filas", () => {
    expect(filasDiarias([])).toEqual([]);
  });

  it("si te llevaste más plata de la que pusiste, el % sobre lo aportado no existe y queda en null", () => {
    const filas = filasDiarias([pt("2026-01-01", 0, 110, -200)]);
    expect(filas[0]!.gainTotalUsd).toBe(200);
    expect(filas[0]!.gainTotalPct).toBeNull();
  });
});

describe("picos", () => {
  it("el pico de valor dice cuánto aportaste después, para que la resta en plata no engañe", () => {
    const p = picos(SERIE)!;
    expect(p.valor).toEqual({ date: "2026-01-02", valueUsd: 2000, esHoy: false, diffUsd: -400, aportadoDespuesUsd: 500 });
  });

  it("el pico de rendimiento es el del índice, y lo que falta para volver a él se mide sobre la plata de hoy", () => {
    const p = picos(SERIE)!;
    // +100% acumulado el 02 contra +10% hoy: 90 puntos abajo. Con 1.600 puestos, volver a ese rendimiento son 1.309,09.
    // `caidaPct` es la caída desde ESE pico hasta hoy (45%): la "caída máx." de la curva es la peor de toda la
    // serie y puede ser otra. Los 90 puntos y el 45% son la misma cosa medida en dos varas, no dos números sueltos.
    expect(p.rendimiento).toEqual({ date: "2026-01-02", gainPct: 100, hoyPct: 10, puntos: -90, caidaPct: 45, vsHoyUsd: 1309.09, sinFlujosDesdePico: false, esHoy: false });
  });

  it("si el máximo es hoy lo dice en vez de inventar una caída", () => {
    const p = picos([pt("2026-01-01", 1000, 100, 1000), pt("2026-01-02", 1200, 120, 1000)])!;
    expect(p.valor).toMatchObject({ date: "2026-01-02", esHoy: true, diffUsd: 0, aportadoDespuesUsd: 0 });
    expect(p.rendimiento).toMatchObject({ date: "2026-01-02", esHoy: true, puntos: 0, caidaPct: 0, vsHoyUsd: 0 });
  });

  it("sin puntos no hay picos", () => {
    expect(picos([])).toBeNull();
  });
});

describe("lecturaPicos", () => {
  const fmt = (n: number) => `USD ${Math.round(n)}`;
  it("dice el máximo en plata, la resta contra hoy y que hubo aportes en el medio", () => {
    const l = lecturaPicos(picos(SERIE)!, "2026-01-04", fmt);
    expect(l.valor).toBe("Tu máximo en plata fue el 2026-01-02: USD 2000. Al cierre del 2026-01-04 tenés USD 1600, USD 400 menos, y entre esos dos días aportaste USD 500: lo que bajó tu rendimiento es más que esa resta.");
    expect(l.rendimiento).toBe("Tu plata nunca rindió más que el 2026-01-02: +100.0% acumulado (TWR). Hoy vas +10.0%, 90.0 puntos abajo: con lo que tenés puesto hoy, volver a ese rendimiento son USD 1309 más.");
  });

  it("cuando el máximo es hoy no habla de caídas", () => {
    const l = lecturaPicos(picos([pt("2026-01-01", 1000, 100, 1000), pt("2026-01-02", 1200, 120, 1000)])!, "2026-01-02", fmt);
    expect(l.valor).toBe("Tu máximo en plata es el cierre del 2026-01-02, hoy: USD 1200. Un aporte nuevo también hace máximo sin que hayas ganado nada, así que mirá el rendimiento de al lado.");
    expect(l.rendimiento).toBe("Tu mejor rendimiento es el de hoy: +20.0% acumulado (TWR). Nunca estuviste mejor.");
  });
});

/**
 * Auditoría de pantalla con la cartera real (1/10): el pico de valor y el de rendimiento eran el mismo día
 * (2026-06-12) y la tarjeta mostraba "USD 30.331 menos" arriba y "USD 30.343 más" abajo. Son el MISMO número:
 * desde ese día no entró ni salió plata, así que toda la caída en dólares es caída de rendimiento. Los 11
 * dólares de diferencia eran el redondeo del índice a dos decimales. Dos números casi iguales en la misma
 * tarjeta se leen como dos medidas que no coinciden, que es exactamente lo que esta app no puede hacer.
 */
describe("picos con la cartera real del 2026-09-30", () => {
  const REAL: CurvePoint[] = [
    pt("2026-06-11", 173319.51, 151.49, 116301.26),
    pt("2026-06-12", 173556.12, 151.7, 116301.26, 0, 236.61, 0.1365),
    pt("2026-09-30", 143224.73, 125.18, 116301.26, 0, -1398.63, -0.9671),
  ];
  it("sin aportes desde el pico, lo que falta para volver al rendimiento es exactamente lo que falta en plata", () => {
    const p = picos(REAL)!;
    expect(p.valor).toMatchObject({ date: "2026-06-12", valueUsd: 173556.12, diffUsd: -30331.39, aportadoDespuesUsd: 0 });
    expect(p.rendimiento).toMatchObject({ date: "2026-06-12", gainPct: 51.7, hoyPct: 25.18, puntos: -26.52, caidaPct: 17.48, sinFlujosDesdePico: true });
    expect(p.rendimiento.vsHoyUsd).toBe(30331.39);
    expect(p.rendimiento.vsHoyUsd).toBe(-p.valor.diffUsd);
  });

  it("y la lectura lo dice en vez de poner dos números parecidos", () => {
    const l = lecturaPicos(picos(REAL)!, "2026-09-30", (n) => `USD ${Math.round(n)}`);
    // El "+51,7% acumulado" de la tarjeta es TWR y el "% sobre aportado" de la tabla daba +49,2% para ese MISMO día
    // (1/10): las dos cuentas están bien, pero las dos se llamaban "acumulado". Cada una dice su vara.
    expect(l.rendimiento).toBe("Tu plata nunca rindió más que el 2026-06-12: +51.7% acumulado (TWR). Hoy vas +25.2%, 26.5 puntos abajo: son los mismos USD 30331 que te faltan en plata, porque desde ese día no aportaste ni saqué nada.");
  });

  it("si aportaste después del pico, los dos números son distintos de verdad y cada uno dice qué mide", () => {
    const conAporte: CurvePoint[] = [...REAL.slice(0, 2), pt("2026-09-30", 153224.73, 125.18, 126301.26, 10000, 0, 0)];
    const p = picos(conAporte)!;
    expect(p.rendimiento.sinFlujosDesdePico).toBe(false);
    // Con 153.224,73 puestos hoy, volver a un acumulado de +51,7% desde +25,18% son 32.461,41.
    expect(p.rendimiento.vsHoyUsd).toBe(32461.41);
    expect(p.valor.diffUsd).toBe(-20331.39);
    const l = lecturaPicos(p, "2026-09-30", (n) => `USD ${Math.round(n)}`);
    expect(l.rendimiento).toContain("con lo que tenés puesto hoy, volver a ese rendimiento son USD 32461 más");
  });
});

/**
 * La misma cartera tiene dos "lo que pusiste" y hasta el 1/10 la pantalla no decía por cuánto diferían: el
 * Resumen mide el P&L contra el costo promedio de lo que tenés (USD 115.730,32 al 2026-09-30) y esta pantalla
 * contra los aportes de la curva (USD 116.301,26). La diferencia, 570,94, son los 570,92 que el traspaso de
 * GGAL del 2026-04-18 trae sin operación que lo explique, más dos centavos de redondeo.
 */
describe("diferenciaConCosto", () => {
  it("cuando la diferencia es el ajuste del traspaso, lo dice con nombre y propio", () => {
    expect(diferenciaConCosto(116301.26, 115730.32, 570.92, (n) => `USD ${n.toFixed(0)}`)).toBe(
      "Son USD 571 más que el costo promedio con el que el Resumen calcula el P&L (USD 115730): eso es lo que un traspaso trae sin operación que lo explique, contado como aporte.",
    );
  });

  it("si la diferencia no es el ajuste, la dice sin inventarle una causa", () => {
    expect(diferenciaConCosto(116301.26, 110000, 570.92, (n) => `USD ${n.toFixed(0)}`)).toBe(
      "Son USD 6301 más que el costo promedio con el que el Resumen calcula el P&L (USD 110000): las dos cuentas miden cosas distintas (ventas y traspasos entran en una y no en la otra).",
    );
  });

  it("si las dos cuentas dan lo mismo no hay nada que explicar", () => {
    expect(diferenciaConCosto(116301.26, 116301.26, 0, (n) => `USD ${n}`)).toBeNull();
    expect(diferenciaConCosto(116301.26, null, 0, (n) => `USD ${n}`)).toBeNull();
  });
});
