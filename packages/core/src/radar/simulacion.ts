import type { Candle } from "../cartera/types.js";
import { assessRegime, type RegimeState } from "./regime.js";

/**
 * Simulación SOLO CON PRECIOS (2026-10-07).
 *
 * Por qué solo precios. La app guarda las fundamentales "de hoy" (una fila por símbolo, sin versión por fecha), así
 * que cualquier simulación que las use estaría mirando el futuro: rankearía 2025 con los balances de 2026. Eso no es
 * una limitación de esta función, es una propiedad de la base, y hay que decirla: **el ranking de la app no se puede
 * backtestear**. Lo que SÍ es punto en el tiempo son las velas, y con ellas se puede medir la parte del motor que
 * decide con precio: la compuerta técnica (arriba de la media de 200, sin perseguir) y el régimen de tasas.
 *
 * Qué mide. Para cada fecha de prueba y cada símbolo con historia suficiente, calcula el retorno a `horizonte`
 * ruedas y le resta el del S&P en la misma ventana. Después agrupa por lo que se quiere contrastar. Un grupo que
 * rinde más que su complemento indica que esa condición separa; uno que rinde igual indica que no aporta nada.
 *
 * Lo que NO hace: no simula el plan, ni el tamaño de posición, ni los stops, ni comisiones. No es un backtest de la
 * estrategia; es una medición de si las condiciones de precio del motor separan ganadores de perdedores.
 */
export interface GrupoSim {
  clave: string;
  titulo: string;
  /** Observaciones (símbolo × fecha) y símbolos distintos: 500 filas de 10 símbolos no son 500 observaciones. */
  n: number;
  simbolos: number;
  /** Alfa promedio contra el S&P en la ventana, en %, y % de observaciones con alfa positiva. */
  alfaProm: number | null;
  acierto: number | null;
  pocosSimbolos: boolean;
}

/** Con menos símbolos distintos que esto, el promedio es ruido y se dice. */
export const SIM_MINIMO_SIMBOLOS = 20;
/** Ruedas de historia que se exigen antes de la primera fecha de prueba (la media de 200 más margen). */
export const SIM_CALENTAMIENTO = 220;

export interface EntradaSim {
  symbol: string;
  candles: Candle[];
  /** Capitalización actual, solo para el tramo de tamaño. Es "de hoy", así que el tramo es aproximado y se dice. */
  mcapUsd?: number | null;
}

export interface OpcionesSim {
  /** Ruedas hacia adelante que se miden. 30 ≈ 6 semanas de calendario. */
  horizonte?: number;
  /** Cada cuántas ruedas se toma una fecha de prueba. 5 = una por semana. */
  paso?: number;
  /** Retorno de 21 ruedas desde el que la app deja de perseguir (misma política que el Radar). */
  maxRetorno21Pct?: number;
}

