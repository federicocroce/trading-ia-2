import { HechoEntradaSchema, clasificarHecho, simbolosDelEslabon, type Cadenas, type HechoExterno } from "@thesis/core";
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

/**
 * Un hecho de sector escrito sobre un ESLABÓN (10/10), sin símbolo: `{ tipo: "sector", eslabon: "ia.memoria", ... }`.
 * Se expande a una fila por acción del eslabón (`config/cadenas.json`), con el mismo texto, la misma fuente y el eslabón
 * anotado en el valor. Así sigue entrando por el mismo esquema, la misma vigencia y la misma verificación por host.
 * Devuelve null si no es un hecho por eslabón, o el motivo si el eslabón no existe.
 */
function expandirPorEslabon(raw: unknown, cadenas: Cadenas | undefined): unknown[] | string | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { tipo?: unknown; symbol?: unknown; eslabon?: unknown; valor?: unknown };
  if (r.tipo !== "sector" || typeof r.eslabon !== "string" || r.symbol !== undefined) return null;
  if (!cadenas) return `hecho por eslabón ("${r.eslabon}") sin config/cadenas.json cargado`;
  const simbolos = simbolosDelEslabon(cadenas, r.eslabon);
  if (!simbolos) return `el eslabón "${r.eslabon}" no existe en config/cadenas.json`;
  const { eslabon, ...resto } = r as Record<string, unknown>;
  const valor = { ...((r.valor as Record<string, unknown>) ?? {}), eslabon };
  return simbolos.map((symbol) => ({ ...resto, symbol, valor }));
}

export async function importarHechos(store: Pick<RadarStore, "saveHechos">, input: unknown, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string; cadenas?: Cadenas }): Promise<ImportacionDeHechos> {
  const crudo = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { hechos?: unknown }).hechos) ? (input as { hechos: unknown[] }).hechos : null;
  if (!crudo) return { guardados: 0, verificados: 0, noVerificados: 0, rechazados: [{ indice: -1, motivo: "el archivo tiene que ser un arreglo o un objeto { hechos: [...] }" }] };
  const rechazados: ImportacionDeHechos["rechazados"] = [];
  // Primero se expanden los hechos por eslabón; el índice del rechazo es el del archivo, no el de la lista expandida.
  const lista: unknown[] = [];
  const indiceOriginal: number[] = [];
  crudo.forEach((raw, i) => {
    const e = expandirPorEslabon(raw, o.cadenas);
    if (typeof e === "string") rechazados.push({ indice: i, motivo: e });
    else for (const x of e ?? [raw]) { lista.push(x); indiceOriginal.push(i); }
  });
  const aceptados: HechoExterno[] = [];
  lista.forEach((raw, j) => {
    const indice = indiceOriginal[j]!;
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
