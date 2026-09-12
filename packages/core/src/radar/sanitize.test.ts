import { describe, expect, it } from "vitest";
import { sanitizeMetrics } from "../index.js";

describe("sanitizeMetrics", () => {
  it("DVA: con el patrimonio borrado, el ROE deja de contar y la deuda sigue castigando", () => {
    const { metrics, removed } = sanitizeMetrics({ "totalDebt/totalEquityAnnual": 77.99, roeTTM: 181.22, operatingMarginTTM: 15.1, netProfitMarginTTM: 6.1 });
    expect(metrics["roeTTM"]).toBeNull();
    // El castigo no se toca: una empresa con el patrimonio destruido tiene que puntuar mal en balance.
    expect(metrics["totalDebt/totalEquityAnnual"]).toBe(77.99);
    expect(removed.map((r) => r.key)).toContain("roeTTM");
  });

  it("GOOGL: el margen neto inflado por una ganancia no operativa deja de contar como calidad", () => {
    // 99.000 M de revalorización no realizada de SpaceX en el Q2 2026.
    const { metrics, removed } = sanitizeMetrics({ operatingMarginTTM: 33.11, netProfitMarginTTM: 54.75 });
    expect(metrics["netProfitMarginTTM"]).toBeNull();
    expect(metrics["operatingMarginTTM"]).toBe(33.11); // el operativo sí mide el negocio y queda
    expect(removed[0]!.reason).toContain("no viene de la operación");
  });

  it("NVDA: márgenes sanos y ROE alto con patrimonio real no se tocan", () => {
    const m = { "totalDebt/totalEquityAnnual": 0.05, roeTTM: 110.11, operatingMarginTTM: 65.2, netProfitMarginTTM: 63.7 };
    const { metrics, removed } = sanitizeMetrics(m);
    expect(metrics).toEqual(m);
    expect(removed).toEqual([]);
  });

  it("JANX: una empresa con pérdida no se toca", () => {
    const m = { operatingMarginTTM: -421.47, netProfitMarginTTM: -294.36 };
    expect(sanitizeMetrics(m).removed).toEqual([]);
  });

  it("una diferencia chica entre neto y operativo es normal y no se toca", () => {
    const m = { operatingMarginTTM: 20, netProfitMarginTTM: 23 };
    expect(sanitizeMetrics(m).removed).toEqual([]);
  });

  it("no inventa métricas que no estaban", () => {
    const { metrics } = sanitizeMetrics({ "totalDebt/totalEquityAnnual": 50 });
    expect("roeTTM" in metrics).toBe(false);
  });
});
