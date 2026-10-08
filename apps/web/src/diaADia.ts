import type { CurvePoint } from "./api";

/**
 * Lo que muestra la pantalla "Día a día" de Cartera, a partir de los puntos de la curva. Puro y testeado: acá
 * no se recalcula ninguna ganancia, se leen las que ya trae cada punto (`gainUsd`, `flowUsd`, `investedUsd`).
 *
 * Dos cuentas distintas conviven en Cartera y las dos están bien; lo que no puede pasar es que no se sepa cuál
 * es cuál:
 * - el P&L de la tabla de posiciones es `valor − cantidad × costo promedio` (lo que pagaste por lo que TENÉS hoy);
 * - la ganancia acumulada de esta pantalla es `valor − aportado` (lo que pusiste menos lo que saqué, con las
 *   ventas y los traspasos adentro). Sobre una cartera donde vendiste algo, no dan lo mismo.
 */
export interface FilaDia {
  date: string;
  /** Valor de la cartera al cierre de ese día. */
  valueUsd: number;
  /** Lo que ganaste ese día en plata, sin contar el aporte. */
  gainDayUsd: number;
  /** El retorno de ese día en % (TWR, el que encadena el índice de la curva). */
  returnPct: number;
  /** Aportes netos de ese día: 0 si no movieron plata, negativo si sacaste. */
  flowUsd: number;
  /** Aportes netos acumulados hasta ese día. */
  investedUsd: number;
  /** Valor menos aportado: la ganancia de toda la historia hasta ese día. */
  gainTotalUsd: number;
  /** Esa ganancia sobre lo aportado, en %. null si lo aportado no es positivo (no hay sobre qué medirla). */
  gainTotalPct: number | null;
}

