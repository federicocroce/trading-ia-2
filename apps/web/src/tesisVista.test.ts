import { describe, expect, it } from "vitest";
import { avisoTope, creadaEl, edgeEnPuntos, estadoTesis } from "./tesisVista";

/**
 * Propuestas el 15/9 (B6): las cinco tesis del 6-K de Vista no decían cuándo se crearon, así que no había forma de ver
 * que eran cinco lecturas del mismo filing en tres días. El edge figuraba "15%" acá y "15 puntos" en Hoy. Y el
 * Historial mostraba 200 de 249 sin decirlo.
 */
describe("tarjeta de tesis", () => {
  it("la fecha de creación va en hora de Argentina, no en UTC: 10:40 UTC del 11/9 son las 07:40", () => {
    expect(creadaEl("2026-09-11T10:40:08.657Z")).toBe("11/9 07:40");
    // Pasada la medianoche UTC sigue siendo el día anterior en Argentina.
    expect(creadaEl("2026-09-12T01:15:00.000Z")).toBe("11/9 22:15");
    // Medianoche en Argentina es "00", no "24".
    expect(creadaEl("2026-09-12T03:05:00.000Z")).toBe("12/9 00:05");
  });

  it("el edge es una diferencia de probabilidades: se dice en puntos, igual que en Hoy", () => {
    expect(edgeEnPuntos(0.15)).toBe("15 puntos");
    expect(edgeEnPuntos(0.25)).toBe("25 puntos");
    expect(edgeEnPuntos(0.1)).toBe("10 puntos");
  });

  it("una reemplazada dice por cuál, con su fecha, en vez de un 'rejected' sin motivo", () => {
    expect(estadoTesis({ status: "rejected", rejectionReason: null, reemplazadaPor: { id: "x", createdAt: "2026-09-11T10:40:08.657Z", status: "proposed", edge: 0.15 } })).toBe("reemplazada por la lectura del 11/9 07:40 del mismo evento (propuesta, edge 15 puntos)");
    expect(estadoTesis({ status: "proposed", rejectionReason: null, reemplazadaPor: { id: "y", createdAt: "2026-09-11T10:38:32.485Z", status: "rejected", edge: 0.1 } })).toBe("reemplazada por la lectura del 11/9 07:38 del mismo evento (rechazada, edge 10 puntos)");
    expect(estadoTesis({ status: "rejected", rejectionReason: "edge_below_threshold", reemplazadaPor: null })).toBe("rejected (edge_below_threshold)");
    expect(estadoTesis({ status: "proposed", rejectionReason: null })).toBe("proposed");
  });

  it("el historial dice cuando no muestra todo", () => {
    expect(avisoTope(200, { total: 249, limit: 200 })).toBe("Mostrando las 200 más recientes de 249.");
    expect(avisoTope(12, { total: 12, limit: 200 })).toBeNull();
    expect(avisoTope(200, null)).toBeNull();
  });
});
