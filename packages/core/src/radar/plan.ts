import type { EntryTiming } from "./entry.js";
import type { PlanChange, PlanSymbolInput } from "./plan-changes.js";
import { firstTrancheFrom } from "./fomc.js";
import type { MacroRegime } from "./regime.js";
import type { AssetClass, EtfConfig, EtfRole, RadarPolicy } from "./types.js";

/**
 * Plan del aporte (spec etapa 2 §8, v2 2026-09-08). Puro. Con el aporte del mes o con un monto dado:
 * 1) mientras el núcleo esté bajo su objetivo, `coreSharePctWhileBelowTarget` del monto va al núcleo (no todo);
 * 2) SUMAR de Cartera hasta `sumarSharePctOfRest` de lo que queda;
 * 3) nuevas: acciones COMPRAR por prioridad (convicción), una de seguimiento y un ETF satélite como máximo,
 *    repartidas parejo, respetando el máximo de posiciones nuevas (acciones + ETFs; el seguimiento es elección tuya);
 * 4) sobrante al núcleo. Ninguna línea supera `maxLinePctOfContribution` del monto ni el tope por posición.
 */
export interface PlanInput {
  month: string;
  portfolioValueUsd: number;
  positions: Array<{ symbol: string; valueUsd: number; assetClass: AssetClass; role?: EtfRole }>;
  /** `caution`: si el ETF del tema está en OBSERVAR (oro bajo la media de 200 con NEM subponderada), no se suma y la nota lo dice.
   *  `verification`: la del Radar si el símbolo está ahí. Un SUMAR es una compra: con reservas, evitar o con el cuestionario anterior no se suma. */
  sumarCandidates: Array<{ symbol: string; valueUsd: number; weightPct: number; stop?: number | null; target?: number | null; caution?: string | null; verification?: PlanVerification | null | undefined; atr?: number | null; review?: PlanReview | null | undefined }>;
  /** `cautions`: salvedades ya escritas (p. ej. "se mueve como YPF que ya tenés") que van a la razón de la línea.
   *  `verification`: veredicto de la verificación web. Una acción entra solo apta y con el cuestionario vigente;
   *  `null` = pendiente (no entra); `undefined` = no hay verificador (no se exige).
   *  `flags`: banderas del candidato; las de precio (`consenso_en_precio`, `subio_mucho_12m`) tampoco entran como nueva.
   *  `atr`: ATR de 14 ruedas al día de la fila, para medir si el stop quedó dentro del ruido (ver `noiseBlock`).
   *  `overlap`: la posición tuya con la que más se mueve; desde `OVERLAP_BLOCK_CORR` no entra como nueva. */
  buyCandidates: Array<{ symbol: string; kind: "stock" | "etf" | "watch"; priority: number | null; score: number | null; sizeUsd: number | null; close: number; entryLow?: number | null; entryHigh?: number | null; stop?: number | null; target?: number | null; cautions?: string[]; verification?: PlanVerification | null | undefined; flags?: string[]; entry?: PlanLine["entry"]; atr?: number | null; overlap?: { with: string; corr: number } | null; review?: PlanReview | null | undefined; /** Si ya la tenés, qué dice Cartera hoy: con REVISAR o VENDER el plan no la compra como nueva (18/9). */ cartera?: { verb: string; reason: string } | null }>;
  /** Régimen macro (pieza 4): con régimen restrictivo una parte del aporte va a letras del Tesoro antes que nada. */
  regime?: MacroRegime | null;
  /** Fecha del plan y decisiones de la Fed (`config/fomc.json`): con una dentro de 3 días hábiles, el primer tramo va después. */
  fomc?: { today: string; decisions: string[] } | null;
  coreEtfs: EtfConfig[];
  spyClose: number | null;
  closes: Record<string, number>;
}
/**
 * Dictamen de la verificación web tal como lo usa el plan. `current`: hecha con el cuestionario vigente. El 13/9
 * NBN estaba "apta" con un cuestionario que no preguntaba si la sorpresa sobrevivía sin extraordinarios; con el
 * nuevo, lo verificado antes vale como pendiente hasta repetirse. Sin el campo (llamadores viejos) cuenta como vigente.
 */
export interface PlanVerification {
  verdict: "apto" | "con_reservas" | "evitar";
  reason: string;
  current?: boolean;
}

/**
 * Revisión antes de comprar (15/9): una segunda búsqueda, independiente de la verificación, de razones para NO comprar
 * hoy lo que el plan compraría. El 14/9 la verificación dio "apto" a GFI sin ver que la licencia de Tarkwa vence en
 * abril de 2027. Solo "sin objeciones" deja comprar.
 */
export interface PlanReview {
  verdict: "sin_objeciones" | "objecion" | "no_pude_verificar";
  reason: string;
}
/*
 * Las dos compuertas de IA avisan en vez de bloquear (18/9, aprobado por el dueño). Del 15/9 al 18/9 el plan compró
 * solo núcleo: el verificador dio "con reservas" a 16 de 17 (la misma frase de valuación en 15) y la revisión antes de
 * comprar nunca corrió (cero filas: una búsqueda por acción y por día a un modelo gratis saturado). Con el verificador
 * arreglado, APH, SMCI, NVDA y PGY pasaban y el plan igual compraba solo núcleo por "revisión pendiente". Las reglas
 * fijas que salieron de NBN y GFI (banco sin estados, subió más de 100%, consenso cerca, stop en el ruido, no
 * diversifica) siguen frenando. De la IA frena solo el "evitar" de la verificación. Lo demás —con reservas, pendiente,
 * cuestionario anterior, y todo lo que diga la revisión— va escrito en la línea y decide él.
 *
 * La objeción de la revisión también avisa (18/9, 12:19): el mismo día corrió por primera vez y objetó a las dos únicas
 * acciones del plan dos minutos después de que entraran (APH: ventas del CEO y el CFO; SMCI: la "investigación" de un
 * estudio de abogados). A un modelo al que se le pide "buscá razones para no comprarla" siempre le aparece algo: sirve
 * como información y frena todo como compuerta.
 */