export interface PicoValor {
  date: string;
  valueUsd: number;
  /** true si el máximo es el último día de la curva. */
  esHoy: boolean;
  /** Valor de hoy menos el del pico (0 si el pico es hoy). */
  diffUsd: number;
  /** Lo que aportaste DESPUÉS del pico: sin esto, la resta en plata se lee como si hubieras perdido solo eso. */
  aportadoDespuesUsd: number;
}
export interface PicoRendimiento {
  date: string;
  /** Rendimiento acumulado de ese día (TWR, índice − 100), en %. */
  gainPct: number;
  /** El acumulado de hoy, en %. */
  hoyPct: number;
  /** Puntos de rendimiento acumulado que te separan del pico (≤ 0). */
  puntos: number;
  /** La misma distancia como caída desde ese pico, en % (la vara de la "caída máx." de la curva). */
  caidaPct: number;
  /**
   * Lo que valdría volver a ese rendimiento con la plata que tenés puesta hoy, en USD. Si desde el pico no
   * entró ni salió plata, es exactamente lo que te falta en plata para volver al máximo (`-diffUsd`).
   */
  vsHoyUsd: number;
  /**
   * true si desde el pico no hubo aportes ni retiros. Entonces la caída en dólares y la de rendimiento son la
   * MISMA, y la pantalla dice un solo número: con la cartera real al 2026-09-30 mostraba "USD 30.331 menos" y
   * "USD 30.343 más" (el redondeo del índice), dos números a 11 dólares que parecían medidas que no coinciden.
   */
  sinFlujosDesdePico: boolean;
  esHoy: boolean;
}
export interface Picos {
  valor: PicoValor;
  rendimiento: PicoRendimiento;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const signed1 = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

/** Las filas de la tabla, más nuevo arriba. */
export function filasDiarias(points: CurvePoint[]): FilaDia[] {
  return points
    .map((p) => {
      const gainTotalUsd = round2(p.value - p.investedUsd);
      return {
        date: p.date,
        valueUsd: p.value,
        gainDayUsd: p.gainUsd,
        returnPct: p.returnPct,
        flowUsd: p.flowUsd,
        investedUsd: p.investedUsd,
        gainTotalUsd,
        gainTotalPct: p.investedUsd > 0 ? round2((gainTotalUsd / p.investedUsd) * 100) : null,
      };
    })
    .reverse();
}

/**
 * Los dos máximos, que son distintos y por eso van los dos (1/10):
 * - el de VALOR es el día que la cartera valió más en plata. Con un aporte por mes, el valor toca máximo
 *   seguido sin que hayas ganado nada, así que viene con lo que aportaste después del pico;
 * - el de RENDIMIENTO es el día que tu plata rendía más (el índice TWR, donde un aporte no es ganancia). Es
 *   el que contesta "cuándo podría haber tenido más ganancia".
 *
 * Con empate gana el día más viejo: si hoy igualás un máximo de antes, ya habías estado ahí.
 */
export function picos(points: CurvePoint[]): Picos | null {
  if (!points.length) return null;
  const hoy = points[points.length - 1]!;
  const porValor = points.reduce((a, b) => (b.value > a.value ? b : a));
  const porIndice = points.reduce((a, b) => (b.index > a.index ? b : a));
  // Después del pico: el aporte del día del pico ya está adentro de su propio valor.
  const sinFlujosDesdePico = !points.slice(points.indexOf(porIndice) + 1).some((p) => p.flowUsd !== 0);
  return {
    valor: {
      date: porValor.date,
      valueUsd: porValor.value,
      esHoy: porValor.date === hoy.date,
      diffUsd: round2(hoy.value - porValor.value),
      aportadoDespuesUsd: round2(hoy.investedUsd - porValor.investedUsd),
    },
    rendimiento: {
      date: porIndice.date,
      gainPct: round2(porIndice.index - 100),
      hoyPct: round2(hoy.index - 100),
      puntos: round2(hoy.index - porIndice.index),
      caidaPct: porIndice.index > 0 ? round2((100 * (porIndice.index - hoy.index)) / porIndice.index) : 0,
      // Sin flujos desde el pico, el cociente de valores y el de índices son el mismo: se usa el de valores, que
      // no arrastra el redondeo del índice y da el mismo número que la línea de arriba.
      vsHoyUsd: sinFlujosDesdePico ? round2(porIndice.value - hoy.value) : hoy.index > 0 ? round2(hoy.value * (porIndice.index / hoy.index - 1)) : 0,
      sinFlujosDesdePico,
      esHoy: porIndice.date === hoy.date,
    },
  };
}

/** Una línea por pico, con las palabras que evitan leerlas mal. `fmt` es el mismo formateador de dólares de la pantalla. */
export function lecturaPicos(p: Picos, hoy: string, fmt: (n: number) => string): { valor: string; rendimiento: string } {
  const v = p.valor.esHoy
    ? `Tu máximo en plata es el cierre del ${p.valor.date}, hoy: ${fmt(p.valor.valueUsd)}. Un aporte nuevo también hace máximo sin que hayas ganado nada, así que mirá el rendimiento de al lado.`
    : `Tu máximo en plata fue el ${p.valor.date}: ${fmt(p.valor.valueUsd)}. Al cierre del ${hoy} tenés ${fmt(p.valor.valueUsd + p.valor.diffUsd)}, ${fmt(Math.abs(p.valor.diffUsd))} ${p.valor.diffUsd < 0 ? "menos" : "más"}${p.valor.aportadoDespuesUsd > 0 ? `, y entre esos dos días aportaste ${fmt(p.valor.aportadoDespuesUsd)}: lo que bajó tu rendimiento es más que esa resta` : ""}.`;
  const r = p.rendimiento.esHoy
    ? `Tu mejor rendimiento es el de hoy: ${signed1(p.rendimiento.hoyPct)} acumulado (TWR). Nunca estuviste mejor.`
    : `Tu plata nunca rindió más que el ${p.rendimiento.date}: ${signed1(p.rendimiento.gainPct)} acumulado (TWR). Hoy vas ${signed1(p.rendimiento.hoyPct)}, ${Math.abs(p.rendimiento.puntos).toFixed(1)} puntos abajo: ${p.rendimiento.sinFlujosDesdePico ? `son los mismos ${fmt(p.rendimiento.vsHoyUsd)} que te faltan en plata, porque desde ese día no aportaste ni saqué nada` : `con lo que tenés puesto hoy, volver a ese rendimiento son ${fmt(p.rendimiento.vsHoyUsd)} más`}.`;
  return { valor: v, rendimiento: r };
}

/**
 * La misma cartera tiene dos "lo que pusiste" y las dos están bien:
 * - el **costo promedio** de lo que tenés hoy (`cantidad × costo promedio`), con el que el Resumen calcula el P&L;
 * - los **aportes** de la curva, que incluyen ventas viejas y lo que un traspaso trae sin operación que lo explique.
 *
 * Al 2026-09-30 son 115.730,32 y 116.301,26: 570,94 de diferencia, que son los 570,92 del traspaso de GGAL del
 * 2026-04-18. Devuelve null si coinciden (nada que explicar) o si no se sabe el costo.
 */
export function diferenciaConCosto(investedUsd: number, costUsd: number | null, ajusteUsd: number, fmt: (n: number) => string): string | null {
  if (costUsd === null || Math.abs(investedUsd - costUsd) < 1) return null;
  const dif = round2(investedUsd - costUsd);
  const porAjuste = ajusteUsd !== 0 && Math.abs(dif - ajusteUsd) < 1;
  const causa = porAjuste
    ? "eso es lo que un traspaso trae sin operación que lo explique, contado como aporte"
    : "las dos cuentas miden cosas distintas (ventas y traspasos entran en una y no en la otra)";
  return `Son ${fmt(Math.abs(dif))} ${dif > 0 ? "más" : "menos"} que el costo promedio con el que el Resumen calcula el P&L (${fmt(costUsd)}): ${causa}.`;
}
