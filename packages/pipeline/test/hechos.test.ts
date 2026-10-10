import { describe, expect, it } from "vitest";
import { clasificarHecho, type HechoExterno } from "@thesis/core";
import { importarHechos, MemoryStore } from "../src/index.js";

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

describe("importarHechos", () => {
  it("valida, marca verificado sólo con fuente primaria, rechaza con motivo y no frena por uno malo", async () => {
    const s = new MemoryStore();
    const r = await importarHechos(s, { hechos: [
      { tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/Archives/x", titulo: "8-K" } },
      { tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://finance.yahoo.com/nota", titulo: "nota" } },
      { tipo: "guia", symbol: "MAL", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "1" }, fuente: { url: "", titulo: "" } },
    ] }, { hostsPrimarios: ["sec.gov"], origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" });
    expect(r).toMatchObject({ guardados: 2, verificados: 1, noVerificados: 1 });
    expect(r.rechazados).toHaveLength(1);
    expect(r.rechazados[0]).toMatchObject({ indice: 2 });
    expect((await s.hechos("PGR", "2026-01-01"))[0]).toMatchObject({ estado: "no_verificado", origen: "agente" });
  });
  it("acepta un arreglo pelado y rechaza lo que no es ni arreglo ni { hechos }", async () => {
    const s = new MemoryStore();
    expect((await importarHechos(s, [], { hostsPrimarios: [], origen: "manual", detectadoAt: "2026-09-17T00:00:00.000Z" })).guardados).toBe(0);
    const r = await importarHechos(s, { otra: 1 }, { hostsPrimarios: [], origen: "manual", detectadoAt: "2026-09-17T00:00:00.000Z" });
    expect(r.rechazados[0]?.motivo).toMatch(/hechos/);
  });
});

describe("hechos por eslabón (10/10)", () => {
  const cadenas = { revisado: "2026-10-10", cadenas: [{ id: "ia", nombre: "IA", eslabones: [{ id: "ia.memoria", nombre: "memoria", simbolos: ["MU", "SNDK", "WDC"] }] }] };
  const porEslabon = (eslabon: string) => ({ tipo: "sector", eslabon, fecha: "2026-09-30", fuente: { url: "https://www.sec.gov/mu-8k", titulo: "Micron, 8-K" }, valor: { ambito: "memoria", titulo: "Micron factura 133.190 M", detalle: "dato del mayor fabricante", sesgo: "a_favor" } });

  it("un hecho escrito sobre un eslabón se expande a una fila por acción, con el eslabón anotado", async () => {
    const s = new MemoryStore();
    const r = await importarHechos(s, { hechos: [porEslabon("ia.memoria")] }, { ...o, cadenas });
    expect(r).toMatchObject({ guardados: 3, verificados: 3, rechazados: [] });
    const sndk = (await s.hechos("SNDK", "2026-01-01"))[0]!;
    expect(sndk).toMatchObject({ tipo: "sector", estado: "verificado" });
    expect((sndk.valor as { eslabon?: string }).eslabon).toBe("ia.memoria");
  });

  it("un eslabón que no existe se rechaza con su motivo y el índice del archivo, sin frenar al resto", async () => {
    const s = new MemoryStore();
    const r = await importarHechos(s, { hechos: [porEslabon("ia.inventado"), porEslabon("ia.memoria")] }, { ...o, cadenas });
    expect(r.guardados).toBe(3);
    expect(r.rechazados).toEqual([{ indice: 0, motivo: 'el eslabón "ia.inventado" no existe en config/cadenas.json' }]);
  });

  it("sin el mapa cargado, el hecho por eslabón se rechaza: nunca se adivina a quién le toca", async () => {
    const r = await importarHechos(new MemoryStore(), [porEslabon("ia.memoria")], o);
    expect(r.guardados).toBe(0);
    expect(r.rechazados[0]!.motivo).toMatch(/sin config\/cadenas\.json/);
  });
});