interface Obs {
  symbol: string;
  alfa: number;
  pasaCompuerta: boolean;
  sobreSma200: boolean;
  persiguiendo: boolean;
  regimen: RegimeState | null;
  tramoTamanio: string | null;
  /** Retorno de 21 ruedas, para medir DÓNDE empieza a doler perseguir en vez de asumir un umbral. */
  ret21: number;
  /** Distancia a la media de 200, en %, para lo mismo con `bajo_sma200`. */
  distSma200: number;
  /** Retorno de 252 ruedas, para medir el freno `subio_mucho_12m` (>100% en 12 meses). null sin historia. */
  ret12m: number | null;
  /**
   * Pendiente de la media de 200, en % sobre 63 ruedas (8/10/2026). La compuerta de la app mira si el precio está
   * ARRIBA de la media de 200, pero no si esa media SUBE. Un precio 10% arriba de una media plana no es una
   * tendencia: es un rebote sobre una base sin dirección. MMSI el 8/10 es el caso — media en 76,71 con pendiente de
   * +0,25% en tres meses, después de caer de 83,42. null sin historia suficiente.
   */
  pendSma200: number | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const sma = (c: Candle[], hasta: number, n: number): number | null => {
  if (hasta + 1 < n) return null;
  let s = 0;
  for (let i = hasta - n + 1; i <= hasta; i++) s += c[i]!.close;
  return s / n;
};

export const tramoDeTamanio = (mcapUsd: number | null | undefined): string | null => {
  if (mcapUsd === null || mcapUsd === undefined || !(mcapUsd > 0)) return null;
  if (mcapUsd < 2e9) return "a. menos de 2.000 M";
  if (mcapUsd < 10e9) return "b. 2.000 a 10.000 M";
  if (mcapUsd < 50e9) return "c. 10.000 a 50.000 M";
  return "d. más de 50.000 M";
};

/**
 * `spy` y `tnx` son las series del índice y del bono a 10 años. Sin `spy` no hay alfa y devuelve vacío; sin `tnx`
 * los grupos por régimen quedan sin datos, pero los de compuerta y tamaño siguen valiendo.
 */
export function simular(entradas: EntradaSim[], spy: Candle[], tnx: Candle[], opts: OpcionesSim = {}): { horizonte: number; fechas: number; desde: string | null; hasta: string | null; observaciones: number; grupos: GrupoSim[] } {
  const horizonte = opts.horizonte ?? 30;
  const paso = opts.paso ?? 5;
  const maxRet21 = opts.maxRetorno21Pct ?? 15;
  const vacio = { horizonte, fechas: 0, desde: null, hasta: null, observaciones: 0, grupos: [] as GrupoSim[] };
  if (spy.length < SIM_CALENTAMIENTO + horizonte) return vacio;

  const cierreSpy = new Map(spy.map((c) => [c.date, c.close]));
  // El régimen de cada fecha se calcula con la serie del 10 años RECORTADA a esa fecha: nunca con el futuro.
  const regimenDe = new Map<string, RegimeState | null>();
  const fechasSpy = spy.map((c) => c.date);
  for (const f of fechasSpy) {
    const hasta = tnx.filter((c) => c.date <= f);
    regimenDe.set(f, hasta.length ? (assessRegime(hasta)?.state ?? null) : null);
  }

  const obs: Obs[] = [];
  const fechasUsadas = new Set<string>();
  for (const e of entradas) {
    const c = e.candles;
    if (c.length < SIM_CALENTAMIENTO + horizonte) continue;
    const tramo = tramoDeTamanio(e.mcapUsd);
    for (let i = SIM_CALENTAMIENTO; i + horizonte < c.length; i += paso) {
      const hoy = c[i]!;
      const fin = c[i + horizonte]!;
      const spyHoy = cierreSpy.get(hoy.date);
      const spyFin = cierreSpy.get(fin.date);
      // Sin el índice en LAS DOS puntas no hay alfa comparable: se descarta la observación en vez de inventarla.
      if (spyHoy === undefined || spyFin === undefined || !(spyHoy > 0) || !(hoy.close > 0)) continue;
      const s200 = sma(c, i, 200);
      if (s200 === null) continue;
      const previo = c[i - 21];
      if (!previo || !(previo.close > 0)) continue;
      const ret21 = (hoy.close / previo.close - 1) * 100;
      const sobreSma200 = hoy.close > s200;
      const persiguiendo = ret21 > maxRet21;
      obs.push({
        symbol: e.symbol,
        alfa: (fin.close / hoy.close - 1) * 100 - (spyFin / spyHoy - 1) * 100,
        pasaCompuerta: sobreSma200 && !persiguiendo,
        sobreSma200,
        persiguiendo,
        regimen: regimenDe.get(hoy.date) ?? null,
        tramoTamanio: tramo,
        ret21,
        distSma200: (hoy.close / s200 - 1) * 100,
        ret12m: (() => { const p = c[i - 252]; return p && p.close > 0 ? (hoy.close / p.close - 1) * 100 : null; })(),
        pendSma200: (() => { const antes = sma(c, i - 63, 200); return antes !== null && antes > 0 ? (s200 / antes - 1) * 100 : null; })(),
      });
      fechasUsadas.add(hoy.date);
    }
  }
  if (!obs.length) return vacio;

  const grupo = (clave: string, titulo: string, xs: Obs[]): GrupoSim => {
    const simbolos = new Set(xs.map((o) => o.symbol)).size;
    return {
      clave,
      titulo,
      n: xs.length,
      simbolos,
      alfaProm: xs.length ? r2(xs.reduce((a, o) => a + o.alfa, 0) / xs.length) : null,
      acierto: xs.length ? Math.round((100 * xs.filter((o) => o.alfa > 0).length) / xs.length) : null,
      pocosSimbolos: simbolos < SIM_MINIMO_SIMBOLOS,
    };
  };

  const grupos: GrupoSim[] = [
    grupo("todo", "todas las observaciones", obs),
    grupo("compuerta_pasa", "pasa la compuerta técnica (sobre la media de 200 y sin perseguir)", obs.filter((o) => o.pasaCompuerta)),
    grupo("compuerta_no", "NO pasa la compuerta técnica", obs.filter((o) => !o.pasaCompuerta)),
    grupo("sobre_sma200", "sobre la media de 200", obs.filter((o) => o.sobreSma200)),
    grupo("bajo_sma200", "bajo la media de 200", obs.filter((o) => !o.sobreSma200)),
    grupo("persiguiendo", `subió más de ${maxRet21}% en 21 ruedas`, obs.filter((o) => o.persiguiendo)),
  ];
  for (const estado of ["restrictivo", "neutral", "expansivo"] as RegimeState[]) {
    grupos.push(grupo(`regimen_${estado}`, `régimen ${estado}`, obs.filter((o) => o.regimen === estado)));
    grupos.push(grupo(`regimen_${estado}_compuerta`, `régimen ${estado}, pasando la compuerta`, obs.filter((o) => o.regimen === estado && o.pasaCompuerta)));
  }
  // Tramos del retorno de 21 ruedas: en vez de dar por bueno el umbral de 15%, se mide dónde (si en algún lado)
  // perseguir empieza a costar. Lo mismo con la distancia a la media de 200.
  const TRAMOS_RET21: Array<[string, (r: number) => boolean]> = [
    ["21 ruedas: cayó más de 10%", (r) => r <= -10],
    ["21 ruedas: −10% a 0%", (r) => r > -10 && r <= 0],
    ["21 ruedas: 0% a 10%", (r) => r > 0 && r <= 10],
    ["21 ruedas: 10% a 15%", (r) => r > 10 && r <= 15],
    ["21 ruedas: 15% a 25%", (r) => r > 15 && r <= 25],
    ["21 ruedas: 25% a 40%", (r) => r > 25 && r <= 40],
    ["21 ruedas: más de 40%", (r) => r > 40],
  ];
  for (const [titulo, f] of TRAMOS_RET21) grupos.push(grupo(`ret21_${titulo.slice(11)}`, titulo, obs.filter((o) => f(o.ret21))));
  // El cruce que decide si el momento se puede usar HOY: con tasas altas o subiendo, ¿sigue rindiendo? Sin esto,
  // cambiar el umbral sería extrapolar un período de 13 meses dominado por la IA a un régimen distinto.
  const porRegimen = (estado: RegimeState, titulo: string, f: (o: Obs) => boolean, clave: string) =>
    grupos.push(grupo(clave, `${titulo} · régimen ${estado}`, obs.filter((o) => o.regimen === estado && f(o))));
  for (const estado of ["restrictivo", "neutral"] as RegimeState[]) {
    porRegimen(estado, "21 ruedas: 0% a 15% (lo que la app permite)", (o) => o.ret21 > 0 && o.ret21 <= 15, `x_ret21_permitido_${estado}`);
    porRegimen(estado, "21 ruedas: más de 15% (lo que la app frena)", (o) => o.ret21 > 15, `x_ret21_frenado_${estado}`);
    porRegimen(estado, "21 ruedas: 15% a 40%", (o) => o.ret21 > 15 && o.ret21 <= 40, `x_ret21_15a40_${estado}`);
    porRegimen(estado, "12 meses: 0% a 100% (permitido)", (o) => o.ret12m !== null && o.ret12m > 0 && o.ret12m <= 100, `x_ret12m_permitido_${estado}`);
    porRegimen(estado, "12 meses: más de 100% (frenado)", (o) => o.ret12m !== null && o.ret12m > 100, `x_ret12m_frenado_${estado}`);
    porRegimen(estado, "media 200: más de 25% arriba", (o) => o.distSma200 > 25, `x_sma_fuerte_${estado}`);
  }
  // Qué SÍ tiene alfa positiva con tasas altas o subiendo. Es la pregunta operativa de hoy, y la respuesta no se
  // puede leer del agregado porque el régimen neutral es el 79% de las observaciones.
  const EN_RESTRICTIVO: Array<[string, (o: Obs) => boolean]> = [
    ["cayó más de 10% en 21 ruedas", (o) => o.ret21 <= -10],
    ["cayó entre 10% y 0% en 21 ruedas", (o) => o.ret21 > -10 && o.ret21 <= 0],
    ["bajo la media de 200", (o) => o.distSma200 <= 0],
    ["más de 20% bajo la media de 200", (o) => o.distSma200 <= -20],
    ["entre 5% abajo y 5% arriba de la media de 200", (o) => o.distSma200 > -5 && o.distSma200 <= 5],
    ["cayó en 12 meses", (o) => o.ret12m !== null && o.ret12m <= 0],
    ["menos de 2.000 M y bajo la media de 200", (o) => o.tramoTamanio === "a. menos de 2.000 M" && o.distSma200 <= 0],
    ["menos de 2.000 M y cayó en 21 ruedas", (o) => o.tramoTamanio === "a. menos de 2.000 M" && o.ret21 <= 0],
  ];
  for (const [titulo, f] of EN_RESTRICTIVO) {
    grupos.push(grupo(`restr_${titulo.slice(0, 18)}`, `[restrictivo] ${titulo}`, obs.filter((o) => o.regimen === "restrictivo" && f(o))));
  }
  // Pendiente de la media de 200, sola y cruzada con la distancia: ¿importa que la media suba, o basta estar arriba?
  const PEND: Array<[string, (p: number) => boolean]> = [
    ["media 200 cayendo (menos de -2% en 63 ruedas)", (p) => p <= -2],
    ["media 200 PLANA (-2% a +2% en 63 ruedas)", (p) => p > -2 && p <= 2],
    ["media 200 subiendo (+2% a +8%)", (p) => p > 2 && p <= 8],
    ["media 200 subiendo fuerte (mas de +8%)", (p) => p > 8],
  ];
  for (const [titulo, f] of PEND) grupos.push(grupo(`pend_${titulo.slice(10, 26)}`, titulo, obs.filter((o) => o.pendSma200 !== null && f(o.pendSma200))));
  // El caso de MMSI: arriba de la media pero con la media plana, contra arriba de la media con la media subiendo.
  const arriba = (o: Obs) => o.distSma200 > 5 && o.distSma200 <= 25;
  grupos.push(grupo("x_arriba_pend_plana", "5-25% arriba de la media de 200, con la media PLANA", obs.filter((o) => arriba(o) && o.pendSma200 !== null && o.pendSma200 > -2 && o.pendSma200 <= 2)));
  grupos.push(grupo("x_arriba_pend_sube", "5-25% arriba de la media de 200, con la media SUBIENDO (+2% o mas)", obs.filter((o) => arriba(o) && o.pendSma200 !== null && o.pendSma200 > 2)));
  grupos.push(grupo("x_arriba_pend_plana_restr", "[restrictivo] 5-25% arriba con la media PLANA", obs.filter((o) => o.regimen === "restrictivo" && arriba(o) && o.pendSma200 !== null && o.pendSma200 > -2 && o.pendSma200 <= 2)));
  grupos.push(grupo("x_arriba_pend_sube_restr", "[restrictivo] 5-25% arriba con la media SUBIENDO", obs.filter((o) => o.regimen === "restrictivo" && arriba(o) && o.pendSma200 !== null && o.pendSma200 > 2)));
  const TRAMOS_RET12M: Array<[string, (r: number) => boolean]> = [
    ["12 meses: cayó", (r) => r <= 0],
    ["12 meses: 0% a 50%", (r) => r > 0 && r <= 50],
    ["12 meses: 50% a 100%", (r) => r > 50 && r <= 100],
    ["12 meses: 100% a 200%", (r) => r > 100 && r <= 200],
    ["12 meses: más de 200%", (r) => r > 200],
  ];
  for (const [titulo, f] of TRAMOS_RET12M) grupos.push(grupo(`ret12m_${titulo.slice(10)}`, titulo, obs.filter((o) => o.ret12m !== null && f(o.ret12m))));
  const TRAMOS_SMA: Array<[string, (d: number) => boolean]> = [
    ["media 200: más de 20% abajo", (d) => d <= -20],
    ["media 200: 20% a 5% abajo", (d) => d > -20 && d <= -5],
    ["media 200: 5% abajo a 5% arriba", (d) => d > -5 && d <= 5],
    ["media 200: 5% a 25% arriba", (d) => d > 5 && d <= 25],
    ["media 200: más de 25% arriba", (d) => d > 25],
  ];
  for (const [titulo, f] of TRAMOS_SMA) grupos.push(grupo(`sma_${titulo.slice(11)}`, titulo, obs.filter((o) => f(o.distSma200))));
  for (const t of ["a. menos de 2.000 M", "b. 2.000 a 10.000 M", "c. 10.000 a 50.000 M", "d. más de 50.000 M"]) {
    grupos.push(grupo(`tamanio_${t.slice(0, 1)}`, `tamaño ${t}`, obs.filter((o) => o.tramoTamanio === t)));
    grupos.push(grupo(`tamanio_${t.slice(0, 1)}_restrictivo`, `tamaño ${t}, régimen restrictivo`, obs.filter((o) => o.tramoTamanio === t && o.regimen === "restrictivo")));
  }

  const fechas = [...fechasUsadas].sort();
  return { horizonte, fechas: fechas.length, desde: fechas[0] ?? null, hasta: fechas[fechas.length - 1] ?? null, observaciones: obs.length, grupos };
}