/** Lo que la revisión deja escrito en la línea; nunca frena. `null` = pendiente; `undefined` = no hay revisor. */
export function reviewCaution(r: PlanReview | null | undefined): string | null {
  if (r === undefined) return null;
  if (r === null) return "revisión antes de comprar pendiente";
  if (r.verdict === "objecion") return `la revisión antes de comprar encontró una objeción: ${r.reason}`;
  return r.verdict === "no_pude_verificar" ? `la revisión antes de comprar no pudo verificar: ${r.reason}` : null;
}

/** Motivo por el que una verificación no deja comprar, o null si deja: solo "evitar", sea del cuestionario que sea. */
export function verificationBlock(v: PlanVerification | null | undefined): string | null {
  return v && v.verdict === "evitar" ? `verificación web dice evitar: ${v.reason}` : null;
}
/** Lo que la verificación deja escrito en la línea sin frenarla. `undefined` = no hay verificador: no se exige. */
export function verificationCaution(v: PlanVerification | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return "verificación web pendiente";
  if (v.verdict === "con_reservas") return `verificación web con reservas: ${v.reason}`;
  if (v.verdict === "apto" && v.current === false) return "verificación hecha con el cuestionario anterior";
  return null;
}
/**
 * Salvedades de la fila que no frenan pero tienen que leerse al lado de COMPRAR (21/9, SMCI): el dueño compra lo que dice
 * COMPRAR, y estas dos son justo lo que el stop no cubre o lo que el objetivo promete de más.
 */
export const AVISOS_DE_FILA: Record<string, string> = {
  investigacion_abierta: "investigación regulatoria abierta: un titular puede abrir con un salto por debajo del stop (el hecho y su fuente están en la ficha)",
  objetivo_sobre_consenso: "el objetivo de la app está 15% o más arriba del consenso de analistas",
};
const avisosDeFila = (flags: readonly string[] | undefined): string[] => (flags ?? []).flatMap((f) => (AVISOS_DE_FILA[f] ? [AVISOS_DE_FILA[f]!] : []));
/** Los avisos de las dos compuertas, en orden, para la línea del plan. */
const avisosDeIa = (v: PlanVerification | null | undefined, r: PlanReview | null | undefined): string[] => [verificationCaution(v), reviewCaution(r)].filter((x): x is string => x !== null);
/**
 * La verificación como dato de entrada del plan, en el MISMO orden que `verificationBlock` (15/9): LNC figuraba
 * "anterior" en los datos y "con reservas" en el motivo. Sin verificador (undefined) no hay dato.
 */
export function verificationLabel(v: PlanVerification | null | undefined): string | null {
  if (v === undefined) return null;
  if (v === null) return "pendiente";
  if (v.verdict !== "apto") return v.verdict;
  return v.current === false ? "anterior" : v.verdict;
}

