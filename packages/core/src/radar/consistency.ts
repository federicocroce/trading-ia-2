import type { Candle } from "../cartera/types.js";
import { lineHasExit, type ContributionPlan } from "./plan.js";
import type { CandidateRow } from "./types.js";

/**
 * Chequeo de consistencia de una corrida (2026-09-11). Puro.
 *
 * Por qué existe. Los tests comparan el código contra lo que yo especifiqué; el typecheck compara los tipos
 * contra sí mismos. Ninguno de los dos mira si lo que la app guardó dice la verdad. Todos los errores serios
 * de estos días pasaron por ese hueco y los encontró el dueño preguntando, no la suite:
 *
 * - la fila guardaba el piso de la franja de compra en la columna del precio (APH a 84,00 cuando cerró a 80,25);
 * - una verificación web "con reservas" quedaba guardada sin su bandera, así que no restaba convicción;
 * - una línea del plan sin stop era plata que entraba y no salía;
 * - los objetivos de analistas de APH eran de antes de un split 2:1 y daban un potencial de +144% inventado.
 *
 * Cada chequeo de acá abajo es uno de esos casos reales. No inventa reglas nuevas: compara lo que la app
 * guardó contra sus propias fuentes y contra sus propias reglas, y grita cuando se contradicen.
 */
export type FindingSeverity = "grave" | "aviso";

export interface Finding {
  /** Nombre corto del chequeo, estable, para poder silenciar o seguir uno en particular. */
  check: string;
  symbol: string | null;
  severity: FindingSeverity;
  detail: string;
}

export interface ConsistencyInput {
  rows: CandidateRow[];
  /** Velas por símbolo, la fuente contra la que se contrasta lo guardado. Sin velas, el chequeo de precio se saltea. */
  candles: Record<string, Candle[]>;
  plan: ContributionPlan | null;
}

export const CONSISTENCY_THRESHOLDS = {
  /** Diferencia tolerada entre el precio guardado y el cierre de la última vela, en dólares. */
  priceEpsilon: 0.01,
  /** Objetivo de analistas fuera de esta banda respecto del precio: casi siempre un split sin ajustar. */
  targetMaxRatio: 2,
  targetMinRatio: 0.5,
};

/** Qué bandera le corresponde a cada dictamen de la verificación web. */
const FLAG_FOR_VERDICT: Record<string, string> = {
  apto: "verificacion_apta",
  con_reservas: "verificacion_reservas",
  evitar: "verificacion_evitar",
};
const VERIFICATION_FLAGS = new Set([...Object.values(FLAG_FOR_VERDICT), "verificacion_pendiente"]);

const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkConsistency(i: ConsistencyInput): Finding[] {
  const out: Finding[] = [];
  const add = (check: string, symbol: string | null, severity: FindingSeverity, detail: string) => out.push({ check, symbol, severity, detail });

  for (const row of i.rows) {
    const velas = i.candles[row.symbol];
    const ultima = velas && velas.length ? velas[velas.length - 1]! : null;

    // 1. El precio guardado tiene que ser el cierre. Si no, todo lo que se calcula con él miente.
    if (ultima && Math.abs(row.close - ultima.close) > CONSISTENCY_THRESHOLDS.priceEpsilon) {
      add("precio_guardado", row.symbol, "grave", `la fila dice ${r2(row.close)} y la última vela (${ultima.date}) cerró en ${r2(ultima.close)}`);
    }

    // 2. La verificación web y las banderas tienen que contar la misma historia. Si el dictamen está guardado
    //    pero la bandera no, la salvedad no resta convicción y la candidata entra al plan como si estuviera limpia.
    const esperada = row.verification ? FLAG_FOR_VERDICT[row.verification.verdict] : null;
    if (esperada && !row.flags.includes(esperada)) {
      const v = row.verification!.verdict;
      const efecto = v === "apto" ? "la fila no muestra que está verificada" : "esa salvedad no está restando convicción ni contando para pasar a OBSERVAR";
      add("verificacion_sin_bandera", row.symbol, "grave", `la verificación dice "${v}" pero las banderas no la muestran: ${efecto}`);
    }
    const puestas = row.flags.filter((f) => VERIFICATION_FLAGS.has(f));
    if (puestas.length > 1) add("verificacion_duplicada", row.symbol, "grave", `dos banderas de verificación a la vez: ${puestas.join(", ")}`);
    if (!row.verification && puestas.some((f) => f !== "verificacion_pendiente")) {
      add("bandera_sin_verificacion", row.symbol, "aviso", `la bandera ${puestas.join(", ")} está puesta pero no hay verificación guardada`);
    }

    // 3. La franja de compra nunca puede salir al revés.
    if (row.entryLow !== null && row.entryHigh !== null && row.entryLow > row.entryHigh) {
      add("franja_invertida", row.symbol, "grave", `entrada de ${r2(row.entryLow)} a ${r2(row.entryHigh)}: el piso quedó arriba del techo`);
    }

    // 4. Objetivos de analistas de otra escala: casi siempre un split que la fuente no ajustó.
    const t = row.analystTargets;
    if (t && t.median !== null && row.close > 0) {
      const ratio = t.median / row.close;
      if (ratio > CONSISTENCY_THRESHOLDS.targetMaxRatio || ratio < CONSISTENCY_THRESHOLDS.targetMinRatio) {
        add("objetivo_fuera_de_escala", row.symbol, "aviso", `objetivo mediano ${r2(t.median)} contra un precio de ${r2(row.close)} (${r2(ratio)}×): sospecha de split sin ajustar`);
      }
    }

    // 5. Un COMPRAR sin momento de entrada no puede decir cuándo comprar. El núcleo no cuenta: va por calendario.
    if (row.verdict === "COMPRAR" && (row.kind === "stock" || row.kind === "etf" || row.kind === "watch") && !row.entry) {
      add("compra_sin_momento", row.symbol, "aviso", "queda COMPRAR pero no tiene momento de entrada: la app no puede decir cuándo entrar");
    }
  }

  // 6. Invariante del plan: toda línea que no sea núcleo tiene que tener salida.
  for (const l of i.plan?.lines ?? []) {
    if (!lineHasExit(l)) add("linea_sin_salida", l.symbol, "grave", `línea "${l.kind}" sin stop: es plata que entra y no sale`);
  }

  // 7. El plan no puede recomendar un símbolo que ya no es COMPRAR en la corrida de hoy.
  const verdictOf = new Map(i.rows.map((r) => [r.symbol, r.verdict]));
  for (const l of i.plan?.lines ?? []) {
    if (l.kind === "nucleo" || l.kind === "sumar") continue;
    const v = verdictOf.get(l.symbol);
    if (v && v !== "COMPRAR") add("plan_contra_veredicto", l.symbol, "grave", `el plan lo compra pero el Radar de hoy lo tiene en ${v}`);
  }

  return out;
}

/** Resumen de una línea para el log y la UI. */
export const summarizeFindings = (f: Finding[]): { graves: number; avisos: number; total: number } => ({
  graves: f.filter((x) => x.severity === "grave").length,
  avisos: f.filter((x) => x.severity === "aviso").length,
  total: f.length,
});
