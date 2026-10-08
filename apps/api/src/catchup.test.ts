import { describe, expect, it } from "vitest";
import { barridoAReanudar } from "./catchup.js";

/*
 * 5/10/2026: el barrido del domingo 4/10 quedó con 1.375 símbolos sin procesar y el lunes no se reanudó. La condición
 * era `scanDate >= today`, y 2026-10-04 no es >= 2026-10-05, así que en vez de seguir donde iba abría un barrido nuevo
 * desde cero — y volvía a pedir las ~2.800 fundamentales que son justo lo que no termina a tiempo.
 */
describe("qué barrido corresponde correr", () => {
  it("reanuda el barrido pendiente aunque sea de otro día (el caso del 4/10 visto el 5/10)", () => {
    expect(barridoAReanudar("2026-10-04", 1375, "2026-10-05")).toEqual({ scanDate: "2026-10-04", reanuda: true });
  });
  it("sin pendientes, abre el barrido de hoy", () => {
    expect(barridoAReanudar("2026-10-04", 0, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: false });
  });
  it("el mismo día con pendientes también reanuda (lo que ya hacía)", () => {
    expect(barridoAReanudar("2026-10-05", 300, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: true });
  });
  it("sin ningún barrido previo, abre el de hoy", () => {
    expect(barridoAReanudar(null, 0, "2026-10-05")).toEqual({ scanDate: "2026-10-05", reanuda: false });
  });
});
