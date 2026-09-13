import { describe, expect, it } from "vitest";
import { checkConsistency, computeTrailingStop, summarizeFindings, type Candle, type CandidateRow, type ContributionPlan } from "../index.js";

/**
 * Cada caso de acá abajo es un error que de verdad pasó y que ni los tests ni el typecheck atraparon.
 * Si alguno deja de fallar sin que se haya arreglado la causa, el chequeo dejó de servir.
 */
const vela = (date: string, close: number): Candle => ({ date, open: close, high: close + 0.5, low: close - 0.5, close, volume: 1_000 });

const fila = (over: Partial<CandidateRow> & { symbol: string }): CandidateRow => ({
  candidateDate: "2026-09-11", kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: [], rankInGroup: null, groupSize: null,
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 118, sizeUsd: null, sizeQty: null, riskScore: 3, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  entry: { state: "en_zona", level: 102, levelLabel: "hasta 2% sobre el precio", low: 100, high: 102, validSessions: 15, sma20: 99, sma50: 95, atr14: 2, extensionAtr: 0.5, rangePct60: 60, why: "ni extendida ni floja" },
  ...over,
});

const plan = (lines: ContributionPlan["lines"]): ContributionPlan => ({ month: "2026-09", totalUsd: 40_000, lines, notes: [] });
type Linea = ContributionPlan["lines"][number];
const linea = (over: Partial<Linea> & { symbol: string }): Linea =>
  ({ kind: "comprar", amountUsd: 4_000, rationale: "por convicción", close: 100, alpha30dPct: null, alpha90dPct: null, stop: 92, ...over } as Linea);

const solo = (check: string, f: ReturnType<typeof checkConsistency>) => f.filter((x) => x.check === check);

