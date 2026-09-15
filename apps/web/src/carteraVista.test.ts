import { describe, expect, it } from "vitest";
import type { ContributionPlan, Verdict } from "./api";
import { instruccionCartera, planStatusFor } from "./instruccion";
import { lineaSumar, vistaFila } from "./carteraVista";

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
