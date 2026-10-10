import { describe, expect, it } from "vitest";
import { MemoryStore } from "@thesis/pipeline";
import { cronPlan, scheduleJobs } from "./jobs.js";
import { runStep } from "./catchup.js";
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
    // Todos los crons menos el de las tesis, apagado el 10/10.
    expect([...programados.keys()].sort()).toEqual(Object.values({ ...cfg, dailyCron: undefined }).filter(Boolean).sort());
    await programados.get(cfg.radarRefreshCron)!();
    expect(corridos).toEqual(["radar", "argentina"]);
    const jobs = await store.jobRuns();
    expect(jobs["radar"]?.detail).toBe("radar ok");
    expect(jobs["argentina"]?.detail).toBe("argentina ok");
  });
  it("cada paso que cambia lo que el plan compra tiene su cron", () => {
    const pasos = cronPlan(cfg).flatMap((j) => j.steps);
    for (const id of ["scan", "cartera", "radar", "argentina", "plan"] as const) expect(pasos).toContain(id);
    // Las tesis no: apagadas el 10/10 (el mayor consumidor de modelo, y nada usaba su salida).
    expect(pasos).not.toContain("tesis");
  });
});

/**
 * 24/9/2026: el paso `radar` no corrió en toda la mañana y nadie se enteró hasta que el control nuevo
 * (`velas_desfasadas`) tiró 46 graves. Causa: `cartera` (07:45) tardó más de cinco minutos porque Gemini
 * devolvía 503, el cron de `radar` (07:50) se disparó con el candado de catch-up puesto y `runStep` devolvía
 * el resultado anterior EN SILENCIO, sin correr nada y sin dejar registro. Los crons de la mañana están a
 * cinco minutos uno de otro, así que no es un caso raro: pasa cada vez que un paso se alarga.
 */
describe("dos crons que se pisan", () => {
  it("el segundo espera su turno en vez de perderse", async () => {
    const store = new MemoryStore();
    const corridos: string[] = [];
    let soltar: (() => void) | null = null;
    const lento = new Promise<void>((r) => { soltar = r; });
    const runners = {
      scan: async () => "scan ok",
      cartera: async () => { corridos.push("cartera"); await lento; return "cartera ok"; },
      radar: async () => { corridos.push("radar"); return "radar ok"; },
      argentina: async () => { corridos.push("argentina"); return "argentina ok"; },
      plan: async () => "plan ok",
      tesis: async () => "tesis ok",
    } satisfies Runners;
    const c = { store, catchupRunners: runners } as unknown as Container;
    const programados = new Map<string, () => Promise<void>>();
    scheduleJobs(c, cfg, (expr, fn) => { programados.set(expr, fn); });

    const cartera = programados.get(cfg.carteraCron)!();
    await new Promise((r) => setTimeout(r, 0));
    expect(corridos).toEqual(["cartera"]); // cartera arrancó y sigue

    const radar = programados.get(cfg.radarRefreshCron)!(); // se dispara con el candado puesto
    await new Promise((r) => setTimeout(r, 0));
    expect(corridos).toEqual(["cartera"]); // todavía no: espera, no se pierde

    soltar!();
    await Promise.all([cartera, radar]);
    expect(corridos).toEqual(["cartera", "radar", "argentina"]);
    expect((await store.jobRuns())["radar"]?.detail).toBe("radar ok");
  });
});

/**
 * 1/10/2026: la Mac durmió sobre los tres crons de la mañana (tesis 07:30, cartera 07:45, radar 07:50) y el
 * chequeo de catch-up disparó a las 08:02, en pleno DarkWake de 45 segundos, con la red todavía abajo. Cada
 * pedido saliente falló (`TypeError: fetch failed`), pero ningún paso tiró excepción —el adaptador se traga el
 * error, cae al respaldo y el respaldo también falla—, así que `radar` volvió con "0 candidatos refrescados,
 * seguimiento 0/20" y se registró en job_runs con la fecha de hoy.
 *
 * Para el catch-up el día ya estaba cubierto: no reintentó nunca. El Radar se quedó con velas del 29/9 y el
 * plan de la mañana salió de datos viejos. Lo agarró la guardia de las 09:00 con 51 graves, pero la guardia
 * avisa, no arregla: hubo que rehacer la corrida a mano a las 11:12.
 *
 * La regla: un paso que intentó trabajo y no trajo nada no es una corrida, es una falla. `markJobError` ya
 * tiene la semántica exacta —deja la última corrida buena intacta y el paso sigue pendiente—, así que el
 * siguiente tick lo reintenta solo.
 */
describe("una corrida que volvió vacía", () => {
  const vacio = { scan: async () => "scan ok", cartera: async () => "cartera ok", radar: async () => "radar ok", argentina: async () => "argentina ok", plan: async () => "plan ok", tesis: async () => "tesis ok" } satisfies Runners;

  it("no se registra como hecha: el paso sigue pendiente y el catch-up lo reintenta", async () => {
    const store = new MemoryStore();
    await store.markJobRun("radar", "2026-09-30", "112 candidatos refrescados");
    const runners = { ...vacio, radar: async () => ({ detail: "0 candidatos refrescados, seguimiento 0/20", vacia: "ningún candidato refrescado: todos los pedidos fallaron" }) } satisfies Runners;
    const c = { store, catchupRunners: runners } as unknown as Container;

    const r = await runStep(c, "radar", { now: new Date("2026-10-01T11:02:00-03:00") });

    expect(r.ran[0]).toMatchObject({ id: "radar", ok: false, detail: "0 candidatos refrescados, seguimiento 0/20" });
    const job = (await store.jobRuns())["radar"];
    expect(job?.lastDate).toBe("2026-09-30"); // la última corrida buena queda intacta, no la pisa el 1/10
    expect(job?.lastError).toBe("ningún candidato refrescado: todos los pedidos fallaron");
  });

  it("un día sin novedades sí se registra: 0 propuestas no es una corrida vacía", async () => {
    // `tesis: 0 propuestas, 0 rechazadas, 0 errores` es lo normal cuando no hubo eventos nuevos. Si la regla
    // mirara el cero y no el fracaso, bloquearía días sanos y el catch-up reintentaría para siempre.
    const store = new MemoryStore();
    const c = { store, catchupRunners: { ...vacio, tesis: async () => "0 propuestas, 0 rechazadas, 0 errores" } } as unknown as Container;

    const r = await runStep(c, "tesis", { now: new Date("2026-10-01T11:02:00-03:00") });

    expect(r.ran[0]).toMatchObject({ id: "tesis", ok: true });
    expect((await store.jobRuns())["tesis"]?.lastDate).toBe("2026-10-01");
  });
});
