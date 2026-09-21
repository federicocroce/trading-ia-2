import type { Candidate } from "./api";

/**
 * Filas de la lista de líderes (21/9), para la tarjeta del Radar. La regla vive en el núcleo (`estadoDeLider`): acá solo
 * se lee la marca que ya trae la fila. La lista NO entra al plan: se mide, y el tamaño que muestra es la MITAD del de una
 * compra normal, que es con lo que se mediría si algún día se le abre lugar.
 */
export interface LiderFila { symbol: string; estado: "en_retroceso" | "esperando"; close: number; franja: string; stop: number | null; target: number | null; medioTamanoUsd: number | null; aFavor: string[]; porQue: string }
const A_FAVOR: Record<string, string> = { guia_subida: "subió la guía", sorpresa_positiva: "sorprendió para arriba", consenso_compra: "consenso de compra", insiders_compran: "insiders compran" };
const SUBIO: Record<string, string> = { subio_mucho_12m: "subió más de 100% en 12 meses", no_perseguir: "subió más de 15% en 21 ruedas", consenso_en_precio: "consenso a menos de 10%" };
const f2 = (n: number) => n.toFixed(2).replace(".", ",");

export function filasDeLideres(rows: Candidate[]): LiderFila[] {
  const vistos = new Set<string>();
  const out: LiderFila[] = [];
  for (const c of rows) {
    const estado = c.flags.includes("lider_en_retroceso") ? "en_retroceso" : c.flags.includes("lider_esperando") ? "esperando" : null;
    if (!estado || vistos.has(c.symbol)) continue;
    vistos.add(c.symbol);
    const e = c.entry ?? null;
    const franja = estado === "en_retroceso" ? `${f2(c.entryLow ?? c.close)} a ${f2(c.entryHigh ?? c.close)}` : e && e.state === "esperar_retroceso" ? `esperar ${f2(e.level)} (${e.levelLabel})` : c.flags.includes("no_perseguir") ? "esperar: subió más de 15% en 21 ruedas, todavía es perseguirla" : "esperar: todavía no hay un boleto que se pueda ejecutar";
    out.push({ symbol: c.symbol, estado, close: c.close, franja, stop: estado === "en_retroceso" ? c.stop : null, target: estado === "en_retroceso" ? c.target : null, medioTamanoUsd: estado === "en_retroceso" && c.sizeUsd !== null ? Math.floor(c.sizeUsd / 2) : null, aFavor: c.flags.flatMap((f) => (A_FAVOR[f] ? [A_FAVOR[f]!] : [])), porQue: c.flags.flatMap((f) => (SUBIO[f] ? [SUBIO[f]!] : [])).join(" · ") });
  }
  return out.sort((a, b) => (a.estado === b.estado ? a.symbol.localeCompare(b.symbol) : a.estado === "en_retroceso" ? -1 : 1));
}
