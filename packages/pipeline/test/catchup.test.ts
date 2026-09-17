import { describe, expect, it } from "vitest";
import { STEPS, dueSteps, expectedDate, stepById } from "../src/index.js";

// Fechas en hora local (como node-cron): el resultado no depende de la zona horaria de la máquina.
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

describe("expectedDate", () => {
  it("diario lun–vie: hoy si ya pasó la hora, si no el último día hábil anterior", () => {
    const radar = stepById("radar"); // 07:50
    expect(expectedDate(radar, at(2026, 9, 8, 9))).toBe("2026-09-08"); // martes 09:00
    expect(expectedDate(radar, at(2026, 9, 8, 7, 30))).toBe("2026-09-07"); // martes 07:30 → lunes
    expect(expectedDate(radar, at(2026, 9, 7, 6))).toBe("2026-09-04"); // lunes 06:00 → viernes
    expect(expectedDate(radar, at(2026, 9, 6, 15))).toBe("2026-09-04"); // domingo → viernes
  });
  it("semanal domingo 20:00: hoy si es domingo y ya pasó la hora, si no el domingo anterior", () => {
    const scan = stepById("scan");
    expect(expectedDate(scan, at(2026, 9, 6, 21))).toBe("2026-09-06");
    expect(expectedDate(scan, at(2026, 9, 6, 19))).toBe("2026-08-30");
    expect(expectedDate(scan, at(2026, 9, 9, 10))).toBe("2026-09-06");
  });
  it("mensual día 1 08:00: este mes si ya pasó, si no el anterior", () => {
    const plan = stepById("plan");
    expect(expectedDate(plan, at(2026, 9, 1, 7))).toBe("2026-08");
    expect(expectedDate(plan, at(2026, 9, 1, 9))).toBe("2026-09");
    expect(expectedDate(plan, at(2026, 9, 15))).toBe("2026-09");
    expect(expectedDate(plan, at(2026, 1, 1, 7))).toBe("2025-12");
  });
});

describe("dueSteps", () => {
  it("pendiente = última corrida anterior a la esperada; sin corrida nunca = pendiente; en orden de ejecución", () => {
    const now = at(2026, 9, 8, 9); // martes 09:00
    const due = dueSteps({ scan: "2026-09-06", cartera: "2026-09-08", radar: "2026-09-07", argentina: null, plan: "2026-08", tesis: "2026-09-08" }, now);
    expect(due.map((d) => d.id)).toEqual(["argentina", "radar", "plan"]);
    // `argentina` nunca corrió, así que va primera; `radar` corrió el 7 y quedó pendiente del 8.
    expect(due[0]).toEqual({ id: "argentina", label: stepById("argentina").label, last: null, expected: "2026-09-08" });
    expect(due[1]).toEqual({ id: "radar", label: stepById("radar").label, last: "2026-09-07", expected: "2026-09-08" });
  });
  it("todo al día: nada pendiente; un sábado no hay nada diario pendiente si el viernes corrió", () => {
    expect(dueSteps({ scan: "2026-09-06", cartera: "2026-09-08", radar: "2026-09-08", argentina: "2026-09-08", plan: "2026-09", tesis: "2026-09-08" }, at(2026, 9, 8, 9))).toEqual([]);
    expect(dueSteps({ scan: "2026-09-06", cartera: "2026-09-11", radar: "2026-09-11", argentina: "2026-09-11", plan: "2026-09", tesis: "2026-09-11" }, at(2026, 9, 12, 10))).toEqual([]);
  });
  it("el barrido semanal se ejecuta antes que lo diario; el ranking no es un paso del calendario", () => {
    const due = dueSteps({}, at(2026, 9, 8, 9));
    expect(due.map((d) => d.id)).toEqual(["scan", "cartera", "argentina", "radar", "plan", "tesis"]);
    expect(STEPS.some((s) => (s.id as string) === "rank")).toBe(false);
  });

  /**
   * 17/9, día de ejecución. `radar` termina rearmando el plan, y armar el plan dispara los controles. Corría antes
   * que `argentina`, así que los controles juzgaban el Radar con las filas de los ADR argentinos todavía del día
   * anterior: 14 graves sobre datos que veinte segundos después ya estaban bien, y el plan frenado todo el día.
   *
   * Los dos pasos estaban a la misma hora (07:50) y `argentina` no depende de `radar` —sólo busca la fila previa de
   * cada símbolo argentino, que es la misma corra antes o después—, así que el orden era incidental.
   */
  it("Argentina corre ANTES que el Radar: el plan y sus controles tienen que ver el Radar completo", () => {
    const orden = STEPS.map((s) => s.id);
    expect(orden.indexOf("argentina")).toBeLessThan(orden.indexOf("radar"));
  });
});
