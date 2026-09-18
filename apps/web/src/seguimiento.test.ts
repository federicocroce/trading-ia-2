import { describe, expect, it } from "vitest";
import { crearSeguidor, sinFila } from "./seguimiento";

/**
 * Desde el 18/9 el alta a la lista de seguimiento responde enseguida y el análisis corre después: la pantalla tiene
 * que decir qué se está analizando y traer la fila sola cuando termina, sin que el dueño recargue.
 */
describe("sinFila: qué decir de lo que seguís y todavía no tiene fila", () => {
  it("separa lo que se está analizando ahora de lo que espera el próximo refresco", () => {
    const w = { items: [{ symbol: "APH" }, { symbol: "RNR" }, { symbol: "WTRG" }], rows: [{ symbol: "APH" }], refreshing: ["RNR"] };
    expect(sinFila(w)).toEqual({ analizando: ["RNR"], fallaron: [], esperan: ["WTRG"] });
  });

  it("lo que se vuelve a analizar y ya tiene fila no se anuncia: su fila sigue a la vista", () => {
    expect(sinFila({ items: [{ symbol: "APH" }], rows: [{ symbol: "APH" }], refreshing: ["APH"] })).toEqual({ analizando: [], fallaron: [], esperan: [] });
  });

  it("una API anterior al cambio no manda `refreshing`: nada se da por analizándose", () => {
    expect(sinFila({ items: [{ symbol: "RNR" }], rows: [] })).toEqual({ analizando: [], fallaron: [], esperan: ["RNR"] });
  });

  it("si el análisis falló, se dice de cuál y por qué, en vez de prometer el próximo refresco sin más", () => {
    const w = { items: [{ symbol: "RNR" }, { symbol: "WTRG" }], rows: [], refreshing: [], failed: [{ symbol: "RNR", error: "sin velas" }] };
    expect(sinFila(w)).toEqual({ analizando: [], fallaron: [{ symbol: "RNR", error: "sin velas" }], esperan: ["WTRG"] });
  });

  it("mientras se reintenta, manda el análisis en curso y no el error viejo", () => {
    const w = { items: [{ symbol: "RNR" }], rows: [], refreshing: ["RNR"], failed: [{ symbol: "RNR", error: "sin velas" }] };
    expect(sinFila(w)).toEqual({ analizando: ["RNR"], fallaron: [], esperan: [] });
  });
});

describe("crearSeguidor: vuelve a pedir la lista mientras haya algo analizándose", () => {
  const armar = (respuestas: Array<string[] | null>) => {
    const agenda: Array<() => void> = [];
    const st = { pedidos: 0, avisos: 0 };
    const seguir = crearSeguidor({
      pedir: async () => { st.pedidos++; const r = respuestas.shift(); return r === null || r === undefined ? null : { refreshing: r }; },
      despues: (fn) => { agenda.push(fn); },
      avisar: () => { st.avisos++; },
    });
    /** Deja pasar un intervalo: corre lo agendado y espera a que termine el pedido. */
    const pasar = async () => { agenda.splice(0).forEach((fn) => fn()); await new Promise((r) => setTimeout(r, 0)); };
    return { seguir, st, pasar, agenda };
  };

  it("sin nada analizándose no pide ni avisa", () => {
    const s = armar([]);
    s.seguir({ refreshing: [] });
    expect(s.agenda).toHaveLength(0);
    expect(s.st).toEqual({ pedidos: 0, avisos: 0 });
  });

  it("pide hasta que termina y avisa una sola vez", async () => {
    const s = armar([["RNR"], []]);
    s.seguir({ refreshing: ["RNR"] });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 1, avisos: 0 });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 2, avisos: 1 });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 2, avisos: 1 });
  });

  it("dos pantallas que lo llaman a la vez no duplican los pedidos", async () => {
    const s = armar([[]]);
    s.seguir({ refreshing: ["RNR"] });
    s.seguir({ refreshing: ["RNR"] });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 1, avisos: 1 });
  });

  it("si un pedido falla sigue intentando: la API puede estar ocupada", async () => {
    const s = armar([null, []]);
    s.seguir({ refreshing: ["RNR"] });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 1, avisos: 0 });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 2, avisos: 1 });
  });

  it("después de terminar, un alta nueva se vuelve a seguir", async () => {
    const s = armar([[], []]);
    s.seguir({ refreshing: ["RNR"] });
    await s.pasar();
    s.seguir({ refreshing: ["WTRG"] });
    await s.pasar();
    expect(s.st).toEqual({ pedidos: 2, avisos: 2 });
  });
});
