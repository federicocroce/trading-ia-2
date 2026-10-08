import { describe, expect, it } from "vitest";
import { riesgoPaisFechas } from "./macroAr.js";

/*
 * 6/10/2026. El riesgo país se guardaba con la fecha de la CORRIDA, no con la del dato. La serie quedaba
 * corrida un día hábil entera: coincidía con el día hábil ANTERIOR de argentinadatos en 20 de 20 fechas
 * comparables. La pantalla lo empeoraba: mostraba "655 · +3,0% vs 2026-10-02" cuando 655 era del viernes
 * 2/10 y el 636 contra el que comparaba era del 1/10. Las DOS fechas estaban mal.
 */
describe("riesgoPaisFechas", () => {
  it("muestra la fecha del dato y compara contra la fecha del dato anterior, no contra las de las corridas", () => {
    const f = riesgoPaisFechas({ date: "2026-10-05", riesgoPaisDate: "2026-10-02" }, { date: "2026-10-02", riesgoPaisDate: "2026-10-01" });
    expect(f.delDato).toBe("2026-10-02");
    expect(f.contra).toBe("2026-10-01");
  });
  it("si el dato es del mismo día de la corrida no hace falta aclararlo", () => {
    const f = riesgoPaisFechas({ date: "2026-10-05", riesgoPaisDate: "2026-10-05" }, { date: "2026-10-02", riesgoPaisDate: "2026-10-01" });
    expect(f.delDato).toBeNull();
    expect(f.contra).toBe("2026-10-01");
  });
  it("en las filas viejas, sin fecha guardada, no afirma de cuándo es ni contra qué compara", () => {
    const f = riesgoPaisFechas({ date: "2026-09-30", riesgoPaisDate: null }, { date: "2026-09-29", riesgoPaisDate: null });
    expect(f.delDato).toBeNull();
    expect(f.contra).toBeNull();
  });
  it("no cae en la fecha de la corrida anterior cuando falta la del dato: esa era justo la mentira", () => {
    const f = riesgoPaisFechas({ date: "2026-10-06", riesgoPaisDate: "2026-10-05" }, { date: "2026-10-05", riesgoPaisDate: null });
    expect(f.delDato).toBe("2026-10-05");
    expect(f.contra).toBeNull();
  });
  it("sin fila anterior no hay con qué comparar", () => {
    expect(riesgoPaisFechas({ date: "2026-10-05", riesgoPaisDate: "2026-10-02" }, undefined).contra).toBeNull();
  });
});
