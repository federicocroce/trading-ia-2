import { describe, expect, it } from "vitest";
import type { ContributionPlan } from "./api";
import { instruccionCartera, instruccionRadar, planStatusFor } from "./instruccion";

/**
 * 14/9: "volvemos a tener doble discurso". Hoy decía "Entran a COMPRAR: HSBC, ORRF", la tarjeta de arriba del Radar
 * recomendaba APH, TSM, NVDA, ORRF y NBN, el plan compraba APH y NVDA, y la tabla de acciones tenía 12 en COMPRAR.
 * El dueño: "si la app dice comprar yo compro, y no importa en qué pantalla esté". COMPRAR tiene un solo significado:
 * está en el plan vigente, con su monto. Lo que pasa los filtros y no entra es CANDIDATA, con el motivo.
 */
const plan: ContributionPlan = {
  month: "2026-09", totalUsd: 40_000, notes: ["No se sumó TSM: verificación hecha con el cuestionario anterior: se repite antes de comprarla. Su parte (USD 3527) va al núcleo."],
  lines: [
    { symbol: "VTI", kind: "nucleo", amountUsd: 20_214, rationale: "núcleo", close: 376.31, alpha30dPct: null, alpha90dPct: null },
    { symbol: "APH", kind: "comprar", amountUsd: 3_452, rationale: "1° por convicción", close: 83.92, alpha30dPct: null, alpha90dPct: null },
    { symbol: "V", kind: "seguimiento", amountUsd: 2_498, rationale: "tu lista", close: 370.45, alpha30dPct: null, alpha90dPct: null },
    { symbol: "NEM", kind: "sumar", amountUsd: 1_500, rationale: "subponderada", close: 126.81, alpha30dPct: null, alpha90dPct: null },
  ],
  leftOut: [
    { symbol: "NBN", reason: "5° por convicción: verificación web con reservas: valuación en máximo" },
    { symbol: "TSM", reason: "2° por convicción: verificación hecha con el cuestionario anterior: se repite antes de comprarla" },
  ],
};

describe("planStatusFor", () => {
  it("lo que está en el plan trae su tipo y su monto; lo que quedó afuera, el motivo; lo demás, nada", () => {
    expect(planStatusFor("APH", plan)).toEqual({ kind: "comprar", amountUsd: 3_452 });
    expect(planStatusFor("NBN", plan)).toEqual({ kind: "fuera", reason: "5° por convicción: verificación web con reservas: valuación en máximo" });
    expect(planStatusFor("HSBC", plan)).toBeNull();
    expect(planStatusFor("APH", null)).toBeNull();
  });
  it("un SUMAR que el plan no sumó toma el motivo de la nota", () => {
    expect(planStatusFor("TSM", { ...plan, leftOut: [] })).toEqual({ kind: "fuera", reason: "verificación hecha con el cuestionario anterior: se repite antes de comprarla" });
  });
});

describe("instruccionRadar: COMPRAR solo si está en el plan", () => {
  it("en el plan: COMPRAR con el monto", () => {
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", plan))).toMatchObject({ label: "COMPRAR", tone: "COMPRAR", detail: "USD 3.452 en el plan de hoy" });
    expect(instruccionRadar("COMPRAR", planStatusFor("V", plan)).label).toBe("COMPRAR");
  });
  it("lo que ya tenés y el plan suma dice SUMAR, no COMPRAR", () => {
    expect(instruccionRadar("COMPRAR", planStatusFor("NEM", plan))).toMatchObject({ label: "SUMAR", detail: "USD 1.500 en el plan de hoy" });
  });
  it("pasa los filtros pero no entra: CANDIDATA con el motivo, nunca COMPRAR", () => {
    const nbn = instruccionRadar("COMPRAR", planStatusFor("NBN", plan));
    expect(nbn.label).toBe("CANDIDATA");
    expect(nbn.detail).toBe("no se compra: verificación web con reservas: valuación en máximo");
    expect(instruccionRadar("COMPRAR", planStatusFor("HSBC", plan))).toMatchObject({ label: "CANDIDATA", detail: "no está en el plan de hoy" });
  });
  it("Argentina: ningún plan la compra (decisión del dueño, 14/9)", () => {
    expect(instruccionRadar("COMPRAR", null, "argentina")).toMatchObject({ label: "CANDIDATA", detail: "el plan en dólares no compra papeles argentinos" });
  });
  it("OBSERVAR y NÚCLEO no cambian; el núcleo lleva su monto si el plan lo compra", () => {
    expect(instruccionRadar("OBSERVAR", planStatusFor("NBN", plan)).label).toBe("OBSERVAR");
    expect(instruccionRadar("NUCLEO", planStatusFor("VTI", plan))).toMatchObject({ label: "NÚCLEO", detail: "USD 20.214 en el plan de hoy" });
    expect(instruccionRadar("NUCLEO", null)).toMatchObject({ label: "NÚCLEO", detail: null });
  });
  it("sin plan, nada dice COMPRAR", () => {
    expect(instruccionRadar("COMPRAR", null).label).toBe("CANDIDATA");
  });
});

describe("instruccionCartera: SUMAR solo si el plan lo suma", () => {
  it("TSM del 14/9: Cartera decía SUMAR y el plan no lo sumaba", () => {
    const tsm = instruccionCartera("SUMAR", planStatusFor("TSM", plan));
    expect(tsm.label).toBe("MANTENER");
    expect(tsm.detail).toBe("no se suma hoy: verificación hecha con el cuestionario anterior: se repite antes de comprarla");
    expect(instruccionCartera("SUMAR", planStatusFor("NEM", plan))).toMatchObject({ label: "SUMAR", detail: "USD 1.500 en el plan de hoy" });
    expect(instruccionCartera("SUMAR", null)).toMatchObject({ label: "MANTENER", detail: "no se suma en el plan de hoy" });
  });
  it("MANTENER, VENDER y REVISAR no dependen del plan", () => {
    for (const v of ["MANTENER", "VENDER", "REVISAR"] as const) expect(instruccionCartera(v, null)).toMatchObject({ label: v, detail: null });
  });
});
