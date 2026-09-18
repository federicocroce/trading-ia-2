import { describe, expect, it } from "vitest";
import type { Container } from "./container.js";
import { enTurno, seguimientoQuieto } from "./seguimiento.js";

/**
 * El turno del refresco de seguimiento (18/9): el alta, el refresco a mano, la corrida programada y una verificación
 * que llegó refrescan la misma lista. El 18/9 hubo tres refrescos completos a la vez. Todos pasan por `enTurno`.
 */
describe("enTurno", () => {
  const c = () => ({}) as unknown as Container;
  const freno = () => { let soltar = () => {}; const espera = new Promise<void>((r) => (soltar = r)); return { espera, soltar }; };

  it("el segundo no empieza hasta que termina el primero", async () => {
    const cont = c();
    const f = freno();
    const orden: string[] = [];
    const uno = enTurno(cont, async () => { orden.push("uno empieza"); await f.espera; orden.push("uno termina"); return 1; });
    const dos = enTurno(cont, async () => { orden.push("dos empieza"); return 2; });
    await new Promise((r) => setTimeout(r, 10));
    expect(orden).toEqual(["uno empieza"]);
    f.soltar();
    expect(await Promise.all([uno, dos])).toEqual([1, 2]);
    expect(orden).toEqual(["uno empieza", "uno termina", "dos empieza"]);
  });

  it("si el primero falla, el error es de quien lo pidió y el turno sigue", async () => {
    const cont = c();
    const uno = enTurno(cont, async () => { throw new Error("se cayó la base"); });
    const dos = enTurno(cont, async () => "sigue");
    await expect(uno).rejects.toThrow("se cayó la base");
    expect(await dos).toBe("sigue");
    await seguimientoQuieto(cont);
  });
});
