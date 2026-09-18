import { describe, expect, it } from "vitest";
import type { ContributionPlan } from "./api";
import { controlesBloquean, instruccionCartera, instruccionRadar, planStatusFor } from "./instruccion";

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
  // El estado normal: los controles automáticos corrieron sobre esta versión del plan y no encontraron nada grave.
  builtAt: "2026-09-15T12:54:06.940Z",
  controles: { at: "2026-09-15T12:54:30.000Z", planBuiltAt: "2026-09-15T12:54:06.940Z", graves: 0, avisos: 2, findings: [] },
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

describe("controles que frenan (15/9)", () => {
  /**
   * El 15/9 el plan siguió diciendo "comprar NVDA" con NVDA en OBSERVAR: la corrida no lo rearmó y el control que lo
   * detecta nunca corrió. Ahora corren solos, y si encuentran algo grave, no corrieron o no pudieron correr sobre esta
   * versión del plan, ninguna línea dice COMPRAR, SUMAR ni NÚCLEO: dice ESPERAR, con el motivo.
   */
  const grave = { ...plan, controles: { ...plan.controles!, graves: 1, findings: [{ check: "plan_contra_radar", symbol: "NVDA", severity: "grave" as const, detail: "el plan lo compra y el Radar lo tiene en OBSERVAR" }] } };
  it("con un grave: ESPERAR en el Radar, en el núcleo y en Cartera, con el motivo", () => {
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", grave))).toMatchObject({ label: "ESPERAR", tone: "ESPERAR" });
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", grave)).detail).toMatch(/no ejecutar: .*error grave.*NVDA: el plan lo compra y el Radar lo tiene en OBSERVAR/);
    expect(instruccionRadar("NUCLEO", planStatusFor("VTI", grave)).label).toBe("ESPERAR");
    expect(instruccionCartera("SUMAR", planStatusFor("NEM", grave)).label).toBe("ESPERAR");
  });
  it("sin controles sobre esta versión (se rearmó después) o si no pudieron correr, tampoco se ejecuta", () => {
    expect(controlesBloquean({ ...plan, controles: null })).toMatch(/todavía no revisaron este plan/);
    expect(controlesBloquean({ ...plan, builtAt: "2026-09-15T13:10:00.000Z" })).toMatch(/todavía no revisaron este plan/);
    expect(controlesBloquean({ ...plan, controles: { ...plan.controles!, error: "/radar/candidates respondió 500" } })).toMatch(/no pudieron correr: .*500/);
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", { ...plan, controles: null })).label).toBe("ESPERAR");
  });
  it("18/9: la revisión antes de comprar en curso ya no frena el plan: las líneas pendientes entran con su aviso escrito", () => {
    // Del 15/9 al 18/9 el plan compró solo núcleo: la revisión nunca corrió (cero filas) y todo quedaba "en curso".
    // Aprobado por el dueño: la IA avisa; de la revisión solo frena una objeción, que saca la línea del plan.
    expect(controlesBloquean({ ...plan, reviewsPending: ["APH", "TSM"] })).toBeNull();
    expect(instruccionRadar("NUCLEO", planStatusFor("VTI", { ...plan, reviewsPending: ["APH"] })).label).not.toBe("ESPERAR");
  });
  it("con los controles al día y sin graves, nada cambia; lo que no está en el plan sigue siendo CANDIDATA", () => {
    expect(controlesBloquean(plan)).toBeNull();
    expect(instruccionRadar("COMPRAR", planStatusFor("NBN", grave)).label).toBe("CANDIDATA");
  });
});

describe("tramos (auditoría del 15/9)", () => {
  it("con tres tramos, el detalle dice el total y el primer tramo: la tabla de ETFs decía 'USD 24.000 en el plan de hoy' y el jueves se compran 8.000", () => {
    const enTramos: ContributionPlan = { ...plan, tranches: 3, lines: plan.lines.map((l) => (l.symbol === "VTI" ? { ...l, amountUsd: 24_000, trancheUsd: 8_000 } : l)) };
    expect(instruccionRadar("NUCLEO", planStatusFor("VTI", enTramos)).detail).toBe("USD 24.000 en el plan · 1er tramo USD 8.000");
    // Un plan guardado sin la cifra del tramo (anterior al 15/9) la calcula igual que el plan.
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", { ...plan, tranches: 3 })).detail).toBe("USD 3.452 en el plan · 1er tramo USD 1.150");
    expect(instruccionCartera("SUMAR", planStatusFor("NEM", { ...plan, tranches: 3 })).detail).toBe("USD 1.500 en el plan · 1er tramo USD 500");
  });
});


describe("los avisos de la IA viajan con COMPRAR en todas las pantallas (18/9)", () => {
  /*
   * Desde el 18/9 "con reservas", "pendiente" y "no pude verificar" no frenan: el plan compra y lo dice. El dueño compra
   * lo que dice COMPRAR en cualquier pantalla, así que el aviso no puede vivir solo en la tabla del plan: va al lado de
   * la etiqueta, en la fila del Radar y en la ficha.
   */
  const conAvisos: ContributionPlan = { ...plan, lines: plan.lines.map((l) => (l.symbol === "APH" ? { ...l, avisos: ["verificación web con reservas: venta neta de insiders", "revisión antes de comprar pendiente"] } : l.symbol === "NEM" ? { ...l, avisos: ["verificación web pendiente"] } : l)) };
  it("APH: dice COMPRAR con su monto y, al lado, cada aviso", () => {
    const ins = instruccionRadar("COMPRAR", planStatusFor("APH", conAvisos));
    expect(ins.label).toBe("COMPRAR");
    expect(ins.detail).toBe("USD 3.452 en el plan de hoy · ⚠ verificación web con reservas: venta neta de insiders · ⚠ revisión antes de comprar pendiente");
  });
  it("donde la etiqueta va sola, sin el texto al lado (la barra lateral), COMPRAR lleva la marca ⚠", () => {
    expect(instruccionRadar("COMPRAR", planStatusFor("APH", conAvisos)).avisos).toBe(2);
    expect(instruccionRadar("COMPRAR", planStatusFor("V", conAvisos)).avisos ?? 0).toBe(0);
  });
  it("un SUMAR también, en Radar y en Cartera; una línea sin avisos queda como siempre", () => {
    expect(instruccionCartera("SUMAR", planStatusFor("NEM", conAvisos)).detail).toBe("USD 1.500 en el plan de hoy · ⚠ verificación web pendiente");
    expect(instruccionRadar("COMPRAR", planStatusFor("V", conAvisos)).detail).toBe("USD 2.498 en el plan de hoy");
  });
});
