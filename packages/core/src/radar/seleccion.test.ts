import { describe, expect, it } from "vitest";
import { lugarParaNueva, seleccionarCandidatas } from "./seleccion.js";

const fila = (symbol: string, verdict: "COMPRAR" | "OBSERVAR") => ({ item: symbol, verdict });

/**
 * El corte de 40 era por PUNTAJE, no por comprable. El 16/9 eso daba un Radar con 30 filas en OBSERVAR y 10 en
 * COMPRAR, mientras 13 acciones que pasaban todos los filtros y quedaban en COMPRAR se caían del corte, con puestos
 * del 77 al 149: AES, GFR, DAVE, SPNT, BLX, HCI, ABX, ABUS, MCY, AVAH, DBRG, DAR y CGAU.
 *
 * El sesgo importaba más que el número: de las que no se veían, 8 eran seguros, 7 servicios financieros, 6 salud y
 * 4 bancos, o sea justo lo que no se mueve con Argentina ni con el petróleo.
 *
 * La regla sólo AGREGA: las primeras `top` por puntaje entran igual que antes, así que no se pierde ninguna fila
 * que ya estuviera. Lo que cambia es que una COMPRAR que quedaba afuera ahora entra, hasta el tope de filas.
 */
describe("seleccionarCandidatas", () => {
  it("las primeras `top` por puntaje entran, comprables o no: no se pierde nada de lo que ya había", () => {
    const evaluadas = [fila("A", "OBSERVAR"), fila("B", "OBSERVAR"), fila("C", "COMPRAR")];
    expect(seleccionarCandidatas(evaluadas, { top: 2, maxRows: 10 })).toEqual(["A", "B", "C"]);
  });

  it("una COMPRAR que quedaba afuera del corte ahora entra", () => {
    const evaluadas = [...Array.from({ length: 40 }, (_, i) => fila(`O${i}`, "OBSERVAR" as const)), fila("AES", "COMPRAR"), fila("HCI", "COMPRAR")];
    const sel = seleccionarCandidatas(evaluadas, { top: 40, maxRows: 80 });
    expect(sel).toHaveLength(42);
    expect(sel).toContain("AES");
    expect(sel).toContain("HCI");
  });

  it("una OBSERVAR que queda afuera del corte sigue afuera: el tope no se gasta en lo que no se compra", () => {
    const evaluadas = [...Array.from({ length: 40 }, (_, i) => fila(`O${i}`, "OBSERVAR" as const)), fila("TARDE", "OBSERVAR")];
    expect(seleccionarCandidatas(evaluadas, { top: 40, maxRows: 80 })).not.toContain("TARDE");
  });

  it("el tope de filas manda: cada fila nueva cuesta cuatro pedidos a Finnhub por corrida", () => {
    const evaluadas = [...Array.from({ length: 40 }, (_, i) => fila(`O${i}`, "OBSERVAR" as const)), ...Array.from({ length: 30 }, (_, i) => fila(`C${i}`, "COMPRAR" as const))];
    const sel = seleccionarCandidatas(evaluadas, { top: 40, maxRows: 50 });
    expect(sel).toHaveLength(50);
    // Las COMPRAR entran por puntaje, que es el orden en el que vienen.
    expect(sel.slice(40)).toEqual(["C0", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9"]);
  });

  it("el orden por puntaje se respeta: la lista sale como entró", () => {
    const evaluadas = [fila("A", "OBSERVAR"), fila("B", "COMPRAR"), fila("C", "OBSERVAR"), fila("D", "COMPRAR")];
    expect(seleccionarCandidatas(evaluadas, { top: 1, maxRows: 10 })).toEqual(["A", "B", "D"]);
  });

  it("sin tope declarado, el doble de `top`", () => {
    const evaluadas = Array.from({ length: 200 }, (_, i) => fila(`C${i}`, "COMPRAR" as const));
    expect(seleccionarCandidatas(evaluadas, { top: 40 })).toHaveLength(80);
  });
});

/**
 * 24/9: el Radar elegía sus filas una vez por semana (ranking del domingo). Entre el domingo 20/9 y el jueves 24/9 sus
 * COMPRAR bajaron de 52 a 31 sin que entrara ninguna, mientras 13 acciones de la preselección pasaban a COMPRAR con
 * estados de la SEC (GLXY cruzó su media de 200 a mitad de semana). Cada día, una COMPRAR nueva ocupa un lugar libre o
 * el de la OBSERVAR de peor puntaje que no esté entre las `top` por puntaje ni en cartera: es la misma regla del domingo
 * (las `top` entran igual; el resto del tope es para lo comprable), aplicada con los veredictos del día.
 */
describe("lugarParaNueva", () => {
  const act = (symbol: string, score: number, verdict: "COMPRAR" | "OBSERVAR") => ({ symbol, score, verdict });
  const p = { top: 2, maxRows: 4 };
  it("si hay lugar libre hasta el tope, entra sin sacar a nadie", () => {
    expect(lugarParaNueva([act("A", 3, "OBSERVAR"), act("B", 2, "OBSERVAR")], new Set(), p)).toEqual({ libre: true });
  });
  it("sin lugar, reemplaza a la OBSERVAR de peor puntaje fuera de las `top`", () => {
    const actuales = [act("A", 3, "OBSERVAR"), act("B", 2, "OBSERVAR"), act("C", 1.5, "OBSERVAR"), act("D", 1, "OBSERVAR")];
    expect(lugarParaNueva(actuales, new Set(), p)).toEqual({ libre: false, sale: "D" });
  });
  it("las `top` por puntaje no salen aunque estén en OBSERVAR", () => {
    const actuales = [act("A", 3, "OBSERVAR"), act("B", 2, "OBSERVAR"), act("C", 1.5, "COMPRAR"), act("D", 1, "COMPRAR")];
    expect(lugarParaNueva(actuales, new Set(), p)).toBeNull();
  });
  it("lo que está en cartera no sale", () => {
    const actuales = [act("A", 3, "OBSERVAR"), act("B", 2, "OBSERVAR"), act("C", 1.5, "OBSERVAR"), act("VIST", 1, "OBSERVAR")];
    expect(lugarParaNueva(actuales, new Set(["VIST"]), p)).toEqual({ libre: false, sale: "C" });
  });
  it("una COMPRAR no le cede el lugar a otra COMPRAR", () => {
    const actuales = [act("A", 3, "OBSERVAR"), act("B", 2, "OBSERVAR"), act("C", 1.5, "COMPRAR"), act("D", 1, "COMPRAR")];
    expect(lugarParaNueva(actuales, new Set(), { top: 2, maxRows: 4 })).toBeNull();
  });
});
