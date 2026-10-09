import type { ContributionPlan, Verb } from "./api";

/**
 * La palabra que ve el dueño para cada símbolo, en TODAS las pantallas (14/9).
 *
 * "Si la app dice comprar yo compro, y no importa en qué pantalla esté." Hasta el 14/9 COMPRAR significaba tres
 * cosas: que pasó los filtros del Radar (Hoy, la tabla de acciones), que rankeaba alto por convicción (la tarjeta de
 * arriba) y que el plan le asignaba plata. Doce acciones decían COMPRAR y el plan compraba dos.
 *
 * Regla única: COMPRAR y SUMAR solo si el símbolo está en el plan vigente, con su monto. Lo que pasa los filtros y no
 * entra es CANDIDATA, con el motivo que da el plan. Ninguna pantalla muestra un veredicto sin pasar por acá.
 */
export type PlanStatus =
  /** `trancheUsd`: el primer tramo, cuando el plan va en tramos (15/9). */
  | { kind: "comprar" | "seguimiento" | "sumar" | "nucleo"; amountUsd: number; trancheUsd?: number; /** Lo que la IA dejó sin cerrar: no frena, se lee al lado (18/9). */ avisos?: string[] }
  | { kind: "fuera"; reason: string }
  /** Está en el plan, pero los controles no dejan ejecutarlo (15/9). */
  | { kind: "frenado"; lineKind: "comprar" | "seguimiento" | "sumar" | "nucleo"; amountUsd: number; reason: string }
  | null;

export interface Instruccion {
  label: "COMPRAR" | "SUMAR" | "NÚCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR" | "ESPERAR";
  /** Clase de color (`verb <tone>` en styles.css). */
  tone: "COMPRAR" | "SUMAR" | "NUCLEO" | "CANDIDATA" | "OBSERVAR" | "MANTENER" | "VENDER" | "REVISAR" | "ESPERAR";
  /** Lo que el dueño necesita leer al lado: el monto o por qué no se compra. */
  detail: string | null;
  /** Cuántos avisos de la IA lleva la línea (18/9): donde la etiqueta va sola, se marca con ⚠. */
  avisos?: number;
}

const usd = (n: number) => `USD ${Math.round(n).toLocaleString("es-AR")}`;
/**
 * Con tramos, el total y el primer tramo (15/9): la tabla de ETFs decía "USD 24.000 en el plan de hoy" y el jueves se
 * compran 8.000. El monto del tramo es el del plan; un plan guardado sin él lo calcula con la misma regla.
 */
const enPlan = (s: { amountUsd: number; trancheUsd?: number; avisos?: string[] }) => [s.trancheUsd !== undefined ? `${usd(s.amountUsd)} en el plan · 1er tramo ${usd(s.trancheUsd)}` : `${usd(s.amountUsd)} en el plan de hoy`, ...(s.avisos ?? []).map((a) => `⚠ ${a}`)].join(" · ");
const conAvisos = (s: { avisos?: string[] }) => (s.avisos?.length ? { avisos: s.avisos.length } : {});
/** "5° por convicción: verificación web con reservas: …" → sin el lugar en la fila, que no le importa a quien lee. */
const sinLugar = (reason: string) => reason.replace(/^(?:\d+° por convicción|seguimiento|ETF): /, "");

type Hallazgo = NonNullable<ContributionPlan["controles"]>["findings"][number];

/**
 * Los errores graves de los controles, partidos según a quién frenan (9/10).
 *
 * Hasta el 9/10 un grave en CUALQUIER símbolo frenaba el plan entero. Ese día el plan compraba MMSI, MCY, JBL, BLX,
 * DXCM, MUSA, FRPT y EME, y lo frenaban ATLC, OPY y UFPT (candidatas que no compraba: el precio en vivo de IEX difería
 * 1,3% del cierre oficial) y TSM y VIST (posiciones, por el precio entre Cartera y Radar). Como en cada refresco
 * aparece algún grave así en una acción chica, el plan no decía "ejecutá" casi nunca. Decisión del dueño: se bloquea
 * solo lo que tiene el error.
 *
 * - `generales`: sin símbolo. No se sabe a qué alcanzan, así que frenan todo.
 * - `deLineas`: de un símbolo que el plan compra. Frenan ESA línea.
 * - `deOtros`: de un símbolo que el plan no compra. No frenan nada; se muestran como alerta.
 */
export function gravesDelPlan(plan: ContributionPlan): { generales: Hallazgo[]; deLineas: Map<string, Hallazgo[]>; deOtros: Hallazgo[] } {
  const enPlan = new Set(plan.lines.map((l) => l.symbol.toUpperCase()));
  const generales: Hallazgo[] = [];
  const deLineas = new Map<string, Hallazgo[]>();
  const deOtros: Hallazgo[] = [];
  for (const f of plan.controles?.findings ?? []) {
    if (f.severity !== "grave") continue;
    const sym = f.symbol?.trim().toUpperCase();
    if (!sym || sym === "*") generales.push(f);
    else if (enPlan.has(sym)) deLineas.set(sym, [...(deLineas.get(sym) ?? []), f]);
    else deOtros.push(f);
  }
  return { generales, deLineas, deOtros };
}

/**
 * Por qué el plan ENTERO no se puede ejecutar ahora, o null si se puede (15/9). La app no dice COMPRAR sobre un plan que
 * sus propios controles no revisaron o no pudieron revisar. El 15/9 el plan decía "comprar NVDA" con NVDA ya en
 * OBSERVAR, y el control que lo detecta existía pero nadie lo corría. Desde el 9/10 un error grave frena todo solo si
 * es general; el de un símbolo frena su línea (`frenoDeLinea`).
 */
