import { describe, expect, it } from "vitest";
import { explainPlanChange, type PlanSymbolInput } from "./plan-changes.js";
import type { ContributionPlan, PlanLine } from "./plan.js";

const linea = (symbol: string, kind: PlanLine["kind"], amountUsd: number): PlanLine => ({ symbol, kind, amountUsd, rationale: "", close: null, spyClose: null, alpha30dPct: null, alpha90dPct: null });
const entrada = (over: Partial<PlanSymbolInput> = {}): PlanSymbolInput => ({ kind: "stock", verdict: "COMPRAR", close: 100, stop: 90, verification: "apto", ...over });
const plan = (lines: PlanLine[], inputs: Record<string, PlanSymbolInput>, extra: Partial<ContributionPlan> = {}): ContributionPlan => ({ month: "2026-09", totalUsd: 40_000, lines, notes: [], leftOut: [], inputs, ...extra });

describe("explainPlanChange", () => {
  it("APH el 14/9: lo seguiste desde la ficha y pasó de 3.820 a 2.456 — cambió por una acción tuya, no por el mercado", () => {
    const antes = plan([linea("APH", "comprar", 3820)], { APH: entrada() });
    const despues = plan([linea("APH", "seguimiento", 2456)], { APH: entrada({ kind: "watch" }) });
    const [c] = explainPlanChange(antes, despues);
    expect(c).toMatchObject({ symbol: "APH", change: "monto", fromUsd: 3820, toUsd: 2456, source: "usuario" });
    expect(c!.cause).toMatch(/seguimiento/);
  });
  it("NVDA el 15/9: cerró bajo su stop dinámico y el Radar la pasó a OBSERVAR — sale por el mercado, con el precio y el stop", () => {
    const antes = plan([linea("NVDA", "comprar", 2684)], { NVDA: entrada({ close: 218.29, stop: 199.06 }) });
    const despues = plan([], { NVDA: entrada({ verdict: "OBSERVAR", close: 210.96, stop: 214.65 }) });
    const [c] = explainPlanChange(antes, despues);
    expect(c).toMatchObject({ symbol: "NVDA", change: "sale", fromUsd: 2684, toUsd: 0, source: "mercado" });
    expect(c!.cause).toBe("el Radar la pasó de COMPRAR a OBSERVAR (cierre 210,96, stop 214,65)");
  });
  it("TSM el 15/9: el precio quedó pegado al stop y la regla lo sacó — sale por el mercado, con el motivo de la regla", () => {
    const antes = plan([linea("TSM", "sumar", 3527)], { TSM: entrada({ kind: "posicion", verdict: "SUMAR", close: 433.24, stop: 413.63 }) });
    const motivo = "el precio (418,01) está a 0,5 ATR del stop (412,81): dentro del ruido de un día";
    const despues = plan([], { TSM: entrada({ kind: "posicion", verdict: "SUMAR", close: 418.01, stop: 412.81 }) }, { notes: [`No se sumó TSM: ${motivo}. Su parte (USD 3527) va al núcleo.`] });
    const [c] = explainPlanChange(antes, despues);
    expect(c).toMatchObject({ symbol: "TSM", change: "sale", source: "mercado" });
    expect(c!.cause).toContain(motivo);
  });
  it("la verificación que cambia se dice como verificación, y la regla que saca una fila sin que cambien sus datos, como regla", () => {
    const antes = plan([linea("GFI", "comprar", 2162), linea("LNC", "comprar", 2000)], { GFI: entrada(), LNC: entrada() });
    const despues = plan([], { GFI: entrada(), LNC: entrada({ verification: "con_reservas" }) }, { leftOut: [{ symbol: "GFI", reason: "6° por convicción: se mueve como NEM que ya tenés (correlación 0,86): no diversifica" }, { symbol: "LNC", reason: "3° por convicción: verificación web con reservas: x" }] });
    const cambios = Object.fromEntries(explainPlanChange(antes, despues).map((c) => [c.symbol, c]));
    expect(cambios["LNC"]).toMatchObject({ source: "verificacion" });
    expect(cambios["GFI"]).toMatchObject({ source: "regla" });
    expect(cambios["GFI"]!.cause).toMatch(/no diversifica/);
  });
  it("el núcleo recibe lo que dejan las que salen (reparto) y un monto nuevo se dice como monto", () => {
    const antes = plan([linea("VTI", "nucleo", 18_663), linea("NVDA", "comprar", 2684)], { NVDA: entrada() }, { totalUsd: 40_000 });
    const despues = plan([linea("VTI", "nucleo", 24_000)], { NVDA: entrada({ verdict: "OBSERVAR" }) }, { totalUsd: 40_000 });
    expect(explainPlanChange(antes, despues).find((c) => c.symbol === "VTI")).toMatchObject({ source: "reparto", change: "monto" });
    const otroMonto = plan([linea("VTI", "nucleo", 3900)], {}, { totalUsd: 6500 });
    expect(explainPlanChange(antes, otroMonto).find((c) => c.symbol === "VTI")).toMatchObject({ source: "monto" });
  });
  it("APH el 18/9: la línea sigue con el mismo monto pero la revisión encontró una objeción: el cambio se lista igual, como aviso", () => {
    // Desde el 18/9 una objeción no saca la línea: queda escrita al lado de COMPRAR. Si el dueño miró el plan a las 12:17
    // y la objeción llegó a las 12:19, "por qué cambió" es donde se entera, aunque el monto no se haya movido.
    const objecion = "la revisión antes de comprar encontró una objeción: el CEO y el CFO vendieron USD 172,3 M en acciones en 90 días";
    const antes = plan([{ ...linea("APH", "comprar", 4918), avisos: ["revisión antes de comprar pendiente"] }], { APH: entrada({ review: "pendiente" }) });
    const despues = plan([{ ...linea("APH", "comprar", 4918), avisos: [objecion] }], { APH: entrada({ review: "objecion" }) });
    const [c] = explainPlanChange(antes, despues);
    expect(c).toMatchObject({ symbol: "APH", change: "aviso", fromUsd: 4918, toUsd: 4918, source: "verificacion" });
    expect(c!.cause).toBe(objecion);
    // Un aviso que se va (revisada sin objeciones) también se dice; los mismos avisos, no.
    const limpia = plan([linea("APH", "comprar", 4918)], { APH: entrada({ review: "sin_objeciones" }) });
    expect(explainPlanChange(antes, limpia)[0]).toMatchObject({ change: "aviso", cause: "ya no lleva avisos: revisión antes de comprar pendiente" });
    expect(explainPlanChange(despues, despues)).toEqual([]);
  });
  it("sin plan anterior no hay cambios que explicar, y una línea igual no se lista", () => {
    const p = plan([linea("VTI", "nucleo", 100)], {});
    expect(explainPlanChange(null, p)).toEqual([]);
    expect(explainPlanChange(p, p)).toEqual([]);
  });
});
