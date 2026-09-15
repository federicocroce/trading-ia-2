import { describe, expect, it } from "vitest";
import type { ContributionPlan, Position, Quote, Verdict } from "./api";
import { instruccionCartera, planStatusFor } from "./instruccion";
import { lineaSumar, pesosAhora, totals, valuation, vistaFila } from "./carteraVista";

/**
 * TSM el 15/9, tal como estaba en la base y en el plan. El plan lo dejó afuera ("6° por convicción: verificación web
 * con reservas") y Cartera lo mostraba como MANTENER, pero con el objetivo de SUMAR (533,92, desde el techo de la franja
 * de compra 453,18), el motivo "Candidata a aporte" y un modelo que decía "El veredicto SUMAR se justifica".
 */
const tsm: Verdict = {
  verdictDate: "2026-09-15", symbol: "TSM", verb: "SUMAR",
  reason: "Candidata a aporte: pesa 7.02% (< 80% de 12.5%), está arriba del stop y subió -2.9% en 21 velas. Stop $412.81, objetivo $533.92 (2 a 1 desde $453.18, el techo de la franja de compra).",
  narrative: "El veredicto SUMAR se justifica porque la posición cotiza a $418,01, por encima del stop de $412,81, acumulando una ganancia del 11,11% con un peso contenido del 7,02%. El objetivo proyectado es de $533,92 y los filings muestran compras recientes de insiders sin evidencias de deterioro operativo.",
  warning: null, close: 418.01, spot: 418.6, stop: 412.81, target: 533.92, gainPct: 11.11, weightPct: 7.02, spyClose: 760.88, degradedBy: null, closeDate: "2026-09-14", holdTarget: 428.41,
};
const motivoTsm = "6° por convicción: verificación web con reservas: La valuación actual de TSM se encuentra en el tercio superior de su historial de 5 años, y la venta neta de acciones por parte de insiders en los últimos 12 meses sugiere cautela.";
const plan: ContributionPlan = {
  month: "2026-09", totalUsd: 40_000,
  lines: [{ symbol: "VTI", kind: "nucleo", amountUsd: 24_000, rationale: "núcleo", close: 376.31, alpha30dPct: null, alpha90dPct: null }],
  notes: ["No se sumó TSM: el ETF de su tema (QQQ) está en OBSERVAR: bajo_stop."],
  leftOut: [{ symbol: "TSM", reason: motivoTsm }],
  builtAt: "2026-09-15T18:56:51.462Z",
  controles: { at: "2026-09-15T18:57:10.000Z", planBuiltAt: "2026-09-15T18:56:51.462Z", graves: 0, avisos: 0, findings: [] },
};
const ins = (p: ContributionPlan, v: Verdict = tsm) => instruccionCartera(v.verb, planStatusFor(v.symbol, p));

describe("vistaFila: una fila de Cartera dice lo mismo que la instrucción", () => {
  it("TSM 15/9: el plan no suma, así que el objetivo es el de la posición (428,41) y el motivo es el del plan", () => {
    const i = ins(plan);
    expect(i.label).toBe("MANTENER");
    const f = vistaFila(tsm, i, lineaSumar(plan, "TSM"));
    expect(f.objetivo).toBe(428.41);
    expect(f.siSumas).toBeNull();
    expect(f.motivo).toBe("Mantené (no se suma hoy: verificación web con reservas: La valuación actual de TSM se encuentra en el tercio superior de su historial de 5 años, y la venta neta de acciones por parte de insiders en los últimos 12 meses sugiere cautela). Tu stop sube solo a $412.81 y el objetivo de la posición es $428.41: salís solo si cierra abajo.");
    expect(f.motivo).not.toContain("Candidata a aporte");
    expect(f.motivo).not.toContain("533");
  });

  it("TSM 15/9: la narración del modelo, escrita sobre SUMAR, queda rotulada como tal", () => {
    const f = vistaFila(tsm, ins(plan), null);
    expect(f.narrativa).toBe(`El análisis por precio sugería sumar; el plan no lo suma (no se suma hoy: ${motivoTsm.replace("6° por convicción: ", "").replace(/\.$/, "")}). Lo que escribió el modelo sobre ese análisis: ${tsm.narrative}`);
  });

  it("si el plan sí suma, el objetivo principal sigue siendo el de la posición y el de la compra se rotula 'si sumás desde X'", () => {
    const suma: ContributionPlan = { ...plan, leftOut: [], notes: [], lines: [...plan.lines, { symbol: "TSM", kind: "sumar", amountUsd: 3_000, rationale: "subponderada", close: 418.01, alpha30dPct: null, alpha90dPct: null, entryHigh: 453.18, stop: 412.81, target: 533.92 }] };
    const i = ins(suma);
    expect(i.label).toBe("SUMAR");
    const f = vistaFila(tsm, i, lineaSumar(suma, "TSM"));
    expect(f.objetivo).toBe(428.41);
    expect(f.siSumas).toEqual({ desde: 453.18, objetivo: 533.92 });
    expect(f.motivo).toBe(tsm.reason);
    expect(f.narrativa).toBe(tsm.narrative);
  });

  it("si el plan lo suma pero los controles frenan, dice esperar y deja la compra rotulada", () => {
    const suma: ContributionPlan = { ...plan, leftOut: [], notes: [], controles: null, lines: [...plan.lines, { symbol: "TSM", kind: "sumar", amountUsd: 3_000, rationale: "subponderada", close: 418.01, alpha30dPct: null, alpha90dPct: null, entryHigh: 453.18, stop: 412.81, target: 533.92 }] };
    const i = ins(suma);
    expect(i.label).toBe("ESPERAR");
    const f = vistaFila(tsm, i, lineaSumar(suma, "TSM"));
    expect(f.objetivo).toBe(428.41);
    expect(f.siSumas).toEqual({ desde: 453.18, objetivo: 533.92 });
    expect(f.motivo.startsWith("Esperá (no ejecutar: los controles automáticos todavía no revisaron este plan")).toBe(true);
    expect(f.motivo).toContain(tsm.reason);
  });

  it("un MANTENER común no cambia: su motivo, su narración y su objetivo, que ya es el de la posición", () => {
    const ggal: Verdict = { ...tsm, symbol: "GGAL", verb: "MANTENER", reason: "Dejá correr. Tu stop sube solo a $40.81 y el objetivo es $47.26: salís solo si cierra abajo.", narrative: "Sin novedades.", close: 42.96, stop: 40.81, target: 47.26, holdTarget: 47.26 };
    const f = vistaFila(ggal, ins(plan, ggal), null);
    expect(f).toEqual({ objetivo: 47.26, siSumas: null, motivo: ggal.reason, narrativa: "Sin novedades." });
  });
});

