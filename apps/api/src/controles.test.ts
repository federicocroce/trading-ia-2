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
  /**
   * 17/9, día de ejecución. El cron corre `radar` (que rearma el plan y dispara los controles) y recién 20 segundos
   * después corre `argentina`, que reescribe las filas de los ADR argentinos. Los controles juzgaron el Radar a
   * medio actualizar y encontraron 14 graves —12 precios de filas del día anterior y 2 "precio_distinto" entre el
   * Radar y Cartera— sobre datos que a los 20 segundos ya estaban bien.
   *
   * Lo que lo volvió grave de verdad es que el resultado quedaba congelado: como los controles no se repiten
   * mientras el plan no se rearme, una ventana de veinte segundos frenó el plan todo el día.
   *
   * Regla: mientras los controles estén FRENANDO (graves o error), se vuelven a correr. Un verde sí se cachea,
   * porque no hay nada que se destrabe. Falla del lado seguro: un grave real se vuelve a encontrar cada vez.
   */
  it("un grave no se cachea: mientras frena, los controles se repiten y se destraban solos cuando el dato se arregla", async () => {
    const { store, c } = await montar();
    let verdict = "OBSERVAR";
    let pedidos = 0;
    const contar: Pedir = async <T,>(ruta: string) => { pedidos++; return pantallas([fila("NVDA", verdict)])<T>(ruta); };
    const primera = await asegurarControles(c, contar);
    expect(primera?.graves).toBeGreaterThan(0);
    const trasPrimera = pedidos;

    // Con el grave guardado, la siguiente llamada NO corta: vuelve a mirar.
    await asegurarControles(c, contar, { ahora: Date.now() + 6 * 60_000 });
    expect(pedidos).toBeGreaterThan(trasPrimera);

    // El dato se arregla (el paso de Argentina reescribió las filas) y el plan se destraba solo.
    verdict = "COMPRAR";
    const tercera = await asegurarControles(c, contar, { ahora: Date.now() + 12 * 60_000 });
    expect(tercera?.graves).toBe(0);
    expect((await store.latestPlan())?.controles?.graves).toBe(0);

    // Y un verde sí se cachea: no hay nada que destrabar.
    const trasVerde = pedidos;
    await asegurarControles(c, contar, { ahora: Date.now() + 30 * 60_000 });
    expect(pedidos).toBe(trasVerde);
  });

  it("mientras frena no se repite más seguido que el intervalo: no martilla la base", async () => {
    const { c } = await montar();
    let pedidos = 0;
    const contar: Pedir = async <T,>(ruta: string) => { pedidos++; return pantallas([fila("NVDA", "OBSERVAR")])<T>(ruta); };
    await asegurarControles(c, contar);
    const trasPrimera = pedidos;
    await asegurarControles(c, contar, { ahora: Date.now() + 30_000 });
    expect(pedidos).toBe(trasPrimera);
  });

  it("si una pantalla no responde, no es un verde: queda el error y el plan cuenta como no controlado", async () => {
    const { store, c } = await montar();
    const r = await asegurarControles(c, async () => { throw new Error("/radar/candidates respondió 500"); });
    expect(r?.error).toMatch(/500/);
    expect((await store.latestPlan())?.controles?.error).toMatch(/500/);
  });
});
