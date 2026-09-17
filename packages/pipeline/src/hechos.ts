import { HechoEntradaSchema, clasificarHecho, type HechoExterno } from "@thesis/core";
import type { RadarStore } from "./store.js";

/**
 * El importador de hechos externos (17/9). Único camino de escritura a `hechos_externos`: valida con el esquema,
 * decide `verificado` por el host de la fuente, y guarda. Lo que no valida se rechaza con su motivo y no frena al resto.
 * El agente que arma el JSON nunca toca la base: deja el archivo y esto lo lee.
 */
export interface ImportacionDeHechos {
  guardados: number;
  verificados: number;
  noVerificados: number;
  rechazados: Array<{ indice: number; motivo: string }>;
}

export async function importarHechos(store: Pick<RadarStore, "saveHechos">, input: unknown, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): Promise<ImportacionDeHechos> {
  const lista = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { hechos?: unknown }).hechos) ? (input as { hechos: unknown[] }).hechos : null;
  if (!lista) return { guardados: 0, verificados: 0, noVerificados: 0, rechazados: [{ indice: -1, motivo: "el archivo tiene que ser un arreglo o un objeto { hechos: [...] }" }] };
  const rechazados: ImportacionDeHechos["rechazados"] = [];
  const aceptados: HechoExterno[] = [];
  lista.forEach((raw, indice) => {
    const p = HechoEntradaSchema.safeParse(raw);
    if (!p.success) {
      rechazados.push({ indice, motivo: p.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ").slice(0, 300) });
      return;
    }
    aceptados.push(clasificarHecho(p.data, o));
  });
  const guardados = aceptados.length ? await store.saveHechos(aceptados) : 0;
  return { guardados, verificados: aceptados.filter((h) => h.estado === "verificado").length, noVerificados: aceptados.filter((h) => h.estado !== "verificado").length, rechazados };
}
