import { describe, expect, it } from "vitest";
import { importarVeredictos, MemoryStore } from "../src/index.js";

describe("importarVeredictos (10/10)", () => {
  it("guarda lo válido, rechaza con motivo un \"no\" sin criterio, y no frena al resto", async () => {
    const s = new MemoryStore();
    const r = await importarVeredictos(s, { veredictos: [
      { symbol: "tsem", fecha: "2026-10-10", veredicto: "no", criterio: "valuacion_extrema_con_insiders", motivo: "P/E 94 y 38 ventas de insiders", fuente: null },
      { symbol: "AMAT", fecha: "2026-10-10", veredicto: "si", criterio: null, motivo: "ningún criterio aplica", fuente: null },
      { symbol: "LGND", fecha: "2026-10-10", veredicto: "no", criterio: null, motivo: "no me gusta", fuente: null },
    ] }, { version: "analista-1" });
    expect(r).toMatchObject({ guardados: 2, si: 1, no: 1 });
    expect(r.rechazados).toHaveLength(1);
    expect(r.rechazados[0]!.indice).toBe(2);
    expect((await s.veredictosAnalista("2026-10-01")).map((v) => v.symbol).sort()).toEqual(["AMAT", "TSEM"]);
  });
});
