import { describe, expect, it } from "vitest";
import type { ContributionPlan } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { asegurarControles, type Pedir } from "./controles.js";
import type { Container } from "./container.js";

const plan: ContributionPlan = { month: "2026-09", totalUsd: 40_000, lines: [{ symbol: "NVDA", kind: "comprar", amountUsd: 2684, rationale: "", close: 211, spyClose: null, alpha30dPct: null, alpha90dPct: null, stop: 199.06 }], notes: [], leftOut: [] };
const fila = (symbol: string, verdict: string) => ({ symbol, verdict, close: 211, stop: 199.06, flags: [], candidateDate: "2026-09-15", kind: "stock" });

/** Lo que devolverían las pantallas: `radar` es la tabla del Radar; lo demás, vacío. */
function pantallas(radar: unknown[]): Pedir {
  return async <T,>(ruta: string): Promise<T> => {
    if (ruta.startsWith("/radar/candidates")) return radar as T;
    if (ruta.startsWith("/radar/plan")) return null as T; // se lee de la base
    if (ruta.startsWith("/radar/top")) return { picks: [] } as T;
    if (ruta.startsWith("/novedades")) return null as T;
    return [] as T;
  };
}

async function montar() {
  const store = new MemoryStore();
  await store.savePlan(plan);
  const c = { store, radarDeps: { store } } as unknown as Container;
  return { store, c };
}

describe("controles automáticos (15/9)", () => {
  it("NVDA el 15/9: el plan la compraba con el Radar ya en OBSERVAR; el control lo encuentra solo y queda guardado en ese plan", async () => {
    const { store, c } = await montar();
    const r = await asegurarControles(c, pantallas([fila("NVDA", "OBSERVAR")]));
    expect(r?.graves).toBeGreaterThan(0);
    expect(r?.findings.some((f) => f.check === "plan_contra_radar" && f.symbol === "NVDA")).toBe(true);
    const guardado = (await store.latestPlan())!;
    expect(guardado.controles?.planBuiltAt).toBe(guardado.builtAt);
    expect(guardado.controles?.graves).toBe(r?.graves);
  });
  it("no los repite si ya corrieron sobre esta versión del plan, y sí cuando el plan se rearma", async () => {
    const { store, c } = await montar();
    let pedidos = 0;
    const contar: Pedir = async <T,>(ruta: string) => { pedidos++; return pantallas([fila("NVDA", "COMPRAR")])<T>(ruta); };
    await asegurarControles(c, contar);
    const primeros = pedidos;
    expect(primeros).toBeGreaterThan(0);
    await asegurarControles(c, contar);
    expect(pedidos).toBe(primeros);
    await new Promise((r) => setTimeout(r, 5));
    await store.savePlan(plan);
    expect((await store.latestPlan())?.controles).toBeNull();
    await asegurarControles(c, contar);
    expect(pedidos).toBeGreaterThan(primeros);
  });
  it("si una pantalla no responde, no es un verde: queda el error y el plan cuenta como no controlado", async () => {
    const { store, c } = await montar();
    const r = await asegurarControles(c, async () => { throw new Error("/radar/candidates respondió 500"); });
    expect(r?.error).toMatch(/500/);
    expect((await store.latestPlan())?.controles?.error).toMatch(/500/);
  });
});
