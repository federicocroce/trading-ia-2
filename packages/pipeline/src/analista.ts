import { VeredictoAnalistaSchema, type VeredictoAnalista } from "@thesis/core";
import type { RadarStore } from "./store.js";

/**
 * El único camino de escritura de los veredictos del analista (10/10): valida con el esquema (un "no" sin criterio de
 * la lista o sin fuente no entra) y guarda. Igual que los hechos: el agente deja un JSON, esto lo lee.
 */
export async function importarVeredictos(store: Pick<RadarStore, "saveVeredictosAnalista">, input: unknown, o: { version: string }): Promise<{ guardados: number; si: number; no: number; rechazados: Array<{ indice: number; motivo: string }> }> {
  const lista = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { veredictos?: unknown }).veredictos) ? (input as { veredictos: unknown[] }).veredictos : null;
  if (!lista) return { guardados: 0, si: 0, no: 0, rechazados: [{ indice: -1, motivo: "el archivo tiene que ser un arreglo o un objeto { veredictos: [...] }" }] };
  const ok: VeredictoAnalista[] = [];
  const rechazados: Array<{ indice: number; motivo: string }> = [];
  lista.forEach((raw, indice) => {
    const p = VeredictoAnalistaSchema.safeParse(raw);
    if (!p.success) rechazados.push({ indice, motivo: p.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ").slice(0, 300) });
    else ok.push({ ...p.data, symbol: p.data.symbol.toUpperCase(), version: o.version });
  });
  const guardados = ok.length ? await store.saveVeredictosAnalista(ok) : 0;
  return { guardados, si: ok.filter((v) => v.veredicto === "si").length, no: ok.filter((v) => v.veredicto === "no").length, rechazados };
}
