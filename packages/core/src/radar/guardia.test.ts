import { describe, expect, it } from "vitest";
import { revisarCorrida, type GuardiaInput } from "./guardia.js";

/**
 * La guardia contesta una sola pregunta: ¿la corrida de esta mañana salió bien? Existe porque el 23/9/2026 la
 * app armó un plan con cierres de dos días atrás, los controles dieron 0 graves y nadie se enteró hasta que el
 * dueño preguntó. Desde que hay un control que lo detecta, falta que alguien lo MIRE: eso es esto.
 *
 * No inventa reglas: hace ejecutable lo que ya dice el tipo `ContributionPlan` ("con un grave, o sin controles
 * sobre este plan, no se ejecuta"). Las revisiones pendientes NO son motivo de aviso: el dueño decidió el 18/9
 * que la IA avise en vez de bloquear.
 */
const base = (over: Partial<GuardiaInput> = {}): GuardiaInput => ({
  today: "2026-09-23",
  plan: { month: "2026-09", totalUsd: 40_000, lines: [], notes: [], builtAt: "2026-09-23T11:36:00.000Z",
    controles: { at: "2026-09-23T11:36:05.000Z", planBuiltAt: "2026-09-23T11:36:00.000Z", graves: 0, avisos: 2, findings: [] } },
  jobRuns: { radar: { lastDate: "2026-09-23", ranAt: "2026-09-23T10:53:00Z", lastError: null } },
  esperados: ["radar"],
  ...over,
});

describe("revisarCorrida", () => {
  it("una mañana sana no avisa nada", () => {
    expect(revisarCorrida(base())).toEqual([]);
  });

  it("avisa si un paso que tenía que correr hoy no corrió (la máquina durmió)", () => {
    const a = revisarCorrida(base({ jobRuns: { radar: { lastDate: "2026-09-22", ranAt: "2026-09-22T10:53:00Z", lastError: null } } }));
    expect(a.map((x) => x.motivo)).toEqual(["paso_sin_correr"]);
    expect(a[0]!.detalle).toContain("radar");
  });

  it("avisa si un paso registró un error", () => {
    const a = revisarCorrida(base({ jobRuns: { radar: { lastDate: "2026-09-23", ranAt: "2026-09-23T10:53:00Z", lastError: "sin velas para APH" } } }));
    expect(a.map((x) => x.motivo)).toEqual(["paso_con_error"]);
  });

  it("avisa si el plan no es de hoy", () => {
    const p = { ...base().plan!, builtAt: "2026-09-22T11:36:00.000Z" };
    expect(revisarCorrida(base({ plan: { ...p, controles: { ...p.controles!, planBuiltAt: p.builtAt! } } })).map((x) => x.motivo)).toEqual(["plan_viejo"]);
  });

  it("avisa si hay graves, y dice cuáles", () => {
    const p = base().plan!;
    const a = revisarCorrida(base({ plan: { ...p, controles: { ...p.controles!, graves: 1, findings: [{ check: "velas_desfasadas", symbol: "APH", severity: "grave", detail: "su última vela es del 2026-09-21" }] } } }));
    expect(a.map((x) => x.motivo)).toEqual(["graves"]);
    expect(a[0]!.detalle).toContain("velas_desfasadas");
    expect(a[0]!.detalle).toContain("APH");
  });

  it("avisa si los controles son de un plan anterior: no controlan al que estás mirando", () => {
    const p = base().plan!;
    expect(revisarCorrida(base({ plan: { ...p, controles: { ...p.controles!, planBuiltAt: "2026-09-23T09:00:00.000Z" } } })).map((x) => x.motivo)).toEqual(["sin_controles"]);
  });

  it("avisa si no hay plan", () => {
    expect(revisarCorrida(base({ plan: null })).map((x) => x.motivo)).toEqual(["sin_plan"]);
  });

  it("una revisión antes de comprar pendiente NO es motivo de aviso (la IA avisa, no bloquea)", () => {
    expect(revisarCorrida(base({ plan: { ...base().plan!, reviewsPending: ["TAL"] } }))).toEqual([]);
  });
});