export interface PlanLine {
  symbol: string;
  kind: "nucleo" | "sumar" | "comprar" | "seguimiento";
  amountUsd: number;
  rationale: string;
  close: number | null;
  spyClose: number | null;
  alpha30dPct: number | null;
  alpha90dPct: number | null;
  /** Ticket para ejecutar (solo comprar/seguimiento): hasta dónde pagar, stop y objetivo del día del plan. */
  entryHigh?: number | null;
  stop?: number | null;
  target?: number | null;
  /** Rendimiento TOTAL (con dividendos) de los últimos 12 meses. Contexto para comparar contra el núcleo, no una promesa. */
  ret12mPct?: number | null;
  /** true = se calculó sin dividendos (no había cierre ajustado): el número subestima lo que rindió. */
  ret12mPartial?: boolean | null;
  /** De qué rueda es `close` (15/9): la pantalla decía "candidatos del 15/9" con cierres del 14/9. */
  closeDate?: string | null;
  /** Prioridad con la que entró (convicción para acciones, −riesgo para seguimiento, FR 6m para ETFs). */
  priority?: number | null;
  /** Cuándo comprarla: ahora, o esperando un nivel. `entryHigh` es el techo de esa franja. */
  entry?: EntryTiming | null;
  /**
   * Lo que la verificación web y la revisión antes de comprar dejaron sin cerrar (18/9): no frenan, pero toda pantalla
   * que diga COMPRAR o SUMAR los muestra al lado. Sin avisos, el campo no está.
   */
  avisos?: string[];
  /** Debajo de este precio la orden no se ejecuta: el stop quedaría dentro del ruido de un día (stop + 1 ATR, 14/9). */
  minPrice?: number | null;
  /**
   * La base única de la orden (15/9): el precio contra el que se cuentan la cantidad, el riesgo y los % en todas las
   * pantallas. En una compra, el techo de la franja (lo máximo que se paga); en el núcleo y en un SUMAR, el cierre.
   * Hasta el 15/9 cada pantalla elegía la suya: APH mostraba stop −1,1% desde el cierre y objetivo +19,7% desde el techo.
   */
  orderPrice?: number | null;
  /** Cantidad total y del primer tramo, contadas contra `orderPrice`; y el monto del primer tramo. */
  qty?: number | null;
  trancheUsd?: number | null;
  trancheQty?: number | null;
}
export interface PlanOptions {
  /** Monto a repartir en vez del aporte mensual (plata líquida de una vez). */
  amountUsd?: number;
}
const DEFAULTS = { coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
/** A partir de cuántos aportes mensuales el plan sugiere escalonar la compra. */
export const TRANCHE_AT_MONTHS = 3;
/**
 * Banderas que dejan a un candidato fuera de las posiciones nuevas del plan, con el motivo que se muestra. Las de precio
 * ya las descuenta la convicción; `banco_sin_estados` (14/9) es que la app no tiene cómo verificar su ganancia.
 */
export const PLAN_BLOCKERS: Record<string, string> = {
  consenso_en_precio: "el objetivo de consenso está a menos de 10% del precio",
  subio_mucho_12m: "subió más de 100% en 12 meses",
  banco_sin_estados: "banco sin estados de la SEC legibles: la app no puede verificar su ganancia (Finnhub infla los ingresos de los bancos y la verificación web no encontró sus extraordinarios ni su concentración inmobiliaria)",
  // AES (16/9): el Radar le calculaba objetivo 15,93 "al doble del riesgo" contra una fusión en efectivo a 15,00 ya
  // votada por los accionistas. El retorno está topado por contrato y, si el acuerdo se cae, la referencia sin oferta
  // estaba ~25% abajo. Además le parece una compra perfecta: se mueve poco y los múltiplos quedan baratos.
  bajo_oferta_de_compra: "está bajo una oferta de compra (lo dice un formulario de la SEC): el precio está fijado por el acuerdo, así que el objetivo al doble del riesgo no puede pasar",
};
/**
 * A cuántos ATR del stop tiene que estar el precio para comprar o sumar (14/9). APH cerró en 78,55 con el stop de su
 * orden en 77,81 (0,3 ATR) y TSM en 418 con el de la posición en 413,63 (0,4 ATR): con dos años de velas, un stop a
 * menos de medio ATR se tocaba en cinco ruedas siete de cada diez veces (NVDA y V, 13/9). Comprar ahí es comprar la salida.
 */
export const STOP_NOISE_ATR = 1;
/** Correlación desde la que una compra nueva no diversifica y no entra (14/9: GFI se mueve 0,86 con NEM, que ya tenés). */
export const OVERLAP_BLOCK_CORR = 0.85;
const coma = (n: number, d: number) => n.toFixed(d).replace(".", ",");
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Motivo por el que el stop está dentro del ruido, o null si está lejos (o si falta un dato para medirlo). */
export function noiseBlock(close: number | null | undefined, stop: number | null | undefined, atr: number | null | undefined, etiqueta = "el precio"): string | null {
  if (close === null || close === undefined || stop === null || stop === undefined || !atr || atr <= 0) return null;
  const d = (close - stop) / atr;
  if (d >= STOP_NOISE_ATR) return null;
  return `${etiqueta} (${coma(close, 2)}) está a ${coma(d, 1)} ATR del stop (${coma(stop, 2)}): dentro del ruido de un día, la orden espera a que se aleje (se revisa en cada corrida)`;
}
const miles = (n: number) => Math.round(n).toLocaleString("es-AR");
/** Precio mínimo para ejecutar la orden: por debajo, el stop queda dentro del ruido. */
export const minPriceFor = (stop: number | null | undefined, atr: number | null | undefined): number | null => (stop !== null && stop !== undefined && atr && atr > 0 ? round2(stop + STOP_NOISE_ATR * atr) : null);

/** Posiciones nuevas según el monto: el tope base más una por cada 3 aportes mensuales, hasta 5 (40k con 6.5k mensual → 4). */
export const maxNewPositions = (aporte: number, monthlyUsd: number, base: number) => Math.min(5, base + Math.floor(aporte / (3 * Math.max(1, monthlyUsd))));
export interface ContributionPlan {
  month: string;
  totalUsd: number;
  lines: PlanLine[];
  notes: string[];
  /** Todo COMPRAR que no entró, con su lugar y motivo: el plan se explica solo. */
  leftOut?: Array<{ symbol: string; reason: string }>;
  /** En cuántas compras conviene ejecutarlo (1 = de una vez). */
  tranches?: number;
  /**
   * Cuándo se armó este plan, en ISO. El plan es una FOTO: no se rehace solo cuando cambian los precios ni
   * cuando se arregla el motor, así que el encabezado tiene que decir de cuándo es. El 13/9 el dueño
   * preguntó "¿sigo viendo el mismo plan que antes?" y no había forma de contestarle desde la pantalla.
   * Lo pone la persistencia al leerlo; al construirlo va sin esto.
   */
  builtAt?: string;
  /** Con qué datos entró cada símbolo (15/9): explica por qué cambia el plan la próxima vez que se rearma. */
  inputs?: Record<string, PlanSymbolInput>;
  /** Qué cambió respecto del plan anterior y por qué (ver `explainPlanChange`). */
  changes?: PlanChange[];
  /** Cuándo se había armado el plan contra el que se comparó. */
  previousBuiltAt?: string | null;
  /** Controles automáticos sobre este plan (15/9). Con un grave, o sin controles sobre este plan, no se ejecuta. */
  controles?: PlanControles | null;
  /** Lo que el plan compraría y todavía no pasó la revisión antes de comprar (15/9). Mientras haya, no se ejecuta. */
  reviewsPending?: string[];
  /**
   * Lo que solo la verificación web frena (pendiente o con el cuestionario anterior), en el orden del plan (15/9). Los
   * reintentos verifican esto y nada más: verificar lo que igual frena una regla fija era gastar cuota en vano.
   */
  verificationsPending?: string[];
}
/** Resultado de los controles automáticos (auditoría de pantallas + consistencia de filas) sobre un plan. */
export interface PlanControles {
  at: string;
  /** El plan que se controló: si el plan se rearmó después, estos controles ya no valen. */
  planBuiltAt: string;
  graves: number;
  avisos: number;
  findings: Array<{ check: string; symbol: string | null; severity: "grave" | "aviso"; detail: string }>;
  /** Si los controles no pudieron correr (una pantalla no respondió): cuenta como no controlado. */
  error?: string;
}

/**
 * Invariante del plan (2026-09-11): toda línea o es núcleo, que se compra y se mantiene por calendario, o es una
 * tesis con salida, es decir con stop. Nada intermedio. Nació de haber metido una reserva en letras sin regla de
 * despliegue: plata que entraba todos los meses y no salía nunca, y que además rinde menos que el núcleo.
 */
export function lineHasExit(l: Pick<PlanLine, "kind" | "stop">): boolean {
  return l.kind === "nucleo" || (l.stop !== null && l.stop !== undefined);
}

const MIN_LINE_USD = 100;
/** "2026-09-16" → "16/9". */
const dm = (isoDate: string) => `${Number(isoDate.slice(8, 10))}/${Number(isoDate.slice(5, 7))}`;

export function planContribution(i: PlanInput, c: RadarPolicy["contribution"], o: PlanOptions = {}): ContributionPlan {
  const cfg = { ...DEFAULTS, coreSharePctWhileBelowTarget: c.coreSharePctWhileBelowTarget ?? DEFAULTS.coreSharePctWhileBelowTarget, sumarSharePctOfRest: c.sumarSharePctOfRest ?? DEFAULTS.sumarSharePctOfRest, watchLinesMax: c.watchLinesMax ?? DEFAULTS.watchLinesMax, etfLinesMax: c.etfLinesMax ?? DEFAULTS.etfLinesMax };
  const aporte = Math.round(o.amountUsd ?? c.monthlyUsd);
  const total = i.portfolioValueUsd + aporte;
  const notes: string[] = [];
  const lines: PlanLine[] = [];
  const line = (symbol: string, kind: PlanLine["kind"], amountUsd: number, rationale: string): PlanLine => ({ symbol, kind, amountUsd, rationale, close: i.closes[symbol] ?? null, spyClose: i.spyClose, alpha30dPct: null, alpha90dPct: null });
  const isCore = (p: PlanInput["positions"][number]) => p.role === "nucleo" || i.coreEtfs.some((e) => e.symbol === p.symbol);
  const valueOf = (symbol: string) => i.positions.find((p) => p.symbol === symbol)?.valueUsd ?? 0;
  const capFor = (symbol: string) => Math.max(0, (c.maxPositionPct / 100) * total - valueOf(symbol));
  const maxLine = Math.round((c.maxLinePctOfContribution / 100) * aporte);
  let remaining = aporte;

  /**
   * Reparte `amount` entre los ETFs de núcleo por peso objetivo; el resto de redondeo va al último. Cada parte queda
   * anotada con su motivo: el 15/9 la línea decía "60% del monto" y el núcleo recibía los 40.000.
   */
  const partesDelNucleo: Array<{ reason: string; amount: number }> = [];
  const allocateCore = (amount: number, rationale: string) => {
    const core = i.coreEtfs.filter((e) => e.role === "nucleo");
    if (!core.length || amount <= 0) return false;
    partesDelNucleo.push({ reason: rationale, amount });
    const wsum = core.reduce((s, e) => s + (e.coreWeight ?? 1), 0);
    let used = 0;
    core.forEach((e, idx) => {
      const amt = idx === core.length - 1 ? amount - used : Math.round((amount * (e.coreWeight ?? 1)) / wsum);
      used += amt;
      if (amt <= 0) return;
      const existing = lines.find((l) => l.symbol === e.symbol && l.kind === "nucleo");
      if (existing) existing.amountUsd += amt;
      else lines.push(line(e.symbol, "nucleo", amt, rationale));
    });
    remaining -= amount;
    return true;
  };

  if (i.regime) notes.push(`Régimen macro al ${i.regime.asOf}: ${i.regime.state} (${i.regime.why}).`);
  // Escalonado: un monto grande entra en tramos para no comprar todo en un solo precio. No es plata en efectivo
  // esperando una corrección (eso es plata muerta), es el mismo plan ejecutado en dos o tres compras.
  const tranches = aporte >= TRANCHE_AT_MONTHS * c.monthlyUsd ? Math.min(3, Math.floor(aporte / (TRANCHE_AT_MONTHS * c.monthlyUsd)) + 1) : 1;
  if (tranches > 1) {
    const tramo = Math.floor(aporte / tranches);
    const montos = [...Array(tranches - 1).fill(tramo), aporte - tramo * (tranches - 1)].map(miles);
    notes.push(`Monto de ${Math.round(aporte / c.monthlyUsd)} aportes: conviene ejecutarlo en ${tranches} tramos: USD ${montos.slice(0, -1).join(", ")} y ${montos.at(-1)}, con dos o tres semanas entre cada uno. Mismas líneas y mismas proporciones en cada tramo.`);
  }
  // Reunión de la Fed (13/9): con una decisión a 3 días hábiles o menos, se compra después del anuncio.
  const fed = i.fomc ? firstTrancheFrom(i.fomc.today, i.fomc.decisions) : null;
  if (fed) notes.push(`La Fed decide el ${dm(fed.decision)}: ${tranches > 1 ? "el primer tramo" : "la compra"} va desde el ${dm(fed.from)}, después del anuncio. Esperar hasta 3 días hábiles cuesta poco y evita comprar justo antes de una decisión que mueve todo el mercado.`);

  // 1. Núcleo: mientras esté bajo el objetivo, una parte fija del monto (el resto sigue bajando a lo demás).
  const coreValue = i.positions.filter(isCore).reduce((s, p) => s + p.valueUsd, 0);
  const coreTarget = (c.coreTargetPct / 100) * total;
  const gap = Math.max(0, coreTarget - coreValue);
  if (gap > 0) {
    // Sobre lo que queda después de la reserva (sin reserva es el aporte entero).
    const toCore = Math.min(Math.round(gap), Math.round((cfg.coreSharePctWhileBelowTarget / 100) * remaining), remaining);
    if (i.coreEtfs.some((e) => e.role === "nucleo")) allocateCore(toCore, `el ${cfg.coreSharePctWhileBelowTarget}% del monto mientras el núcleo (${Math.round((coreValue / total) * 100)}% de la cartera) esté bajo su objetivo del ${c.coreTargetPct}%`);
    else notes.push(`Sin núcleo definido en config/etfs.json: faltan USD ${Math.round(gap)} para el objetivo del ${c.coreTargetPct}%.`);
  }

  /** Lo que entra y todavía espera la revisión antes de comprar: la API la corre y rearma el plan. */
  const pendientes: string[] = [];
  /** Avisos de la verificación y la revisión por símbolo, para la razón de su línea (18/9). */
  const avisosDe = new Map<string, string[]>();
  /** Lo que entra y no tiene la verificación web vigente: la API la corre y rearma el plan. */
  const porVerificar: string[] = [];
  const faltaVerificar = (v: PlanVerification | null | undefined) => v === null || (v !== undefined && v.current === false);

  // 2. SUMAR de Cartera (subponderadas primero), hasta una parte de lo que queda.
  const satellites = i.positions.filter((p) => !isCore(p));
  const equalTarget = satellites.length ? (total * (1 - c.coreTargetPct / 100)) / satellites.length : 0;
  let sumarPool = Math.round((cfg.sumarSharePctOfRest / 100) * remaining);
  for (const s of [...i.sumarCandidates].sort((a, b) => a.weightPct - b.weightPct)) {
    if (remaining < MIN_LINE_USD || sumarPool < MIN_LINE_USD) break;
    // Coherencia (pieza 3): subponderada, pero el ETF de su tema dice OBSERVAR: no se suma y se dice por qué.
    if (s.caution) {
      notes.push(`No se sumó ${s.symbol}: ${s.caution}.`);
      continue;
    }
    const amt = Math.floor(Math.min(remaining, sumarPool, maxLine, Math.max(0, equalTarget - s.valueUsd), capFor(s.symbol)));
    if (amt < MIN_LINE_USD) {
      // Toda exclusión con su motivo: sin esta nota, la fila decía "no está en el plan de hoy" sin decir por qué.
      notes.push(`No se sumó ${s.symbol}: ya tiene su peso (${s.weightPct}% de la cartera, contra ${Math.round((equalTarget / total) * 100)}% igualitario o el tope del ${c.maxPositionPct}%).`);
      continue;
    }
    // Sumar con el precio pegado al stop de la posición es comprar lo que la próxima rueda puede vender (TSM, 14/9). Es
    // una regla fija: va antes que la verificación, para que el motivo que se muestra sea el que vale (15/9).
    const ruido = noiseBlock(i.closes[s.symbol], s.stop, s.atr);
    if (ruido) {
      notes.push(`No se sumó ${s.symbol}: ${ruido}. Su parte (USD ${amt}) va al núcleo.`);
      if (allocateCore(amt, `lo que iba a ${s.symbol}, con el stop dentro del ruido`)) sumarPool -= amt;
      continue;
    }
    // Un SUMAR es una compra: la misma vara que una nueva (13/9). Pendiente en el Radar (null) no avisa: lo decide Cartera.
    const bloqueo = s.verification ? verificationBlock(s.verification) : null;
    if (bloqueo) {
      notes.push(`No se sumó ${s.symbol}: ${bloqueo}. Su parte (USD ${amt}) va al núcleo.`);
      if (allocateCore(amt, `lo que iba a ${s.symbol}, que no pasó la verificación`)) sumarPool -= amt;
      continue;
    }
    // Un SUMAR también es una compra: pasa por la revisión antes de comprar (15/9), que avisa y no frena (18/9).
    // Se suma, y lo que la IA dijo o no pudo cerrar va escrito en la línea y anotado para que corra.
    if (s.verification && faltaVerificar(s.verification)) porVerificar.push(s.symbol);
    if (s.review === null) pendientes.push(s.symbol);
    const avisosSumar = avisosDeIa(s.verification ? s.verification : undefined, s.review);
    lines.push({ ...line(s.symbol, "sumar", amt, [`subponderada (${s.weightPct}% vs ${Math.round((equalTarget / total) * 100)}% igualitario)`, ...avisosSumar.map((a) => `⚠ ${a}`)].join(" · ")), stop: s.stop ?? null, target: s.target ?? null, minPrice: minPriceFor(s.stop, s.atr), ...(avisosSumar.length ? { avisos: avisosSumar } : {}) });
    remaining -= amt;
    sumarPool -= amt;
  }

  // 3. Nuevas: acciones por prioridad (convicción), una de seguimiento, un ETF satélite. Repartidas por convicción (pieza 5).
  const byPriority = (a: PlanInput["buyCandidates"][number], b: PlanInput["buyCandidates"][number]) => (b.priority ?? -Infinity) - (a.priority ?? -Infinity) || (b.score ?? -Infinity) - (a.score ?? -Infinity);
  // Un monto grande admite más posiciones nuevas: una extra por cada 3 aportes mensuales, hasta 5 (repartir 40k en 2 acciones es concentrar).
  const maxNew = maxNewPositions(aporte, c.monthlyUsd, c.maxNewPositionsPerMonth);
  const pools: Array<{ kind: "stock" | "watch" | "etf"; max: number; countsAsNew: boolean }> = [
    { kind: "stock", max: maxNew, countsAsNew: true },
    { kind: "watch", max: cfg.watchLinesMax, countsAsNew: false },
    { kind: "etf", max: cfg.etfLinesMax, countsAsNew: true },
  ];
  const yaEnSumar = new Set(lines.filter((l) => l.kind === "sumar").map((l) => l.symbol));
  // Lo que Cartera propone sumar ya se decidió en el paso 2, entre o no: no se vuelve a evaluar como compra nueva. El
  // 15/9 TSM no se sumaba por QQQ en OBSERVAR y además quedaba afuera "con reservas" como compra: dos motivos distintos.
  const decididoComoSumar = new Set(i.sumarCandidates.map((s) => s.symbol));
  const chosen: PlanInput["buyCandidates"] = [];
  const placeOf = new Map<string, string>();
  /** Todo COMPRAR que no entró, con su lugar en la fila y el motivo: el plan tiene que poder explicarse solo. */
  const leftOut: Array<{ symbol: string; reason: string }> = [];
  const POOL_LABEL: Record<"stock" | "watch" | "etf", string> = { stock: "posiciones nuevas", watch: "de seguimiento", etf: "ETF satélite" };
  let newCount = 0;
  /** Lugares de acciones que quedaron vacíos porque la que los ocupaba quedó afuera (verificación, stop en el ruido o no diversifica) y ninguna la reemplazó. */
  let vacantes = 0;
  /** Prioridad de cada acción que cayó por la verificación, en orden: el lugar vacío pesa lo que pesaba ella. */
  const caidas: Array<number | null> = [];
  for (const pool of pools) {
    let taken = 0;
    const queue = i.buyCandidates.filter((x) => x.kind === pool.kind).sort(byPriority);
    queue.forEach((b, idx) => {
      const place = pool.kind === "stock" ? `${idx + 1}° por convicción` : pool.kind === "watch" ? "seguimiento" : "ETF";
      const isNew = valueOf(b.symbol) === 0;
      // Un símbolo que ya recibió plata como SUMAR no puede recibirla otra vez como compra nueva: TSM el
      // 12/9 salía dos veces en el mismo plan, con dos montos, para una sola posición.
      if (yaEnSumar.has(b.symbol)) {
        // No va a `leftOut`: NO quedó afuera, ya está en el plan como SUMAR. Ponerlo en las dos listas era
        // otra contradicción, y el chequeo entre pantallas la cazó apenas se hizo este arreglo.
        notes.push(`${b.symbol} entró como SUMAR y no se duplica: el Radar también lo tiene en COMPRAR (${place}).`);
        return;
      }
      if (decididoComoSumar.has(b.symbol)) return;
      // Convicción negativa (15/9): el ranking la trae, pero sus salvedades pesan más que sus virtudes. No entra aunque sea
      // la única (PBT era "1° por convicción" con −0,98), y su lugar va al núcleo como el de una verificación que no pasó.
      if (pool.kind === "stock" && b.priority !== null && b.priority < 0) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: convicción negativa (${coma(b.priority, 2).replace("-", "−")}): sus salvedades pesan más que sus virtudes` });
        caidas.push(b.priority);
        return;
      }
      // Primero las reglas fijas y después la verificación web (15/9): el motivo que se muestra tiene que ser el que vale
      // (SNDK decía "verificación pendiente" y la frenaba igual haber subido más de 100%), y verificar lo que una regla
      // frena de todos modos era gastar cuota.
      // Salvedades de precio (pieza 3) y banco sin estados legibles (14/9): tampoco entra como nueva, con el motivo.
      const blocker = (b.flags ?? []).find((f) => PLAN_BLOCKERS[f]);
      if (blocker) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${PLAN_BLOCKERS[blocker]}` });
        return;
      }
      // El stop dentro del ruido (APH, 14/9) o una posición que se mueve como algo que ya tenés (GFI con NEM): no entra,
      // y el lugar no lo toma la siguiente sin verificar ni un ETF: va al núcleo. El ruido se mide contra lo más bajo
      // que se puede pagar, el piso de la franja (15/9: PAM esperaba un retroceso a 81,96–82,79 con el stop en 81,88;
      // medido al cierre de 86,65 pasaba, y su "no por debajo de" 84,22 quedaba arriba del techo: una orden imposible).
      const piso = b.entryLow ?? b.close;
      const ruido = noiseBlock(piso, b.stop, b.atr, b.entryLow !== null && b.entryLow !== undefined && b.entryLow !== b.close ? "el piso de la franja" : "el precio");
      const solapa = isNew && b.overlap && b.overlap.corr >= OVERLAP_BLOCK_CORR ? `se mueve como ${b.overlap.with} que ya tenés (correlación ${coma(b.overlap.corr, 2)}): no diversifica` : null;
      if (ruido || solapa) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${ruido ?? solapa}` });
        if (pool.kind === "stock") caidas.push(b.priority);
        return;
      }
      // Ya está en el tope por posición (PAM 10/9: 15,8% de la cartera): no ocupa un lugar que otro puede usar.
      if (capFor(b.symbol) < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ya está en el tope del ${c.maxPositionPct}% por posición` });
        return;
      }
      // Para lo que ya tenés manda Cartera (18/9): si dice REVISAR o VENDER, el plan no puede decir COMPRAR. Con las
      // compuertas avisando, TSM quedaba "REVISAR: no sumes hasta resolver esto" en Cartera y "COMPRAR USD 4.741" en el plan.
      if (b.cartera && (b.cartera.verb === "REVISAR" || b.cartera.verb === "VENDER")) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ya la tenés y Cartera dice ${b.cartera.verb} (${b.cartera.reason}): no se compra más hasta resolverlo` });
        if (pool.kind === "stock") caidas.push(b.priority);
        return;
      }
      // De la verificación web solo frena "evitar" (18/9). Con reservas, pendiente o con el cuestionario anterior entra,
      // con el aviso escrito en la línea. Los ETFs no se verifican en la web.
      const bloqueo = pool.kind === "etf" ? null : verificationBlock(b.verification);
      if (bloqueo) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: ${bloqueo}` });
        if (pool.kind === "stock") caidas.push(b.priority);
        return;
      }
      // El lugar que dejó una acción que quedó afuera no lo toma un ETF satélite (15/9: CIBR tomaba el de PBT con 8.000 de
      // 40.000): va al núcleo. Un ETF entra solo si no había acciones para ese lugar.
      if (pool.kind === "etf" && vacantes > 0) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: el lugar libre era de una acción que quedó afuera (no pasó la verificación, stop en el ruido, no diversifica o convicción negativa), y esa parte va al núcleo` });
        return;
      }
      if (taken >= pool.max) {
        leftOut.push({ symbol: b.symbol, reason: `${place}: tope de ${pool.max} ${POOL_LABEL[pool.kind]}` });
        return;
      }
      if (pool.countsAsNew && isNew && newCount >= maxNew) {
        leftOut.push({ symbol: b.symbol, reason: vacantes > 0 ? `${place}: el lugar libre era de una acción que quedó afuera (no pasó la verificación, stop en el ruido, no diversifica o convicción negativa), y esa parte va al núcleo` : `${place}: tope de ${maxNew} posiciones nuevas` });
        return;
      }
      // Revisión antes de comprar (15/9), solo sobre lo que va a entrar: no frena (18/9). Pendiente, con objeción o sin
      // poder verificar, entra con el aviso. Los ETFs no se revisan.
      // Entra. Lo que le falta de la IA queda anotado para que corra sola (verificación y revisión) y escrito en la línea.
      if (pool.kind !== "etf") {
        if (faltaVerificar(b.verification)) porVerificar.push(b.symbol);
        if (b.review === null) pendientes.push(b.symbol);
        avisosDe.set(b.symbol, [...avisosDeFila(b.flags), ...avisosDeIa(b.verification, b.review)]);
      }
      chosen.push(b);
      if (pool.kind === "stock") placeOf.set(b.symbol, `${idx + 1}° por convicción de ${queue.length} COMPRAR del Radar`);
      taken++;
      if (pool.countsAsNew && isNew) newCount++;
    });
    // Un lugar que dejó una acción que no pasó la verificación, y que ninguna verificada llenó, no lo toma un ETF ni
    // se reparte entre las demás: cuenta como ocupado y su parte va al núcleo. "¿Qué me asegura que la siguiente esté
    // bien?", preguntó el dueño el 13/9: solo la misma verificación.
    if (pool.kind === "stock") {
      vacantes = Math.min(caidas.length, Math.max(0, pool.max - taken));
      newCount += vacantes;
    }
  }
  if (chosen.length && remaining >= MIN_LINE_USD) {
    // Reparto por convicción (pieza 5): cada acción pesa 1 + su convicción (más convicción, más plata, sin extremos: 1,5 contra 0,6
    // de convicción reparte 62/38, no 71/29); seguimiento y ETF pesan como el promedio de las acciones.
    const stockWeights = chosen.filter((b) => b.kind === "stock" && b.priority !== null).map((b) => 1 + Math.max(0, b.priority!));
    const avg = stockWeights.length ? stockWeights.reduce((s, x) => s + x, 0) / stockWeights.length : 1;
    const weightOf = (b: PlanInput["buyCandidates"][number]) => (b.kind === "stock" && b.priority !== null ? 1 + Math.max(0, b.priority) : avg);
    // Cada lugar vacío pesa lo que pesaba la acción que se fue (así las demás reciben lo mismo que con el lugar
    // lleno) y su parte queda sin repartir: va al núcleo en el paso 4.
    const pesoVacante = caidas.slice(0, vacantes).reduce<number>((s, pr) => s + (pr !== null ? 1 + Math.max(0, pr) : avg), 0);
    const wsum = chosen.reduce((s, b) => s + weightOf(b), 0) + pesoVacante;
    const vacanteUsd = vacantes > 0 ? Math.floor((remaining * pesoVacante) / wsum) : 0;
    if (vacantes > 0) notes.push(`${vacantes === 1 ? "Un lugar" : `${vacantes} lugares`} de posiciones nuevas ${vacantes === 1 ? "quedó vacío" : "quedaron vacíos"}: la acción que lo ocupaba quedó afuera (ver motivo abajo) y ninguna verificada la reemplazó. Esa parte (USD ${miles(vacanteUsd)}) va al núcleo; no se reparte entre las demás ni la toma un ETF.`);
    let used = 0;
    chosen.forEach((b, idx) => {
      const share = idx === chosen.length - 1 && vacantes === 0 ? remaining - used : Math.floor((remaining * weightOf(b)) / wsum);
      const amt = Math.floor(Math.min(share, maxLine, b.sizeUsd ?? share, capFor(b.symbol)));
      if (amt < MIN_LINE_USD) {
        leftOut.push({ symbol: b.symbol, reason: `quedaría con menos de USD ${MIN_LINE_USD} (tope por posición o monto chico)` });
        return;
      }
      const kind: PlanLine["kind"] = b.kind === "watch" ? "seguimiento" : "comprar";
      const base = b.kind === "watch" ? `tu lista de seguimiento, COMPRAR hoy${b.score !== null ? `, score ${b.score}` : ""}` : b.kind === "etf" ? "ETF satélite con fuerza relativa positiva" : `${placeOf.get(b.symbol) ?? "candidato del Radar"}, convicción ${b.priority ?? "—"}${b.score !== null ? `, score ${b.score}` : ""}`;
      const salvedades = [...(b.cautions ?? []), ...(avisosDe.get(b.symbol) ?? [])];
      const why = salvedades.length ? `${base} · ⚠ ${salvedades.join(" · ⚠ ")}` : base;
      const avisos = avisosDe.get(b.symbol) ?? [];
      lines.push({ ...line(b.symbol, kind, amt, why), entryHigh: b.entryHigh ?? null, stop: b.stop ?? null, target: b.target ?? null, priority: b.priority ?? null, entry: b.entry ?? null, minPrice: minPriceFor(b.stop, b.atr), ...(avisos.length ? { avisos } : {}) });
      used += amt;
    });
    remaining -= used;
    if (vacanteUsd > 0) allocateCore(Math.min(vacanteUsd, remaining), `lugares vacíos de acciones que quedaron afuera`);
  } else if (vacantes > 0 && remaining >= 1) {
    // Ninguna acción entró: todo lo de las posiciones nuevas va al núcleo, y la nota lo dice (antes quedaba sin explicar).
    notes.push(`${vacantes === 1 ? "Un lugar" : `${vacantes} lugares`} de posiciones nuevas ${vacantes === 1 ? "quedó vacío" : "quedaron vacíos"}: ${vacantes === 1 ? "la acción que lo ocupaba quedó afuera (ver motivo abajo)" : "las acciones que los ocupaban quedaron afuera (ver motivos abajo)"}. Esa parte (USD ${miles(remaining)}) va al núcleo; no la toma un ETF.`);
    allocateCore(remaining, `lugares vacíos de acciones que quedaron afuera`);
  }
  if (leftOut.length) {
    const shown = leftOut.slice(0, 5).map((x) => `${x.symbol} (${x.reason})`);
    notes.push(`No entraron esta vez: ${shown.join(" · ")}${leftOut.length > 5 ? ` y ${leftOut.length - 5} más (ver detalle)` : ""}.`);
  }
  if (!i.sumarCandidates.length && !i.buyCandidates.length) notes.push("Sin candidatos este mes: el aporte va al núcleo.");

  // 4. Sobrante al núcleo.
  if (remaining >= 1) {
    const ok = allocateCore(remaining, "sobrante del aporte");
    if (!ok) notes.push(`Sin núcleo definido: quedan USD ${remaining} sin asignar.`);
  }
  // Invariante: nada sin salida sale en el plan. Si alguna línea la viola, no se muestra y queda dicho por qué.
  const sinSalida = lines.filter((l) => !lineHasExit(l));
  for (const l of sinSalida) {
    leftOut.push({ symbol: l.symbol, reason: `sin salida definida (no es núcleo y no tiene stop): no entra` });
    notes.push(`Se sacó ${l.symbol} del plan: toda línea que no sea núcleo tiene que tener stop, o es plata que entra y no sale.`);
  }
  const finales = lines.filter(lineHasExit);
  // Cuánta de esta plata se puede ejecutar hoy. Una línea que dice "esperar" tiene asignado un monto que no se
  // gasta hoy: sin decirlo, el plan parece ejecutable entero y el que lo lee termina comprando a mercado igual.
  const esperando = finales.filter((l) => l.entry && (l.entry.state === "esperar_retroceso" || l.entry.state === "esperar_confirmacion"));
  if (esperando.length) {
    const enEspera = Math.round(esperando.reduce((s, l) => s + l.amountUsd, 0));
    // Retroceso: orden limitada en el nivel. Confirmación: el nivel está ARRIBA del precio, así que una limitada se
    // ejecutaría al instante; es una compra si cierra arriba del nivel (15/9: el pie decía "orden limitada" para las dos).
    const detalle = esperando.map((l) => (l.entry!.state === "esperar_retroceso" ? `${l.symbol}: orden limitada en ${l.entry!.level}` : `${l.symbol}: comprar si cierra arriba de ${l.entry!.level}`)).join(", ");
    notes.push(`Hoy se ejecutan USD ${miles(Math.round(aporte) - enEspera)} de USD ${miles(aporte)}. Los otros USD ${miles(enEspera)} esperan su nivel, no van a mercado: ${detalle}. Vale ${esperando[0]!.entry!.validSessions} ruedas; si no se da, esa plata se reasigna en la próxima corrida.`);
  }
  // Una línea elegida puede caerse después (monto chico, sin stop): lo anotado para revisar o verificar son solo las que
  // quedaron. Si no, la app gasta una búsqueda en lo que no compra y la nota contradice a la tabla de afuera (18/9).
  const enElPlan = new Set(finales.map((l) => l.symbol));
  const quedaron = (xs: string[]) => [...new Set(xs)].filter((s) => enElPlan.has(s));
  pendientes.splice(0, pendientes.length, ...quedaron(pendientes));
  porVerificar.splice(0, porVerificar.length, ...quedaron(porVerificar));
  if (pendientes.length) notes.push(`Revisión antes de comprar pendiente: ${pendientes.join(", ")}. Corre sola en los próximos minutos: si encuentra una objeción, queda escrita con ⚠ en la línea y "por qué cambió" lo dice; si querés, esperá a que termine.`);
  const totalNucleo = finales.filter((l) => l.kind === "nucleo").reduce((t, l) => t + l.amountUsd, 0);
  const razonNucleo = `núcleo: recibe USD ${miles(totalNucleo)} de ${miles(aporte)} (${Math.round((totalNucleo / aporte) * 100)}%): ${partesDelNucleo.map((x) => `${x.reason} (USD ${miles(x.amount)})`).join(" + ")}`;
  for (const l of finales) {
    if (l.kind === "nucleo") l.rationale = razonNucleo;
    const base = l.kind === "nucleo" || l.kind === "sumar" ? l.close : (l.entryHigh ?? l.close);
    l.orderPrice = base ?? null;
    l.qty = base ? Math.floor(l.amountUsd / base) : null;
    l.trancheUsd = Math.floor(l.amountUsd / tranches);
    l.trancheQty = base ? Math.floor(l.trancheUsd / base) : null;
  }
  return { month: i.month, totalUsd: aporte, lines: finales, notes, leftOut, tranches, reviewsPending: pendientes, verificationsPending: porVerificar };
}
