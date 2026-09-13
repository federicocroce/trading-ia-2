import type { Candle } from "../cartera/types.js";
import { computeTrailingStop } from "../cartera/stop.js";
import { CONSENSUS_SCALE } from "./candidate.js";
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
  /** Capitalización guardada por símbolo, para contrastarla contra la que implica su propio P/S. */
  mcaps?: Record<string, number | null>;
  /** Velas por símbolo, la fuente contra la que se contrasta lo guardado. Sin velas, el chequeo de precio se saltea. */
  candles: Record<string, Candle[]>;
  plan: ContributionPlan | null;
  /** Métricas de Finnhub por símbolo. Sin esto, los chequeos de fundamentales se saltean. */
  metrics?: Record<string, Record<string, number | null | undefined>>;
  /** Fecha de la corrida. Una fila fechada más adelante que hoy es una corrida con el reloj mal. */
  today?: string;
  /**
   * Hasta qué fecha se leyeron las noticias de cada símbolo (`null` = nunca). Sin esto el chequeo se saltea;
   * con esto se puede distinguir "no hubo eventos" de "nadie miró", que hasta el 12/9 eran el mismo vacío.
   */
  newsScannedTo?: Record<string, string | null>;
}

export const CONSISTENCY_THRESHOLDS = {
  /** Diferencia tolerada entre el precio guardado y el cierre de la última vela, en dólares. */
  priceEpsilon: 0.01,
  /** Tolerancia del stop: el cálculo redondea a dos decimales en un lado y no en el otro. */
  stopEpsilon: 0.02,
};

/**
 * Umbrales de fundamentales que se contradicen solos. Salieron de contrastar la corrida del 11/9 contra
 * balances y comunicados: GOOGL con 99.000 M de revalorización no realizada, DVA con patrimonio de −765 M
 * declarando deuda/patrimonio 78 y ROE 181%, STNG con 260 M de venta de buques dentro del margen operativo.
 */
