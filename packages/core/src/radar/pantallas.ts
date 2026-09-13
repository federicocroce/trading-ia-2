import type { Finding } from "./consistency.js";

/**
 * Coherencia ENTRE pantallas (2026-09-12). Puro.
 *
 * Por qué existe. `checkConsistency` mira si una fila se contradice con sus propias fuentes. Esto mira algo
 * distinto y que ninguna prueba cubría: que dos pantallas no digan cosas distintas del mismo símbolo. El
 * dueño lo pidió con un ejemplo exacto: si en una pantalla una acción figura como compra, en otra no puede
 * figurar como venta.
 *
 * Se alimenta de lo que las pantallas REALMENTE reciben, o sea las respuestas de la API, no de la base. Es
 * la única forma de detectar que el plan muestre un precio y la ficha otro, que es lo que el usuario ve.
 *
 * Regla de diseño: acá no se juzga si la recomendación es buena. Solo si la app se contradice a sí misma.
 */
export interface Pantallas {
  /** Radar → tabla de candidatos y fichas. */
  candidatos: Array<{ symbol: string; verdict: string; close: number; stop: number | null; flags: string[]; entry?: { state: string; low: number; high: number } | null }>;
  /** Radar → plan del aporte. */
  plan: { lines: Array<{ symbol: string; kind: string; close: number | null; stop?: number | null; entry?: { state: string } | null }>; leftOut?: Array<{ symbol: string; reason: string }> } | null;
  /** Cartera → veredicto por posición. */
  veredictos: Array<{ symbol: string; verb: string; close: number; stop: number | null }>;
  /** Hoy → novedades. */
  novedades?: { verdictChanges?: Array<{ symbol: string; from: string; to: string }> } | null;
}

/** Diferencia tolerada de precio entre dos pantallas del mismo día, en dólares. */
export const PRECIO_EPSILON = 0.01;

const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkPantallas(p: Pantallas): Finding[] {
  const out: Finding[] = [];
  const add = (check: string, symbol: string | null, severity: Finding["severity"], detail: string) => out.push({ check, symbol, severity, detail });

  const cand = new Map(p.candidatos.map((c) => [c.symbol, c]));
  const ver = new Map(p.veredictos.map((v) => [v.symbol, v]));

  // 1. El mismo símbolo no puede ser compra en una pantalla y venta en otra. Es el caso que pidió el dueño.
  for (const [sym, v] of ver) {
    const c = cand.get(sym);
    if (!c) continue;
    if (v.verb === "VENDER" && c.verdict === "COMPRAR") {
      add("compra_y_venta", sym, "grave", `Cartera dice VENDER y el Radar dice COMPRAR el mismo día`);
    }
    if (v.verb === "SUMAR" && c.verdict === "OBSERVAR") {
      add("sumar_y_observar", sym, "aviso", `Cartera lo propone para sumar y el Radar lo tiene en OBSERVAR: la pantalla invita a poner plata en algo que el Radar no compraría`);
    }
  }

  // 2. El precio del mismo símbolo tiene que ser el mismo en todas las pantallas del día.
  for (const [sym, v] of ver) {
    const c = cand.get(sym);
    if (c && Math.abs(c.close - v.close) > PRECIO_EPSILON) {
      add("precio_distinto", sym, "grave", `Radar muestra ${r2(c.close)} y Cartera ${r2(v.close)} para el mismo símbolo`);
    }
  }
  for (const l of p.plan?.lines ?? []) {
    const c = cand.get(l.symbol);
    if (c && l.close !== null && Math.abs(c.close - l.close) > PRECIO_EPSILON) {
      add("precio_distinto", l.symbol, "grave", `el plan muestra ${r2(l.close)} y el Radar ${r2(c.close)}`);
    }
  }

  // 3. El stop es la regla de salida: no puede haber dos niveles distintos para el mismo símbolo.
  for (const l of p.plan?.lines ?? []) {
    const c = cand.get(l.symbol);
    if (c && c.stop !== null && l.stop !== null && l.stop !== undefined && Math.abs(c.stop - l.stop) > PRECIO_EPSILON) {
      add("stop_distinto", l.symbol, "grave", `el plan dice stop ${r2(l.stop)} y el Radar ${r2(c.stop)}: son dos órdenes distintas para la misma posición`);
    }
  }

  // 4. El plan no puede comprar lo que el Radar no tiene en COMPRAR, ni contradecir su momento de entrada.
  for (const l of p.plan?.lines ?? []) {
    if (l.kind === "nucleo" || l.kind === "sumar") continue;
    const c = cand.get(l.symbol);
    if (!c) {
      add("plan_sin_candidato", l.symbol, "grave", `el plan lo compra y no aparece en los candidatos de hoy: la pantalla recomienda algo que no se puede auditar`);
      continue;
    }
    if (c.verdict !== "COMPRAR") add("plan_contra_radar", l.symbol, "grave", `el plan lo compra y el Radar lo tiene en ${c.verdict}`);
    if (l.entry && c.entry && l.entry.state !== c.entry.state) {
      add("entrada_distinta", l.symbol, "grave", `el plan dice "${l.entry.state}" y la ficha "${c.entry.state}": dos instrucciones distintas de cuándo entrar`);
    }
  }

  // 5. Un símbolo no puede recibir plata dos veces en el mismo plan. TSM el 12/9 salía como "sumar" por
  //    ser tenencia y otra vez como "comprar" por estar en el ranking: dos líneas, dos montos, una posición.
  const vistos = new Map<string, string[]>();
  for (const l of p.plan?.lines ?? []) vistos.set(l.symbol, [...(vistos.get(l.symbol) ?? []), l.kind]);
  for (const [sym, kinds] of vistos) {
    if (kinds.length > 1) add("simbolo_duplicado", sym, "grave", `aparece ${kinds.length} veces en el plan (${kinds.join(", ")}): se le asigna plata dos veces`);
  }

  // 6. Un símbolo no puede estar comprado y excluido a la vez.
  const comprados = new Set((p.plan?.lines ?? []).map((l) => l.symbol));
  for (const x of p.plan?.leftOut ?? []) {
    if (comprados.has(x.symbol)) add("comprado_y_excluido", x.symbol, "grave", `está en el plan y en la lista de los que no entraron`);
  }

  // 7. Un cambio de veredicto anunciado en Hoy tiene que coincidir con lo que muestra el Radar.
  for (const ch of p.novedades?.verdictChanges ?? []) {
    const c = cand.get(ch.symbol);
    if (c && ch.to !== c.verdict) {
      add("novedad_desfasada", ch.symbol, "aviso", `Hoy anuncia que pasó a ${ch.to} y el Radar lo muestra en ${c.verdict}`);
    }
  }

  return out;
}
