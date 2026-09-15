import { describe, expect, it } from "vitest";
import { CORE_EPS_BAND } from "../../../packages/core/src/radar/statements.js";
import { BANDA_EPS_NUCLEO, peNucleo } from "./verificacionTextos";

describe("peNucleo", () => {
  it("SNDK el 15/9: 1.518,66 / 10.881 de EPS núcleo daba \"P/E núcleo 0,1\" contra 22,3 de Finnhub; con 1.000.000 de acciones en el último trimestre, el núcleo no es creíble y no se muestra", () => {
    const r = peNucleo({ close: 1518.66, coreEps: 10881.2587, epsFuente: 72.8928 });
    expect(r.valor).toBeNull();
    expect(r.texto).toBe("—");
    expect(r.motivo).toContain("no es creíble");
  });
  it("dentro de la banda se calcula como siempre (APH: 77,52 / 4,27 contra 3,99 de Finnhub)", () => {
    const r = peNucleo({ close: 77.52, coreEps: 4.2738, epsFuente: 3.9946 });
    expect(r.valor).toBeCloseTo(18.14, 2);
    expect(r.texto).toBe("18.1");
    expect(r.motivo).toBeNull();
  });
  it("núcleo en pérdida o sin dato: guion, igual que antes; sin EPS de la fuente no hay contra qué medir", () => {
    expect(peNucleo({ close: 10, coreEps: -1, epsFuente: 2 }).texto).toBe("—");
    expect(peNucleo({ close: 10, coreEps: null, epsFuente: 2 }).texto).toBe("—");
    expect(peNucleo({ close: 10, coreEps: 2, epsFuente: null }).texto).toBe("5.0");
  });
  it("es la misma banda que usa el núcleo para no reemplazar el P/E de la fuente (`CORE_EPS_BAND`)", () => {
    expect(BANDA_EPS_NUCLEO).toEqual(CORE_EPS_BAND);
  });
});
