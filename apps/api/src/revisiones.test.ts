import { describe, expect, it } from "vitest";
import type { ContributionPlan } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { asegurarRevisiones } from "./revisiones.js";
import type { Container } from "./container.js";

const plan: ContributionPlan = { month: "2026-09", totalUsd: 40_000, lines: [], notes: [], leftOut: [], reviewsPending: ["APH"] };
const HOY = "2026-09-15";

function montar(review: () => Promise<{ verdict: "sin_objeciones" | "objecion" | "no_pude_verificar"; reason: string; sources: never[]; researchText: string; model: string }>) {
  const store = new MemoryStore();
  let llamadas = 0;
  const reviewer = { promptVersion: "r-test", review: async () => { llamadas++; return review(); } };
  const c = { store, radarDeps: { store, reviewer } } as unknown as Container;
  let rearmados = 0;
  const rearmar = async () => { rearmados++; };
  return { store, c, rearmar, llamadas: () => llamadas, rearmados: () => rearmados };
}

describe("revisiones pendientes (15/9)", () => {
  it("revisa lo pendiente del plan, lo guarda y rearma el plan", async () => {
    const m = montar(async () => ({ verdict: "sin_objeciones", reason: "nada material", sources: [], researchText: "REVISIÓN: SIN OBJECIONES — nada material", model: "m" }));
    await m.store.savePlan(plan);
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar });
    expect(m.llamadas()).toBe(1);
    expect((await m.store.preTradeReviews(HOY)).map((r) => [r.symbol, r.verdict])).toEqual([["APH", "sin_objeciones"]]);
    expect(m.rearmados()).toBe(1);
  });
  it("si la búsqueda falla no reintenta enseguida; a la tercera falla queda 'no pude verificar' y el plan deja de esperar", async () => {
    const m = montar(async () => { throw new Error("gemini: 429 RESOURCE_EXHAUSTED"); });
    await m.store.savePlan(plan);
    let t = 0;
    const ahora = () => t;
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar, ahora });
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar, ahora });
    expect(m.llamadas()).toBe(1); // dentro de los 10 minutos no se repite
    t += 11 * 60_000;
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar, ahora });
    t += 11 * 60_000;
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar, ahora });
    expect(m.llamadas()).toBe(3);
    const [r] = await m.store.preTradeReviews(HOY);
    expect(r).toMatchObject({ symbol: "APH", verdict: "no_pude_verificar", promptVersion: "r-test" });
    expect(r!.reason).toMatch(/falló 3 veces.*429/);
    expect(m.rearmados()).toBe(1);
  });
  it("sin revisor o sin pendientes no hace nada", async () => {
    const m = montar(async () => { throw new Error("no debería llamarse"); });
    await m.store.savePlan({ ...plan, reviewsPending: [] });
    await asegurarRevisiones(m.c, { hoy: HOY, rearmar: m.rearmar });
    expect(m.llamadas()).toBe(0);
    expect(m.rearmados()).toBe(0);
  });
});

describe("con el agente de Claude (22/9)", () => {
  it("la vuelta no corre: si corriera, fallaría tres veces y guardaría 'no pude verificar' en cada línea", async () => {
    const store = new MemoryStore();
    await store.savePlan(plan);
    let llamadas = 0;
    const reviewer = { promptVersion: "agente-r1-x", porAgente: true, review: async () => { llamadas++; throw new Error("no"); } };
    for (let i = 0; i < 4; i++) await asegurarRevisiones({ store, radarDeps: { store, reviewer } } as unknown as Container, { hoy: HOY, ahora: () => i * 3_600_000, rearmar: async () => {} });
    expect(llamadas).toBe(0);
    expect(await store.preTradeReviews(HOY)).toEqual([]);
  });
});