describe("checkConsistency", () => {
  it("una corrida sana no reporta nada", () => {
    const f = checkConsistency({ rows: [fila({ symbol: "NVDA" })], candles: { NVDA: [vela("2026-09-11", 100)] }, plan: plan([linea({ symbol: "NVDA" })]) });
    expect(f).toEqual([]);
    expect(summarizeFindings(f)).toEqual({ graves: 0, avisos: 0, total: 0 });
  });

  it("APH del 11/9: la fila guardó el piso de la franja en la columna del precio", () => {
    const f = solo("precio_guardado", checkConsistency({
      rows: [fila({ symbol: "APH", close: 84, entryLow: 84, entryHigh: 85.68 })],
      candles: { APH: [vela("2026-09-11", 80.25)] },
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("80.25");
  });

  it("BEAM del 10/9: el stop guardado quedó congelado y no sale de sus propias velas", () => {
    // El refresco arrastraba el stop del día anterior mientras sí actualizaba el cierre. BEAM quedó con
    // 27,13 desde el 7/9 con el precio en 24,37: un nivel de salida que ya no correspondía a ninguna vela.
    const velas = Array.from({ length: 30 }, (_, i) => vela(`2026-08-${String(i + 12).padStart(2, "0")}`, 30 - i * 0.2));
    const f = solo("stop_guardado", checkConsistency({
      rows: [fila({ symbol: "BEAM", candidateDate: "2026-09-10", close: velas[velas.length - 1]!.close, stop: 27.13, entry: null })],
      candles: { BEAM: velas }, plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("un stop que sí sale de sus velas no se reporta", () => {
    const velas = Array.from({ length: 30 }, (_, i) => vela(`2026-08-${String(i + 12).padStart(2, "0")}`, 30 - i * 0.2));
    const esperado = computeTrailingStop(velas)!;
    const f = solo("stop_guardado", checkConsistency({
      rows: [fila({ symbol: "BEAM", candidateDate: "2026-09-10", close: velas[velas.length - 1]!.close, stop: esperado, entry: null })],
      candles: { BEAM: velas }, plan: null,
    }));
    expect(f).toEqual([]);
  });

  it("una fila de ayer que sigue vigente se compara contra la vela de ayer, no contra la de hoy", () => {
    // Las 14 filas de seguimiento del 11/9 salían como error grave solo por ser del día anterior.
    const f = solo("precio_guardado", checkConsistency({
      rows: [fila({ symbol: "GOOGL", candidateDate: "2026-09-10", close: 332.6 })],
      candles: { GOOGL: [vela("2026-09-10", 332.6), vela("2026-09-11", 338.5)] },
      plan: null,
    }));
    expect(f).toEqual([]);
  });

  it("JANX: una empresa con pérdida no dispara ganancia no operativa", () => {
    // Margen neto -294% contra operativo -421%: menos negativo por intereses de la caja, no ganancia de afuera.
    const f = solo("ganancia_no_operativa", checkConsistency({
      rows: [fila({ symbol: "JANX" })], candles: {}, plan: null,
      metrics: { JANX: { operatingMarginTTM: -421.47, netProfitMarginTTM: -294.36 } },
    }));
    expect(f).toEqual([]);
  });

  it("META del 11/9: la verificación dice con reservas y las banderas no la muestran", () => {
    const f = solo("verificacion_sin_bandera", checkConsistency({
      rows: [fila({ symbol: "META", kind: "watch", flags: [], verification: { date: "2026-09-11", verdict: "con_reservas", reason: "litigios de privacidad" } })],
      candles: {},
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("no está restando convicción");
  });

  it("SOLV, TER y VIST del 11/9: un OBSERVAR también tiene que mostrar su verificación guardada", () => {
    // El refresco solo le pasaba el dictamen a la decisión si el símbolo quedaba COMPRAR. Un OBSERVAR
    // conservaba la verificación en su columna y la perdía en las banderas, así que dejaba de restar.
    const f = solo("verificacion_sin_bandera", checkConsistency({
      rows: [fila({ symbol: "TER", verdict: "OBSERVAR", flags: ["insiders_venden", "bajo_stop"], verification: { date: "2026-09-11", verdict: "con_reservas", reason: "pico de ciclo" } })],
      candles: {}, plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("con la bandera puesta, la misma fila no reporta nada", () => {
    const f = solo("verificacion_sin_bandera", checkConsistency({
      rows: [fila({ symbol: "META", flags: ["verificacion_reservas"], verification: { date: "2026-09-11", verdict: "con_reservas", reason: "litigios" } })],
      candles: {},
      plan: null,
    }));
    expect(f).toEqual([]);
  });

  it("dos banderas de verificación a la vez es contradicción", () => {
    const f = solo("verificacion_duplicada", checkConsistency({
      rows: [fila({ symbol: "X", flags: ["verificacion_apta", "verificacion_reservas"], verification: { date: "2026-09-11", verdict: "apto", reason: "ok" } })],
      candles: {}, plan: null,
    }));
    expect(f).toHaveLength(1);
  });

  it("la franja de compra al revés se reporta", () => {
    const f = solo("franja_invertida", checkConsistency({ rows: [fila({ symbol: "X", entryLow: 110, entryHigh: 100 })], candles: {}, plan: null }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("APH del 10/9: objetivos de analistas de antes del split 2:1 dan un potencial inventado", () => {
    const f = solo("objetivo_fuera_de_escala", checkConsistency({
      rows: [fila({ symbol: "APH", close: 81, analystTargets: { n: 12, median: 196, min: 175, max: 215, latestDate: "2026-08-20" } })],
      candles: {}, plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("split");
  });

  it("SGOV del 11/9: una línea que no es núcleo y no tiene stop es plata que entra y no sale", () => {
    const f = solo("linea_sin_salida", checkConsistency({
      rows: [], candles: {},
      plan: plan([linea({ symbol: "SGOV", kind: "comprar", stop: null })]),
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("el núcleo sin stop es correcto y no se reporta", () => {
    const f = solo("linea_sin_salida", checkConsistency({ rows: [], candles: {}, plan: plan([linea({ symbol: "VTI", kind: "nucleo", stop: null })]) }));
    expect(f).toEqual([]);
  });

  it("el plan no puede comprar algo que el Radar de hoy tiene en OBSERVAR", () => {
    const f = solo("plan_contra_veredicto", checkConsistency({
      rows: [fila({ symbol: "HRTG", verdict: "OBSERVAR" })],
      candles: {},
      plan: plan([linea({ symbol: "HRTG" })]),
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("un COMPRAR sin momento de entrada no puede decir cuándo entrar", () => {
    const f = solo("compra_sin_momento", checkConsistency({ rows: [fila({ symbol: "X", entry: null })], candles: {}, plan: null }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("aviso");
  });

  it("corrida del 11/9 a las 22:17: filas fechadas mañana porque la fecha se tomaba en UTC", () => {
    const f = solo("fila_en_el_futuro", checkConsistency({
      rows: [fila({ symbol: "NVDA", candidateDate: "2026-09-12" })],
      candles: {}, plan: null, today: "2026-09-11",
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("UTC");
  });

  it("GOOGL: margen neto muy arriba del operativo es ganancia que no viene de la operación", () => {
    // 99.000 M de revalorización no realizada de SpaceX en el Q2 2026 llevaron el margen neto a 54,8%.
    const f = solo("ganancia_no_operativa", checkConsistency({
      rows: [fila({ symbol: "GOOGL" })], candles: {}, plan: null,
      metrics: { GOOGL: { operatingMarginTTM: 33.11, netProfitMarginTTM: 54.75 } },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("no viene de la operación");
  });

  it("un margen neto apenas menor que el operativo es normal y no se reporta", () => {
    const f = solo("ganancia_no_operativa", checkConsistency({
      rows: [fila({ symbol: "NVDA" })], candles: {}, plan: null,
      metrics: { NVDA: { operatingMarginTTM: 65.2, netProfitMarginTTM: 63.7 } },
    }));
    expect(f).toEqual([]);
  });

  it("TSM del 12/9: la capitalización no coincide con la que implica su propio precio sobre ventas", () => {
    // 11,1 billones guardados contra ~2,2 reales: precio del ADR por acciones locales, con ratio 5 a 1.
    const f = solo("capitalizacion_inconsistente", checkConsistency({
      rows: [fila({ symbol: "TSM" })], candles: {}, plan: null,
      mcaps: { TSM: 11_115_521_414_950 },
      metrics: { TSM: { psTTM: 13.87, revenuePerShareTTM: 61.8, shareOutstanding: 25_932 } },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
    expect(f[0]!.detail).toContain("ADR");
  });

  it("NVDA: la capitalización coincide con la implicada y no se reporta", () => {
    const f = solo("capitalizacion_inconsistente", checkConsistency({
      rows: [fila({ symbol: "NVDA" })], candles: {}, plan: null,
      mcaps: { NVDA: 5_551_700_000_000 },
      metrics: { NVDA: { psTTM: 18.32, revenuePerShareTTM: 12.52, shareOutstanding: 24_200 } },
    }));
    expect(f).toEqual([]);
  });

  it("DVA: deuda/patrimonio 78 y ROE 181% con el patrimonio borrado por recompras", () => {
    const r = checkConsistency({
      rows: [fila({ symbol: "DVA" })], candles: {}, plan: null,
      metrics: { DVA: { "totalDebt/totalEquityAnnual": 77.99, roeTTM: 181.2, operatingMarginTTM: 15.1, netProfitMarginTTM: 6.1 } },
    });
    expect(solo("patrimonio_sin_sentido", r)).toHaveLength(1);
    expect(solo("patrimonio_sin_sentido", r)[0]!.detail).toContain("ROE de 181.2%");
    expect(solo("patrimonio_sin_sentido", r)[0]!.detail).toContain("eje de calidad los premia");
  });

  it("una empresa apalancada pero con patrimonio real no se reporta", () => {
    const r = checkConsistency({
      rows: [fila({ symbol: "HSBC" })], candles: {}, plan: null,
      metrics: { HSBC: { "totalDebt/totalEquityAnnual": 2.55, roeTTM: 19.5, operatingMarginTTM: 40.4, netProfitMarginTTM: 34.2 } },
    });
    expect(solo("patrimonio_sin_sentido", r)).toEqual([]);
  });

  it("NVDA: un ROE de 110% con patrimonio real y enorme no es un artefacto y no se reporta", () => {
    const r = checkConsistency({
      rows: [fila({ symbol: "NVDA" })], candles: {}, plan: null,
      metrics: { NVDA: { roeTTM: 110.11, "totalDebt/totalEquityAnnual": 0.05, operatingMarginTTM: 65.2, netProfitMarginTTM: 63.7 } },
    });
    expect(r).toEqual([]);
  });

  it("cuenta graves y avisos por separado", () => {
    const f = checkConsistency({
      rows: [fila({ symbol: "A", entryLow: 110, entryHigh: 100 }), fila({ symbol: "B", entry: null })],
      candles: {}, plan: null,
    });
    expect(summarizeFindings(f)).toEqual({ graves: 1, avisos: 1, total: 2 });
  });

  it("EWT del 12/9: un objetivo por debajo del precio, sin entrada más abajo que lo explique", () => {
    // El caso real era legítimo (entrada 106,75–107,83, objetivo 110,69 desde ahí) y la pantalla lo
    // escondía. Acá se prueba la versión que sí es un error: el mismo objetivo bajo el precio pero
    // mandando entrar AL precio de hoy.
    const f = solo("objetivo_bajo_el_precio", checkConsistency({
      rows: [fila({ symbol: "EWT", kind: "etf", close: 110.91, entryLow: 110.91, entryHigh: 113.13, stop: 106.4, target: 110.69, entry: null })],
      candles: { EWT: [vela("2026-09-11", 110.91)] },
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("el EWT real, con la franja de compra por debajo, no se reporta: el 2 a 1 se mide desde ahí", () => {
    const f = solo("objetivo_bajo_el_precio", checkConsistency({
      rows: [fila({
        symbol: "EWT", kind: "etf", close: 110.91, entryLow: 106.75, entryHigh: 107.83, stop: 106.4, target: 110.69,
        entry: { state: "esperar_retroceso", level: 106.75, levelLabel: "su media de 20", low: 106.75, high: 107.83, validSessions: 15, sma20: 106.75, sma50: 104, atr14: 1.5, extensionAtr: 2.8, rangePct60: 92, why: "está 2,8 ATR sobre su media de 20" },
      })],
      candles: { EWT: [vela("2026-09-11", 110.91)] },
      plan: null,
    }));
    expect(f).toEqual([]);
  });

  it("12/9: una candidata cuyas noticias nunca se leyeron no puede pasar por verificada", () => {
    const f = solo("noticias_sin_leer", checkConsistency({
      rows: [fila({ symbol: "NEM" })],
      candles: { NEM: [vela("2026-09-11", 100)] },
      plan: null,
      newsScannedTo: { NEM: null },
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.detail).toContain("nunca se leyó");
  });

  it("con las noticias leídas no se reporta nada", () => {
    const f = solo("noticias_sin_leer", checkConsistency({
      rows: [fila({ symbol: "NEM" })],
      candles: { NEM: [vela("2026-09-11", 100)] },
      plan: null,
      newsScannedTo: { NEM: "2026-09-12" },
    }));
    expect(f).toEqual([]);
  });

  it("YPF del 13/9: un COMPRAR con el stop dentro de la franja de compra no se puede ejecutar", () => {
    const f = solo("compra_sin_boleto", checkConsistency({
      rows: [fila({ symbol: "YPF", kind: "adr", close: 55.55, entryLow: 51.49, entryHigh: 52.01, stop: 51.51, target: null,
        entry: { state: "esperar_retroceso", level: 51.49, levelLabel: "su media de 20", low: 51.49, high: 52.01, validSessions: 15, sma20: 51.49, sma50: 48, atr14: 1.2, extensionAtr: 3.4, rangePct60: 95, why: "está 3,4 ATR sobre su media de 20" } })],
      candles: { YPF: [vela("2026-09-11", 55.55)] },
      plan: null,
    }));
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("grave");
  });

  it("con el stop por debajo de la franja el COMPRAR es ejecutable y no se reporta", () => {
    const f = solo("compra_sin_boleto", checkConsistency({ rows: [fila({ symbol: "NVDA" })], candles: { NVDA: [vela("2026-09-11", 100)] }, plan: null }));
    expect(f).toEqual([]);
  });
});
