import { describe, expect, it } from "vitest";
import { clasificarHecho, type HechoExterno } from "@thesis/core";
import { MemoryStore } from "../src/index.js";

const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z" };
// La url usa el símbolo en MAYÚSCULAS (como lo deja `clasificarHecho` en el campo `symbol`): así "five" y "FIVE"
// apuntan al MISMO documento y el caso de abajo prueba de verdad el dedupe por símbolo+tipo+fecha+url.
const guia = (symbol: string, fecha: string): HechoExterno => clasificarHecho({ tipo: "guia", symbol, fecha, valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "10" }, fuente: { url: `https://www.sec.gov/${symbol.toUpperCase()}/${fecha}`, titulo: "8-K" } }, o);

describe("MemoryStore hechos", () => {
  it("guarda sin duplicar (símbolo+tipo+fecha+url), lista por símbolo y por tipo desde una fecha", async () => {
    const s = new MemoryStore();
    expect(await s.saveHechos([guia("five", "2026-09-02"), guia("FIVE", "2026-09-02"), guia("ARW", "2026-08-06"), guia("VIEJA", "2026-01-01")])).toBe(4);
    expect((await s.hechos("five", "2026-06-01")).map((h) => h.fecha)).toEqual(["2026-09-02"]);
    expect((await s.hechosPorTipo("guia", "2026-06-01")).map((h) => h.symbol).sort()).toEqual(["ARW", "FIVE"]);
    expect(await s.hechosPorTipo("oferta_de_compra", "2026-01-01")).toEqual([]);
  });
});
