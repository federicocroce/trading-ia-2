import { describe, expect, it } from "vitest";
import { MemoryStore } from "@thesis/pipeline";
import { cronPlan, scheduleJobs } from "./jobs.js";
import type { Container } from "./container.js";
import type { Runners } from "./catchup.js";

const cfg = { dailyCron: "30 7 * * 1-5", carteraCron: "45 7 * * 1-5", radarScanCron: "0 20 * * 0", radarRefreshCron: "50 7 * * 1-5", radarPlanCron: "0 8 1 * *" };

describe("crons", () => {
  it("15/9: el cron del Radar corre los mismos pasos que el catch-up (que rearman el plan), en orden, y los registra", async () => {
    // Antes el cron tenía su propia copia del refresco, sin `replan`: con la máquina prendida a las 7:50 el plan
    // quedaba el de la noche anterior y seguía diciendo "comprar NVDA" con NVDA ya en OBSERVAR.
    const store = new MemoryStore();
    const corridos: string[] = [];
    const runner = (id: string) => async () => { corridos.push(id); return `${id} ok`; };
    const runners = { scan: runner("scan"), cartera: runner("cartera"), radar: runner("radar"), argentina: runner("argentina"), plan: runner("plan"), tesis: runner("tesis") } satisfies Runners;
    const c = { store, catchupRunners: runners } as unknown as Container;
    const programados = new Map<string, () => Promise<void>>();
    scheduleJobs(c, cfg, (expr, fn) => { programados.set(expr, fn); });
    expect([...programados.keys()].sort()).toEqual(Object.values(cfg).sort());
    await programados.get(cfg.radarRefreshCron)!();
    expect(corridos).toEqual(["radar", "argentina"]);
    const jobs = await store.jobRuns();
    expect(jobs["radar"]?.detail).toBe("radar ok");
    expect(jobs["argentina"]?.detail).toBe("argentina ok");
  });
  it("cada paso que cambia lo que el plan compra tiene su cron", () => {
    const pasos = cronPlan(cfg).flatMap((j) => j.steps);
    for (const id of ["scan", "cartera", "radar", "argentina", "plan", "tesis"] as const) expect(pasos).toContain(id);
  });
});
