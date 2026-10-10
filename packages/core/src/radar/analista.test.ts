import { describe, expect, it } from "vitest";
import { VeredictoAnalistaSchema, planContribution, textoNoDelAnalista, veredictosVigentes, type EtfConfig, type PlanInput, type VeredictoAnalista } from "../index.js";

const v = (over: Partial<VeredictoAnalista>): VeredictoAnalista => ({ symbol: "TSEM", fecha: "2026-10-10", veredicto: "no", criterio: "valuacion_extrema_con_insiders", motivo: "P/E 94 y 38 ventas de insiders sin compras", fuente: null, version: "analista-1", ...over });

describe("veredicto del analista (10/10)", () => {
  it("un \"no\" sin criterio de la lista no valida: no es una opinión libre", () => {
    expect(VeredictoAnalistaSchema.safeParse({ ...v({}), criterio: null }).success).toBe(false);
    expect(VeredictoAnalistaSchema.safeParse({ ...v({}), criterio: "me_da_mala_espina" }).success).toBe(false);
  });
  it("un \"no\" por un hecho o un dato erróneo exige fuente; por valuación e insiders, no (sale de los datos de la app)", () => {
    expect(VeredictoAnalistaSchema.safeParse(v({ criterio: "deterioro_no_capturado", fuente: null })).success).toBe(false);
    expect(VeredictoAnalistaSchema.safeParse(v({ criterio: "deterioro_no_capturado", fuente: { url: "https://www.sec.gov/x", titulo: "8-K" } })).success).toBe(true);
    expect(VeredictoAnalistaSchema.safeParse(v({})).success).toBe(true);
  });
  it("un \"sí\" no necesita criterio", () => {
    expect(VeredictoAnalistaSchema.safeParse(v({ veredicto: "si", criterio: null, motivo: "ningún criterio aplica" })).success).toBe(true);
  });
  it("vale 5 días y gana el más nuevo", () => {
    const m = veredictosVigentes([v({ fecha: "2026-10-01", veredicto: "si", criterio: null }), v({ fecha: "2026-10-08" }), v({ symbol: "AMAT", fecha: "2026-10-02", veredicto: "si", criterio: null })], "2026-10-10");
    expect(m.get("TSEM")?.veredicto).toBe("no");
    expect(m.has("AMAT")).toBe(false); // 8 días: vencido
  });
});

const c = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
const core: EtfConfig[] = [{ symbol: "VTI", name: "VTI", role: "nucleo", exposure: "rv_us", ter: 0.03, themes: [], coreWeight: 1 }];
const base: PlanInput = { month: "2026-10", portfolioValueUsd: 100_000, positions: [{ symbol: "VTI", valueUsd: 40_000, assetClass: "etf", role: "nucleo" }], sumarCandidates: [], buyCandidates: [], coreEtfs: core, spyClose: 500, closes: { VTI: 300 } };
const accion = (symbol: string, priority: number, analista: { veredicto: "si" | "no"; criterio: string | null; motivo: string } | null): PlanInput["buyCandidates"][number] => ({ symbol, kind: "stock", priority, score: 1, sizeUsd: 9_000, close: 100, stop: 90, target: 120, analista });

describe("el plan respeta el veredicto del analista (10/10)", () => {
  it("un \"no\" deja la línea afuera con el criterio y el motivo, y entra la siguiente", () => {
    const no = { veredicto: "no" as const, criterio: "valuacion_extrema_con_insiders", motivo: "P/E 94 y 38 ventas de insiders" };
    const p = planContribution({ ...base, buyCandidates: [accion("TSEM", 2, no), accion("AMAT", 1.5, { veredicto: "si", criterio: null, motivo: "ok" }), accion("PLUS", 1, { veredicto: "si", criterio: null, motivo: "ok" })] }, c);
    expect(p.lines.map((l) => l.symbol)).not.toContain("TSEM");
    expect(p.lines.map((l) => l.symbol)).toEqual(expect.arrayContaining(["AMAT", "PLUS"]));
    expect(p.leftOut?.find((x) => x.symbol === "TSEM")?.reason).toContain(textoNoDelAnalista({ criterio: "valuacion_extrema_con_insiders", motivo: "P/E 94 y 38 ventas de insiders" }));
  });
  it("sin veredicto todavía, entra con el aviso de que falta", () => {
    const p = planContribution({ ...base, buyCandidates: [accion("PLUS", 1, null)] }, c);
    expect(p.lines.find((l) => l.symbol === "PLUS")?.avisos).toContain("veredicto del analista pendiente");
  });
});
