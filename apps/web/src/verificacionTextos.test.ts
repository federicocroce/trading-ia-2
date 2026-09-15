import { describe, expect, it } from "vitest";
import { CORE_EPS_BAND } from "../../../packages/core/src/radar/statements.js";
import { BANDA_EPS_NUCLEO, estadoVerificacion, fuentesTexto, peNucleo } from "./verificacionTextos";

/**
 * Sección "Verificación web" de la ficha, auditoría del 15/9:
 * - NBN y NVDA estaban APTAS con el cuestionario anterior (el plan ya no las acepta) y se veían en verde;
 * - APH tenía 0 fuentes guardadas y TSM 42, pero la pantalla mostraba hasta 8 enlaces sin decir cuántas había;
 * - SNDK y BLBD quedan COMPRAR por reglas y la verificación está pendiente, y el texto decía "se verifica solo lo que
 *   queda COMPRAR por reglas", que para ellas es falso.
 */
describe("estadoVerificacion", () => {
  it("NBN el 15/9: APTA con el cuestionario anterior no se ve en verde y dice que se repite antes de comprar", () => {
    const e = estadoVerificacion({ v: { verdict: "apto" }, current: false });
    expect(e.kind).toBe("anterior");
    expect(e.chip).toEqual({ label: "APTA", className: "verb CANDIDATA" });
    expect(e.nota).toBe("cuestionario anterior: se repite antes de comprar");
  });
  it("una advertencia no se apaga por ser del cuestionario anterior; la vigente se ve como siempre (TSM con reservas)", () => {
    expect(estadoVerificacion({ v: { verdict: "evitar" }, current: false }).chip?.className).toBe("bad");
    const tsm = estadoVerificacion({ v: { verdict: "con_reservas" }, current: true });
    expect(tsm).toMatchObject({ kind: "vigente", chip: { label: "CON RESERVAS", className: "verb OBSERVAR" }, nota: null });
    expect(estadoVerificacion({ v: { verdict: "apto" }, current: true }).chip?.className).toBe("verb COMPRAR");
  });
  it("SNDK y BLBD: COMPRAR por reglas sin verificación es \"pendiente\", no \"se verifica solo lo que queda COMPRAR\"", () => {
    const e = estadoVerificacion({ v: null, current: null, fila: { verdict: "COMPRAR", flags: ["consenso_compra", "verificacion_pendiente"] } });
    expect(e.kind).toBe("pendiente");
    expect(e.nota).toBe("verificación web pendiente: queda COMPRAR por reglas y el modelo todavía no la verificó. El plan no la compra hasta que se verifique.");
  });
  it("sin fila COMPRAR (una posición fuera del Radar, u OBSERVAR), la regla general sí es cierta", () => {
    expect(estadoVerificacion({ v: null, current: null, fila: null }).nota).toBe("sin verificación web: se verifica solo lo que queda COMPRAR por reglas, y se repite a los 7 días");
    expect(estadoVerificacion({ v: null, current: null, fila: { verdict: "OBSERVAR", flags: ["bajo_stop"] } }).kind).toBe("sin");
  });
});

describe("fuentesTexto", () => {
  it("APH el 15/9: cero fuentes se dice, no se esconde", () => {
    expect(fuentesTexto(0)).toBe("sin fuentes: el modelo no devolvió enlaces, así que este dictamen no se puede comprobar");
  });
  it("TSM el 15/9: 42 fuentes y se muestran 8 → lo dice", () => {
    expect(fuentesTexto(42, 8)).toBe("Fuentes (8 de 42):");
    expect(fuentesTexto(5, 8)).toBe("Fuentes (5):");
  });
});

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
