import { describe, expect, it } from "vitest";
import { LIDERES_MAX, ordenMedido, planContribution, type EtfConfig, type PlanInput } from "../index.js";

const fila = (flags: string[], riskScore: number | null = 4, balance: number | null = 0.3) => ({ flags, riskScore, axes: balance === null ? {} : { balance } });

describe("ordenMedido (10/10)", () => {
  it("entra con las tres condiciones medidas: sorpresa positiva, riesgo menor a 6 y balance no flojo", () => {
    expect(ordenMedido(fila(["sorpresa_positiva"]))).toEqual({ prioridad: 1, lider: false, motivo: "" });
  });
  it("un líder en retroceso va primero, aunque no tenga sorpresa", () => {
    expect(ordenMedido(fila(["lider_en_retroceso"], 7, -1))).toEqual({ prioridad: 2, lider: true, motivo: "" });
  });
  it("lo que no cumple queda afuera y dice TODO lo que le falta, en palabras", () => {
    const o = ordenMedido(fila(["consenso_compra"], 6, -0.8));
    expect(o.prioridad).toBeNull();
    expect(o.motivo).toBe("sin sorpresa positiva en sus últimos resultados, riesgo 6/10 (desde 6 rinde peor), balance flojo contra sus pares (−0,80)".replace("−", "-"));
  });
  it("sin medida de riesgo no se asume que es bajo", () => {
    expect(ordenMedido(fila(["sorpresa_positiva"], null)).prioridad).toBeNull();
  });
});

const c = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
const core: EtfConfig[] = [{ symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 1 }];
const base: PlanInput = { month: "2026-10", portfolioValueUsd: 100_000, positions: [{ symbol: "VTI", valueUsd: 40_000, assetClass: "etf", role: "nucleo" }], sumarCandidates: [], buyCandidates: [], coreEtfs: core, spyClose: 500, closes: { VTI: 300 } };
const accion = (symbol: string, priority: number | null, extra: Partial<PlanInput["buyCandidates"][number]> = {}): PlanInput["buyCandidates"][number] => ({ symbol, kind: "stock", priority, score: 1, sizeUsd: 9_000, close: 100, stop: 90, target: 120, ...extra });

describe("el plan con el orden medido (10/10)", () => {
  it("lo que no cumple lo medido no entra, y el motivo queda escrito", () => {
    const p = planContribution({ ...base, buyCandidates: [accion("AAA", null, { noElegible: "sin sorpresa positiva en sus últimos resultados" }), accion("BBB", 0.5)] }, c);
    expect(p.lines.map((l) => l.symbol)).toContain("BBB");
    expect(p.lines.map((l) => l.symbol)).not.toContain("AAA");
    expect(p.leftOut?.find((x) => x.symbol === "AAA")?.reason).toMatch(/no cumple lo medido: sin sorpresa positiva/);
  });
  it("al líder en retroceso no lo frena haber subido más de 100%; al resto sí", () => {
    const p = planContribution({ ...base, buyCandidates: [accion("LID", 100.5, { lider: true, flags: ["subio_mucho_12m", "lider_en_retroceso"] }), accion("SUB", 0.8, { flags: ["subio_mucho_12m"] })] }, c);
    expect(p.lines.map((l) => l.symbol)).toContain("LID");
    expect(p.leftOut?.find((x) => x.symbol === "SUB")?.reason).toMatch(/subió más de 100%/);
  });
  it(`como mucho ${LIDERES_MAX} líderes: el tercero queda afuera con su motivo`, () => {
    const lideres = ["L1", "L2", "L3"].map((s, i) => accion(s, 100.9 - i * 0.1, { lider: true }));
    const p = planContribution({ ...base, buyCandidates: [...lideres, accion("NOR", 0.4)] }, { ...c, maxNewPositionsPerMonth: 5 });
    expect(p.lines.filter((l) => ["L1", "L2", "L3"].includes(l.symbol)).map((l) => l.symbol)).toEqual(["L1", "L2"]);
    expect(p.leftOut?.find((x) => x.symbol === "L3")?.reason).toMatch(/tope de 2 líderes en retroceso/);
    expect(p.lines.map((l) => l.symbol)).toContain("NOR");
  });
  it("todas las nuevas reciben el mismo monto", () => {
    const p = planContribution({ ...base, buyCandidates: [accion("AAA", 2.5), accion("BBB", 0.1)] }, c);
    const montos = p.lines.filter((l) => l.kind === "comprar").map((l) => l.amountUsd);
    expect(Math.max(...montos) - Math.min(...montos)).toBeLessThanOrEqual(1);
  });
});