/**
 * 15/9 (B4). La columna "valor" usaba el precio vivo y la de "peso" el cierre guardado: GGAL 25,04% contra 24,80% con
 * el precio de ese momento, en la misma fila. Y "precio viejo" era una cuenta propia de más de 3 días, mientras el
 * servidor (la cinta, la watchlist) marca viejo lo de más de 30 horas: el mismo precio se veía vivo acá y gris allá.
 */
describe("peso y precio viejo: la misma base que la columna valor y el criterio del servidor", () => {
  const pos = (symbol: string, quantity: number, avgCost: number): Position => ({ symbol, quantity, avgCost, currency: "USD", market: "us", layer: "riesgo", notes: null });
  // Las ocho posiciones reales y los cierres del 14/9 con que corrió el veredicto del 15/9.
  const cartera: Array<[string, number, number, number, number]> = [
    ["GGAL", 920.77279309, 34.6788, 42.96, 25.04], ["HUT", 149.65996595, 66.6845, 91.13, 8.63], ["MARA", 632.43161017, 7.8886, 11.5, 4.6], ["NEM", 44.49726912, 111.4931, 123.07, 3.47],
    ["PAM", 367.13513249, 73.392, 86.65, 20.14], ["TSM", 26.52852693, 376.1988, 418.01, 7.02], ["VIST", 231.9381059, 43.0257, 76.41, 11.22], ["YPF", 557.35797034, 30.4379, 56.33, 19.88],
  ];
  const positions = cartera.map(([s, q, c]) => pos(s, q, c));
  const verdicts = new Map(cartera.map(([s, , , close, w]) => [s, { ...tsm, symbol: s, verb: "MANTENER" as const, close, weightPct: w }]));
  const vivo = (price: number): Quote => ({ price, prevClose: null, change: null, changePct: null, asOf: "2026-09-15T15:30:00Z", stale: false });

  it("con el precio vivo de GGAL el peso es el de ese valor, no el 25,04% del cierre guardado", () => {
    const quotes: Record<string, Quote | null> = Object.fromEntries(cartera.map(([s, , , close]) => [s, vivo(s === "GGAL" ? 42.5 : close)]));
    const pesos = pesosAhora(positions, verdicts, quotes);
    const tot = totals(positions, verdicts, quotes);
    const ggal = valuation(positions[0]!, verdicts.get("GGAL"), quotes["GGAL"]!);
    expect(pesos["GGAL"]).toBeCloseTo((ggal.value! / tot.value) * 100, 6);
    expect(pesos["GGAL"]).toBeCloseTo(24.84, 2);
    expect(Object.values(pesos).reduce((a: number, b) => a + (b ?? 0), 0)).toBeCloseTo(100, 6);
  });

  it("sin precio vivo, peso y valor usan el mismo cierre del veredicto: da el peso guardado", () => {
    expect(pesosAhora(positions, verdicts, {})["GGAL"]).toBeCloseTo(25.04, 2);
  });

  it("precio viejo es lo que dice el servidor: un precio de hace 40 horas marcado viejo no se muestra como vivo", () => {
    const hace40h: Quote = { price: 42.5, prevClose: null, change: null, changePct: null, asOf: new Date(Date.now() - 40 * 3_600_000).toISOString(), stale: true };
    expect(valuation(positions[0]!, verdicts.get("GGAL"), hace40h).live).toBe(false);
    expect(valuation(positions[0]!, verdicts.get("GGAL"), { ...hace40h, stale: false }).live).toBe(true);
    // Sin la marca del servidor no se afirma que sea de hoy.
    const sinMarca: Quote = { price: 42.5, prevClose: null, change: null, changePct: null, asOf: hace40h.asOf };
    expect(valuation(positions[0]!, verdicts.get("GGAL"), sinMarca).live).toBe(false);
  });
});