export const FUNDAMENTAL_THRESHOLDS = {
  /** Cuánto puede superar el margen neto al operativo antes de que sea evidente que la ganancia es de afuera. */
  marginGapPct: 5,
  /** Deuda/patrimonio por encima de esto no mide apalancamiento: mide un patrimonio que ya no existe. */
  debtToEquityAbsurd: 20,
  // No hay umbral de ROE suelto: NVDA tiene 110% con patrimonio real y enorme, así que un ROE alto por sí
  // solo no prueba nada. Solo se reporta acompañando a un patrimonio que efectivamente se borró.
};
// La banda de escala del consenso vive en candidate.ts (CONSENSUS_SCALE): una sola fuente para la regla
// que niega el potencial y para el chequeo que lo reporta, así no pueden discrepar.

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
    // 1. El precio guardado tiene que ser el cierre DE SU PROPIA FECHA. Comparar contra la última vela
    //    marcaba como error toda fila de un día anterior que sigue vigente, que es lo normal en la lista
    //    de seguimiento cuando el ranking no la reescribe.
    const velas = i.candles[row.symbol];
    const suya = velas?.filter((c) => c.date <= row.candidateDate).at(-1) ?? null;
    if (suya && Math.abs(row.close - suya.close) > CONSISTENCY_THRESHOLDS.priceEpsilon) {
      add("precio_guardado", row.symbol, "grave", `la fila del ${row.candidateDate} dice ${r2(row.close)} y la vela de ${suya.date} cerró en ${r2(suya.close)}`);
    }

    // 1b. El stop guardado tiene que ser el que sale de esas mismas velas. El refresco arrastraba el del día
    //     anterior en las filas excluidas mientras sí actualizaba el cierre: BEAM quedó con el stop congelado
    //     en 27,13 desde el 7/9 con el precio en 24,37, mostrando una salida que ya no correspondía a nada.
    if (row.stop !== null && velas && velas.length) {
      const hasta = velas.filter((c) => c.date <= row.candidateDate);
      const esperado = hasta.length ? computeTrailingStop(hasta) : null;
      if (esperado !== null && Math.abs(row.stop - esperado) > CONSISTENCY_THRESHOLDS.stopEpsilon) {
        add("stop_guardado", row.symbol, "grave", `la fila dice stop ${r2(row.stop)} y con sus propias velas da ${r2(esperado)}`);
      }
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
      if (ratio > CONSENSUS_SCALE.maxRatio || ratio < CONSENSUS_SCALE.minRatio) {
        add("objetivo_fuera_de_escala", row.symbol, "aviso", `objetivo mediano ${r2(t.median)} contra un precio de ${r2(row.close)} (${r2(ratio)}×): sospecha de split sin ajustar`);
      }
    }

    // 5. Fila fechada en el futuro: la corrida tomó la fecha en UTC y en Argentina eso pasa todas las noches
    //    a partir de las 21:00. El 11/9 una corrida de las 22:17 escribió 130 filas con fecha del 12.
    if (i.today && row.candidateDate > i.today) {
      add("fila_en_el_futuro", row.symbol, "grave", `la fila está fechada ${row.candidateDate} y hoy es ${i.today}: la corrida tomó la fecha en UTC`);
    }

    // 6. Fundamentales que se contradicen solos. No juzgan a la empresa: dicen que el número no se puede usar.
    const m = i.metrics?.[row.symbol];
    const mcap = i.mcaps?.[row.symbol] ?? null;
    if (m) {
      const op = m["operatingMarginTTM"];
      const neta = m["netProfitMarginTTM"];
      // Ganancia que no viene de la operación: GOOGL 54,8% neto contra 33,1% operativo por 99.000 M de
      // revalorización no realizada de SpaceX. El múltiplo calculado sobre eso no mide el negocio.
      // Solo tiene sentido con ganancia: en una empresa con pérdida, un neto menos negativo que el
      //    operativo es lo normal (intereses ganados sobre la caja) y no es una ganancia de afuera.
      if (op !== null && op !== undefined && neta !== null && neta !== undefined && neta > 0 && neta > op + FUNDAMENTAL_THRESHOLDS.marginGapPct) {
        add("ganancia_no_operativa", row.symbol, "aviso", `margen neto ${r2(neta)}% arriba del operativo ${r2(op)}%: la ganancia no viene de la operación, el P/E sobre eso no mide el negocio`);
      }
      // La capitalización guardada contra la que implica su propio P/S y sus ingresos por acción. Es el
      // control que destapó que TSM figuraba con 11,1 billones (precio del ADR por acciones locales) y APH
      // con la mitad (acciones pre-split). Sobre NVDA el control da 0,2% de diferencia: tiene dientes.
      const ps = m["psTTM"];
      const rps = m["revenuePerShareTTM"];
      const acciones = m["shareOutstanding"];
      if (mcap !== null && typeof ps === "number" && ps > 0 && typeof rps === "number" && rps > 0 && typeof acciones === "number" && acciones > 0) {
        const implicada = ps * rps * acciones * 1e6;
        const ratio = implicada > 0 ? mcap / implicada : null;
        if (ratio !== null && (ratio > 1.5 || ratio < 0.67)) {
          add("capitalizacion_inconsistente", row.symbol, "grave", `capitalización ${Math.round(mcap / 1e9)} mil M contra ${Math.round(implicada / 1e9)} mil M que implica su propio P/S (${r2(ratio)}×): ratio de ADR o split sin ajustar`);
        }
      }

      // Patrimonio borrado por recompras o por pérdidas: ROE y deuda/patrimonio dejan de significar algo.
      // DVA declaraba deuda/patrimonio 78 y ROE 181% con patrimonio de −765 M.
      const de = m["totalDebt/totalEquityAnnual"];
      if (de !== null && de !== undefined && Math.abs(de) > FUNDAMENTAL_THRESHOLDS.debtToEquityAbsurd) {
        const roe = m["roeTTM"];
        const conRoe = roe === null || roe === undefined ? "" : ` y el ROE de ${r2(roe)}%`;
        add("patrimonio_sin_sentido", row.symbol, "aviso", `deuda/patrimonio ${r2(de)}: el patrimonio quedó cerca de cero o negativo, así que ese ratio${conRoe} son artefactos del denominador y el eje de calidad los premia igual`);
      }

    }

    // 7. Un COMPRAR sin momento de entrada no puede decir cuándo comprar. El núcleo no cuenta: va por calendario.
    if (row.verdict === "COMPRAR" && (row.kind === "stock" || row.kind === "etf" || row.kind === "watch") && !row.entry) {
      add("compra_sin_momento", row.symbol, "aviso", "queda COMPRAR pero no tiene momento de entrada: la app no puede decir cuándo entrar");
    }

    // 8. Un objetivo por debajo del precio de hoy solo se entiende si la entrada también está por debajo.
    //    EWT el 12/9: COMPRAR, precio 110,91, objetivo 110,69. No estaba mal calculado (el 2 a 1 se mide
    //    desde la franja 106,75–107,83, a la que hay que esperar), pero la tabla no mostraba la franja y la
    //    fila se leía como "comprá a 110,91 para vender a 110,69". El error era de la pantalla, no del número.
    if (row.target !== null && row.close > 0 && row.target < row.close) {
      const techo = row.entry?.high ?? row.entryHigh ?? null;
      if (techo === null || techo >= row.close) {
        add("objetivo_bajo_el_precio", row.symbol, "grave", `objetivo ${r2(row.target)} por debajo del precio ${r2(row.close)} sin una entrada más abajo que lo explique`);
      }
    }

    // 9. La app no puede afirmar que no hubo eventos en un símbolo cuyas noticias nunca leyó. El 12/9 esto
    //    valía para 47 de 91 filas y para cinco de las ocho posiciones con plata puesta, y las tres
    //    pantallas mostraban "ninguno detectado en noticias" igual que en las verificadas.
    if (i.newsScannedTo && row.kind === "stock" && i.newsScannedTo[row.symbol] === null) {
      add("noticias_sin_leer", row.symbol, "aviso", "es candidata y nunca se leyó una noticia suya: sus eventos vacíos no prueban nada");
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
