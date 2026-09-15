import { describe, expect, it } from "vitest";
import type { ContributionPlan } from "./api";
import { chipDeCabecera } from "./cabecera";
import { instruccionCartera, instruccionRadar, planStatusFor } from "./instruccion";

/**
 * C1, auditoría del 15/9: la cabecera de la ficha mostraba stop, objetivo y relación sin decir qué hacer; la instrucción
 * aparecía más abajo. Y VTI tenía "NUCLEO" escrito a mano, que no podía decir ESPERAR cuando los controles frenan el
 * plan. La cabecera lleva la misma etiqueta que el Radar y Cartera, con la misma función.
 */
const plan: ContributionPlan = {
  month: "2026-09", totalUsd: 40_000, notes: ["No se sumó TSM: el ETF de su tema (QQQ) está en OBSERVAR: bajo_stop."], builtAt: "2026-09-15T18:56:51.462Z",
  lines: [{ symbol: "VTI", kind: "nucleo", amountUsd: 24_000, rationale: "núcleo", close: 374.68, alpha30dPct: null, alpha90dPct: null }],
  leftOut: [{ symbol: "SNDK", reason: "1° por convicción: verificación web pendiente: no entra hasta que se verifique" }],
  controles: { at: "2026-09-15T18:56:51.469Z", planBuiltAt: "2026-09-15T18:56:51.462Z", graves: 0, avisos: 2, findings: [] },
};
const frenado: ContributionPlan = { ...plan, controles: { ...plan.controles!, graves: 1, findings: [{ check: "x", symbol: "NVDA", severity: "grave", detail: "el plan compra algo en OBSERVAR" }] } };

/** La etiqueta final, igual que la dibujan `RadarVerdict` y `CarteraVerdict`. */
const etiqueta = (c: ReturnType<typeof chipDeCabecera>, symbol: string, p: ContributionPlan | null) => {
  if (!c) return null;
  if (c.fuente === "Cartera") return instruccionCartera(c.verb, planStatusFor(symbol, p));
  return instruccionRadar(c.verdict, c.conPlan ? planStatusFor(symbol, p) : null, c.context);
};

describe("chipDeCabecera", () => {
  it("VTI: el núcleo sale de la misma función que el Radar (NÚCLEO con su monto) y dice ESPERAR si los controles frenan el plan", () => {
    const vti = chipDeCabecera({ verdict: null, candidate: { kind: "etf", verdict: "NUCLEO" } });
    expect(vti).toEqual({ fuente: "Radar", verdict: "NUCLEO", conPlan: true });
    expect(etiqueta(vti, "VTI", plan)).toMatchObject({ label: "NÚCLEO", detail: "USD 24.000 en el plan de hoy" });
    expect(etiqueta(vti, "VTI", frenado)?.label).toBe("ESPERAR");
  });
  it("TSM, con posición: manda el veredicto de Cartera pasado por el plan (SUMAR que el plan no suma → MANTENER)", () => {
    const tsm = chipDeCabecera({ verdict: { verb: "SUMAR" }, candidate: { kind: "stock", verdict: "COMPRAR" } });
    expect(tsm).toEqual({ fuente: "Cartera", verb: "SUMAR" });
    expect(etiqueta(tsm, "TSM", plan)).toMatchObject({ label: "MANTENER", detail: "no se suma hoy: el ETF de su tema (QQQ) está en OBSERVAR: bajo_stop" });
  });
  it("SNDK: COMPRAR por reglas que el plan no compra es CANDIDATA con el motivo; NVDA en OBSERVAR es OBSERVAR", () => {
    expect(etiqueta(chipDeCabecera({ verdict: null, candidate: { kind: "stock", verdict: "COMPRAR" } }), "SNDK", plan)).toMatchObject({ label: "CANDIDATA", detail: "no se compra: verificación web pendiente: no entra hasta que se verifique" });
    expect(etiqueta(chipDeCabecera({ verdict: null, candidate: { kind: "stock", verdict: "OBSERVAR" } }), "NVDA", plan)?.label).toBe("OBSERVAR");
  });
  it("Argentina y ADR, igual que sus tarjetas: el plan en dólares no compra en pesos; un CEDEAR no lleva veredicto", () => {
    const ar = chipDeCabecera({ verdict: null, candidate: { kind: "ar", verdict: "COMPRAR" } });
    expect(ar).toEqual({ fuente: "Radar", verdict: "COMPRAR", conPlan: false, context: "argentina" });
    expect(etiqueta(ar, "GGAL.BA", plan)?.label).toBe("CANDIDATA");
    expect(chipDeCabecera({ verdict: null, candidate: { kind: "adr", verdict: "OBSERVAR" } })).toEqual({ fuente: "Radar", verdict: "OBSERVAR", conPlan: false, context: "argentina" });
    expect(chipDeCabecera({ verdict: null, candidate: { kind: "cedear", verdict: "OBSERVAR" } })).toBeNull();
    expect(chipDeCabecera({ verdict: null, candidate: null })).toBeNull();
  });
});
