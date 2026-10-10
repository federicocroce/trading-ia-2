import { hechosVigentes, precioDeEslabon, VENTANAS_DIAS, type Cadenas, type Candle, type PrecioDeEslabon } from "@thesis/core";
import { candlesFor, type RadarDeps } from "./radar.js";

/**
 * El estado de cada eslabón de `config/cadenas.json` (10/10): su precio y los hechos de sector vigentes. Es lo que lee
 * el agente de `/cadenas` antes de buscar, para poner el signo de un hecho nuevo con el precio medido y no con el
 * titular, y para no volver a cargar lo que ya está.
 *
 * Las acciones de una cadena no siempre tienen velas en la base (la app las baja para lo que evalúa): las que faltan
 * o están viejas se piden, y quedan guardadas.
 */
export interface EstadoDeEslabon extends PrecioDeEslabon {
  tema: string;
  eslabon: string;
  nombre: string;
  simbolos: string[];
  hechos: Array<{ fecha: string; sesgo: string; titulo: string; simbolos: number }>;
}

const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * 86_400_000).toISOString().slice(0, 10);

export async function medirCadenas(deps: Pick<RadarDeps, "store" | "history">, cadenas: Cadenas, today: string): Promise<EstadoDeEslabon[]> {
  const todos = [...new Set(cadenas.cadenas.flatMap((c) => c.eslabones.flatMap((e) => e.simbolos)))];
  const desde = addDays(today, -420);
  const guardadas = new Map<string, Candle[]>();
  for (const s of todos) guardadas.set(s, await deps.store.candles(s, desde).catch(() => [] as Candle[]));
  // Viejas = la última vela tiene más de 5 días corridos (un fin de semana largo no alcanza para pedirla de nuevo).
  const faltan = todos.filter((s) => { const c = guardadas.get(s)!; return c.length < 200 || c[c.length - 1]!.date < addDays(today, -5); });
  if (faltan.length) {
    const { candles } = await candlesFor(deps as RadarDeps, faltan);
    for (const [s, c] of Object.entries(candles)) if (c.length) guardadas.set(s, c);
  }
  const sector = hechosVigentes(await deps.store.hechosPorTipo("sector", addDays(today, -VENTANAS_DIAS.sector)).catch(() => []), today);
  const out: EstadoDeEslabon[] = [];
  for (const t of cadenas.cadenas) {
    for (const e of t.eslabones) {
      const precio = precioDeEslabon(e.simbolos.map((s) => guardadas.get(s) ?? []));
      const deEste = sector.filter((h) => h.tipo === "sector" && e.simbolos.includes(h.symbol));
      const porHecho = new Map<string, { fecha: string; sesgo: string; titulo: string; simbolos: number }>();
      for (const h of deEste) {
        if (h.tipo !== "sector") continue;
        const k = `${h.fecha}|${h.fuente.url}|${h.valor.sesgo}`;
        const prev = porHecho.get(k);
        porHecho.set(k, prev ? { ...prev, simbolos: prev.simbolos + 1 } : { fecha: h.fecha, sesgo: h.valor.sesgo, titulo: h.valor.titulo, simbolos: 1 });
      }
      out.push({ tema: t.id, eslabon: e.id, nombre: `${t.nombre} → ${e.nombre}`, simbolos: e.simbolos, ...precio, hechos: [...porHecho.values()].sort((a, b) => b.fecha.localeCompare(a.fecha)) });
    }
  }
  return out;
}
