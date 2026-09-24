import type { StepId } from "@thesis/pipeline";
import { runStep } from "./catchup.js";
import type { Config } from "./config.js";
import type { Container } from "./container.js";

/**
 * Qué pasos corre cada cron, en orden. Son los mismos pasos del catch-up, con sus mismas funciones
 * (`defaultRunners`): cada uno termina rearmando el plan y queda registrado en job_runs. Hasta el 15/9 el cron
 * tenía su propia copia de cada paso, sin `replan`, y con la máquina prendida a las 7:50 el plan quedaba el de
 * la noche anterior: seguía diciendo "comprar NVDA" con NVDA ya en OBSERVAR.
 */
export function cronPlan(cfg: Pick<Config, "dailyCron" | "carteraCron" | "radarScanCron" | "radarRefreshCron" | "radarPlanCron">): Array<{ expr: string; steps: StepId[] }> {
  return [
    { expr: cfg.dailyCron, steps: ["tesis"] },
    { expr: cfg.carteraCron, steps: ["cartera"] },
    { expr: cfg.radarScanCron, steps: ["scan"] },
    { expr: cfg.radarRefreshCron, steps: ["radar", "argentina"] },
    { expr: cfg.radarPlanCron, steps: ["plan"] },
  ];
}

/** Programa los crons. `schedule` es `cron.schedule` en la app y un registro en los tests. */
export function scheduleJobs(c: Container, cfg: Parameters<typeof cronPlan>[0], schedule: (expr: string, fn: () => Promise<void>) => unknown): void {
  for (const job of cronPlan(cfg)) {
    schedule(job.expr, async () => {
      // `esperarTurno`: si otro paso se alargó, este espera en vez de perderse (24/9, ver catchup.ts).
      for (const id of job.steps) await runStep(c, id, { esperarTurno: true }).catch((e: unknown) => console.error(`[cron] ${id} falló`, e));
    });
  }
}