export function controlesBloquean(plan: ContributionPlan | null): string | null {
  if (!plan || !plan.lines.length) return null;
  // La revisión antes de comprar ya no frena (18/9): ni pendiente ni con objeción. La línea entra con el aviso escrito y
  // decide el dueño (ver `reviewCaution` en el núcleo). Del 15/9 al 18/9 nunca corrió y todo esperaba.
  const k = plan.controles;
  if (!k || !plan.builtAt || k.planBuiltAt !== plan.builtAt) return "los controles automáticos todavía no revisaron este plan (tardan hasta un minuto)";
  if (k.error) return `los controles no pudieron correr: ${k.error}`;
  const { generales } = gravesDelPlan(plan);
  if (generales.length) return `la app encontró ${generales.length === 1 ? "un error grave general" : `${generales.length} errores graves generales`} en sus propios datos (${generales[0]!.detail})`;
  return null;
}

/** Por qué ESTA línea no se ejecuta (9/10): un error grave en su propio símbolo. null si no tiene. */
export function frenoDeLinea(symbol: string, plan: ContributionPlan | null): string | null {
  if (!plan) return null;
  const propios = gravesDelPlan(plan).deLineas.get(symbol.toUpperCase());
  if (!propios?.length) return null;
  return `error grave en sus datos (${propios[0]!.detail})`;
}

/** El plan de hoy compra este símbolo y nada lo frena: la única condición para decir "comprar ahora" (15/9). */
export function planLoCompra(symbol: string, plan: ContributionPlan | null): boolean {
  const s = planStatusFor(symbol, plan);
  return !!s && (s.kind === "comprar" || s.kind === "seguimiento" || s.kind === "sumar");
}

/** Dónde está el símbolo en el plan: una línea con monto, afuera con motivo, o nada (el plan no lo consideró). */
export function planStatusFor(symbol: string, plan: ContributionPlan | null): PlanStatus {
  if (!plan) return null;
  const sym = symbol.toUpperCase();
  const line = plan.lines.find((l) => l.symbol.toUpperCase() === sym);
  if (line) {
    const freno = controlesBloquean(plan) ?? frenoDeLinea(sym, plan);
    if (freno) return { kind: "frenado", lineKind: line.kind, amountUsd: line.amountUsd, reason: freno };
    const tramos = plan.tranches ?? 1;
    const avisos = line.avisos?.length ? { avisos: line.avisos } : {};
    return tramos > 1 ? { kind: line.kind, amountUsd: line.amountUsd, trancheUsd: line.trancheUsd ?? Math.floor(line.amountUsd / tramos), ...avisos } : { kind: line.kind, amountUsd: line.amountUsd, ...avisos };
  }
  const fuera = plan.leftOut?.find((x) => x.symbol.toUpperCase() === sym);
  if (fuera) return { kind: "fuera", reason: fuera.reason };
  // Un SUMAR que el plan no sumó queda en las notas ("No se sumó TSM: <motivo>. Su parte …").
  const nota = plan.notes.map((n) => new RegExp(`^No se sumó ${sym}: (.+?)(?:\\. Su parte.*)?\\.?$`).exec(n)).find((m) => m !== null);
  return nota ? { kind: "fuera", reason: nota[1]! } : null;
}

/** Veredicto del Radar (COMPRAR/OBSERVAR/NUCLEO) → lo que se muestra. `context` "argentina": ningún plan compra en pesos. */
const esperar = (status: { amountUsd: number; reason: string }): Instruccion => ({ label: "ESPERAR", tone: "ESPERAR", detail: `no ejecutar: ${status.reason}` });

export function instruccionRadar(verdict: string, status: PlanStatus, context?: "argentina"): Instruccion {
  if (verdict === "OBSERVAR") return { label: "OBSERVAR", tone: "OBSERVAR", detail: null };
  if (status && status.kind === "frenado") return esperar(status);
  if (verdict === "NUCLEO") return { label: "NÚCLEO", tone: "NUCLEO", detail: status && status.kind === "nucleo" ? enPlan(status) : null };
  if (status && (status.kind === "comprar" || status.kind === "seguimiento")) return { label: "COMPRAR", tone: "COMPRAR", detail: enPlan(status), ...conAvisos(status) };
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status), ...conAvisos(status) };
  const detail = context === "argentina" ? "el plan en dólares no compra papeles argentinos" : status && status.kind === "fuera" ? `no se compra: ${sinLugar(status.reason)}` : "no está en el plan de hoy";
  return { label: "CANDIDATA", tone: "CANDIDATA", detail };
}

/** Veredicto de Cartera → lo que se muestra. SUMAR solo si el plan lo suma; si no, se mantiene y se dice por qué. */
export function instruccionCartera(verb: Verb, status: PlanStatus): Instruccion {
  if (verb !== "SUMAR") return { label: verb, tone: verb, detail: null };
  if (status && status.kind === "frenado") return esperar(status);
  if (status && status.kind === "sumar") return { label: "SUMAR", tone: "SUMAR", detail: enPlan(status), ...conAvisos(status) };
  return { label: "MANTENER", tone: "MANTENER", detail: status && status.kind === "fuera" ? `no se suma hoy: ${sinLugar(status.reason)}` : "no se suma en el plan de hoy" };
}
