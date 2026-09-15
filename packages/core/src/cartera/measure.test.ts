import { describe, expect, it } from "vitest";
import { alphaPct, summarizeMeasurement, verdictHit } from "./index.js";

describe("alphaPct", () => {
  it("retorno del papel menos retorno de SPY, en %", () => {
    expect(alphaPct(100, 110, 100, 105)).toBeCloseTo(5, 6);
    expect(alphaPct(100, 95, 100, 100)).toBeCloseTo(-5, 6);
  });
});
describe("verdictHit", () => {
  it("VENDER acierta con alpha < 0; MANTENER/SUMAR con alpha > 0; REVISAR no se puntúa", () => {
    expect(verdictHit("VENDER", -3)).toBe(true);
    expect(verdictHit("VENDER", 2)).toBe(false);
    expect(verdictHit("MANTENER", 2)).toBe(true);
    expect(verdictHit("SUMAR", -1)).toBe(false);
    expect(verdictHit("REVISAR", 5)).toBeNull();
  });
});
describe("summarizeMeasurement", () => {
  it("agrega por verbo y horizonte; cuenta pendientes", () => {
    const s = summarizeMeasurement([
      { verb: "MANTENER", alpha7dPct: 2, alpha30dPct: null },
      { verb: "MANTENER", alpha7dPct: -4, alpha30dPct: 6 },
      { verb: "VENDER", alpha7dPct: -1, alpha30dPct: -2 },
      { verb: "REVISAR", alpha7dPct: 9, alpha30dPct: 9 },
      { verb: "SUMAR", alpha7dPct: null, alpha30dPct: null },
    ]);
    expect(s.byVerb.MANTENER.h7).toEqual({ n: 2, hitRate: 0.5, avgAlpha: -1 });
    expect(s.byVerb.MANTENER.h30).toEqual({ n: 1, hitRate: 1, avgAlpha: 6 });
    expect(s.byVerb.VENDER.h7).toEqual({ n: 1, hitRate: 1, avgAlpha: -1 });
    expect(s.byVerb.REVISAR.h7).toEqual({ n: 1, hitRate: null, avgAlpha: 9 });
    expect(s.byVerb.SUMAR.h7).toEqual({ n: 0, hitRate: null, avgAlpha: null });
    expect(s.pending).toBe(2);
  });

  /**
   * 15/9: la pantalla decía "72 veredictos, 72 pendientes de medir" y los 8 del 7/9 ya estaban medidos a 7 días. El
   * contador sumaba como pendiente toda fila a la que le faltara CUALQUIER horizonte, y a 30 días no le falta a
   * ninguna llegar todavía: no podía bajar de 72 hasta octubre. Ahora se cuenta por horizonte, separando lo que espera
   * a que pase el plazo (normal) de lo que ya venció sin medirse (eso sí es un problema).
   */
  it("15/9: cuenta por horizonte; a 7 días hay 8 medidos y el resto espera, no 72 pendientes", () => {
    const fechas = ["2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15"];
    const rows = fechas.flatMap((verdictDate) => Array.from({ length: 8 }, () => ({ verb: "MANTENER" as const, verdictDate, alpha7dPct: verdictDate === "2026-09-07" ? 1 : null, alpha30dPct: null })));
    const s = summarizeMeasurement(rows, "2026-09-15");
    // Los del 8/9 se miden con el cierre del 15/9, que a la mañana del 15 todavía no existe: esperan, no están vencidos.
    expect(s.estado.h7).toEqual({ medidas: 8, esperando: 64, vencidas: 0, primera: "2026-09-15" });
    expect(s.estado.h30).toEqual({ medidas: 0, esperando: 72, vencidas: 0, primera: "2026-10-07" });
  });

  it("vencida es la que ya tuvo su cierre y sigue sin medirse; un plazo que cae en fin de semana espera al lunes", () => {
    const fila = (verdictDate: string) => ({ verb: "MANTENER" as const, verdictDate, alpha7dPct: null, alpha30dPct: null });
    // 8/9 + 7 = 15/9 (martes): el 16/9 ya tendría que estar medida.
    expect(summarizeMeasurement([fila("2026-09-08")], "2026-09-16").estado.h7).toMatchObject({ vencidas: 1, esperando: 0 });
    // 12/9 + 7 = 19/9 (sábado): se mide con el cierre del lunes 21/9; el domingo 20 y el lunes 21 todavía espera.
    expect(summarizeMeasurement([fila("2026-09-12")], "2026-09-21").estado.h7).toMatchObject({ vencidas: 0, esperando: 1, primera: "2026-09-21" });
    expect(summarizeMeasurement([fila("2026-09-12")], "2026-09-22").estado.h7).toMatchObject({ vencidas: 1, esperando: 0 });
  });

  it("sin hoy o sin fecha de la fila no se inventa una deuda: todo cuenta como esperando", () => {
    const s = summarizeMeasurement([{ verb: "MANTENER", verdictDate: "2020-01-01", alpha7dPct: null, alpha30dPct: null }, { verb: "SUMAR", alpha7dPct: null, alpha30dPct: null }]);
    expect(s.estado.h7).toMatchObject({ vencidas: 0, esperando: 2 });
  });
});
