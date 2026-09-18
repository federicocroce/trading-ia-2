import { createHash } from "node:crypto";
import { z } from "zod";
import type { CandidateVerifier, VerifierInput, VerifierResult } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

/**
 * Verificación por candidata (spec 2026-09-10): lo que un analista hace antes de comprar, con un cuestionario fijo.
 * Dos llamadas: (1) investigar con búsqueda de Google y devolver texto con fechas y fuentes; (2) estructurar ese texto
 * con una tool estricta. El dictamen lo da el modelo; qué hace la app con él (OBSERVAR, −0.3, fuera del plan) es regla en core.
 */
export const VERDICTS = ["apto", "con_reservas", "evitar"] as const;
/**
 * El informe tiene que traer su dictamen explícito. Sin esta guarda, un informe cortado llegaba igual al
 * estructurador, que devolvía "con reservas" con el motivo "el informe está incompleto" (10/9: LNC, CF, SOLV,
 * SPNT, STNG, HSBC, CTRE quedaron fuera del plan por un artefacto de parseo, no por su negocio).
 */
export const DICTAMEN_RE = /DICTAMEN:\s*(APTO|CON RESERVAS|EVITAR)/i;
/** Un informe completo trae el dictamen arriba y la línea FALTANTES al final (15/9): sin ella, se cortó. */
export const INFORME_COMPLETO_RE = /DICTAMEN:\s*(APTO|CON RESERVAS|EVITAR)[\s\S]*FALTANTES:/i;
const FALTANTES_RE = /^\s*FALTANTES:\s*(.+?)\s*$/im;

export const RESEARCH_SYSTEM = `Sos analista de renta variable con acceso a búsqueda web. Recibís UNA empresa listada en EE.UU. y la fecha de hoy. Investigá y escribí un informe en español de como máximo 600 palabras, con fechas concretas y sin inventar: si algo no se puede verificar, decilo.

PRIMERA LÍNEA, obligatoria, antes de todo lo demás: "DICTAMEN: APTO" o "DICTAMEN: CON RESERVAS" o "DICTAMEN: EVITAR", seguido de " — " y UNA oración con el motivo. Después el cuestionario:
1. Último trimestre reportado: fecha; ingresos contra el consenso (si quedaron por debajo, decilo); ganancia por acción contra el consenso; ítems no recurrentes, sacados del comunicado de resultados de la empresa (o su 8-K o 6-K), no de resúmenes (ganancias por venta o fusión, liberación de reservas, marcas a valor razonable, beneficios o créditos fiscales comprados, reversiones de contratos, cargos únicos) con su monto; la ganancia por acción LIMPIA, sin esos ítems, y si ESA le gana al consenso o solo le ganaba la reportada; guía dada, subida o retirada.
2. Analistas en los últimos 90 días: fecha, firma, acción (inicia, sube, baja, mantiene) y objetivo. Objetivo de consenso y precio actual.
3. Eventos materiales en los últimos 90 días: regulatorios, licencias, permisos o concesiones que vencen o están en revisión (en minería, energía, telecomunicaciones o salud: cuándo vencen y qué dijo el gobierno), litigios (incluidas demandas de accionistas y su estado), investigaciones antimonopolio, ofertas de acciones o convertibles, cambios de CEO o CFO, informes de vendedores en corto, incidentes de ciberseguridad, adquisiciones grandes. Ventas de insiders: quién, monto, qué parte de su tenencia y si son ejercicio de opciones o acciones que ya tenía.
4. Valuación contra la historia propia de 5 años (P/E adelantado; en bancos, precio sobre valor libro tangible; en aseguradoras, precio sobre valor libro sin AOCI): el múltiplo actual y el mínimo y máximo de 5 años, con su fuente, y si está en el tercio superior o en su máximo. Si no encontrás esos números, decí "no encontrado". Contra los pares, en una línea. Subida de los últimos 12 meses.
5. Si es un banco: inmobiliario comercial sobre capital (el regulador mira desde 300% del capital), préstamos sobre depósitos y peso del fondeo mayorista (adelantos del FHLB, depósitos por brokers) y cómo cambió en el año. Si es una aseguradora: ganancia operativa contra la GAAP y qué mueve la diferencia.
6. Próxima fecha de resultados.
7. Fuentes usadas (nombre y URL).

Criterio del dictamen, para tenerla 6 a 12 meses:
- EVITAR: la ganancia reportada se explica por un ítem único (ganancia contable de fusión, venta de activos, beneficio fiscal) y sin él el negocio pierde o apenas gana; ingresos cayendo y guía sin sostén; evento binario en menos de 6 semanas (decisión regulatoria, panel, juicio); precio en o por encima del objetivo del consenso tras una subida mayor al 50% en 12 meses; catalizadores ya consumidos con núcleo débil.
- CON RESERVAS: una salvedad seria que no invalida: la sorpresa del trimestre desaparece sin los ítems no recurrentes (solo si nombrás el ítem, su monto y la fuente, y la ganancia limpia queda en línea o debajo del consenso); valuación en su máximo de 5 años contra su propia historia sin que el crecimiento se acelere (solo con el múltiplo actual y el rango de 5 años del punto 4: sin esos números no es reserva); banco con inmobiliario comercial por encima de 300% del capital y fondeo mayorista creciendo; ganancia de pico de ciclo (fletes, reservas de seguros en temporada benigna); guía que no sube con precios presionados; insiders vendiendo fuerte acciones que ya tenían; cobertura de un solo analista; adquisición apalancada pendiente; demanda de accionistas con moción pendiente.
- APTO: superó y sostuvo o subió la guía, negocio limpio, y precio con margen contra el consenso o valuación por debajo de su historia. NO son reserva por sí solas: una valuación premium que el crecimiento sostiene (28x adelantado con ventas +50% y pedidos +90% es APTO); ventas de directivos por ejercicio de opciones en una empresa que supera y sube la guía; una investigación antimonopolio sobre una operación puntual sin pedido de revertirla; la revisión anual de supuestos de una aseguradora (es rutina de cada tercer trimestre, no un evento binario); una pérdida esperada en una biotech en desarrollo.
No inventes: una reserva vale solo con el dato que la sostiene, y un dato que no encontraste se escribe "no encontrado". Pero no encontrar un dato crítico no es una buena noticia. Datos críticos: (a) la ganancia por acción limpia contra el consenso y los ítems no recurrentes del último trimestre, del comunicado de resultados; (b) la guía; (c) riesgos regulatorios, de licencias, permisos o concesiones, y litigios materiales; (d) ofertas de acciones o convertibles de los últimos 90 días; (e) en bancos, inmobiliario comercial sobre capital y fondeo mayorista. Con un dato crítico sin encontrar, el dictamen no puede ser APTO.
ÚLTIMA LÍNEA, obligatoria: "FALTANTES: ninguno", o "FALTANTES: " seguido de los datos críticos que no encontraste, separados por punto y coma.`;

/** Tipos de salvedad que el cuestionario nombra en su criterio de CON RESERVAS (18/9): el estructurador las lista una por una. */
export const RESERVA_TIPOS = ["valuacion", "extraordinarios", "insiders", "guia", "pico_de_ciclo", "banco", "un_analista", "adquisicion", "demanda", "dato_faltante", "otra"] as const;
export interface Reserva { tipo: (typeof RESERVA_TIPOS)[number]; detalle: string }
/** Los números del punto 4 del cuestionario: el múltiplo contra su propia historia de 5 años. */
export interface ValuationNumbers { metric: string | null; current: number | null; min5y: number | null; max5y: number | null; growthAccelerating: boolean | null }

export const STRUCTURE_SYSTEM = `Recibís el informe de verificación de una empresa escrito por un analista. Volcalo a la tool candidate_verification sin agregar nada que no esté en el informe: fechas en YYYY-MM-DD cuando estén (si un ítem no tiene fecha, date null); números como números; lo que el informe no dice queda null o vacío. El dictamen y el motivo se copian de la primera línea del informe ("DICTAMEN: …"): apto, con_reservas o evitar; motivo: una oración, máximo 300 caracteres, en español. Si el informe está cortado, igual usá el dictamen de la primera línea. reservas: TODAS las salvedades que el informe da como motivo de un dictamen CON RESERVAS o EVITAR, una por entrada (si el motivo une dos con "y", son dos entradas), cada una con su tipo: valuacion (múltiplo alto contra su propia historia), extraordinarios (ítems no recurrentes; la ganancia limpia queda debajo de la reportada), insiders, guia, pico_de_ciclo, banco (inmobiliario comercial o fondeo mayorista), un_analista, adquisicion, demanda (de accionistas), dato_faltante, otra; detalle: la salvedad en una oración con su dato. Con dictamen APTO, lista vacía. valuationNumbers: del punto 4, el múltiplo que el informe compara contra su historia de 5 años: metric (cuál es), current (su valor actual), min5y y max5y (el mínimo y el máximo de 5 años), como números; lo que el informe no da queda null, y un promedio o una mediana NO son ni el mínimo ni el máximo. growthAccelerating: true si el informe dice que el crecimiento de ventas o de ganancias se acelera, false si dice que se frena o está plano, null si no lo dice.`;

export const VERIFY_TOOL: ToolSpec = {
  name: "candidate_verification",
  description: "Verificación web de un candidato: último trimestre, analistas, eventos, valuación, próximos resultados y dictamen.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "reason", "lastQuarter", "analysts", "consensusTarget", "events", "valuation", "nextEarnings", "reservas", "valuationNumbers"],
    properties: {
      verdict: { type: "string", enum: [...VERDICTS] },
      reason: { type: "string", maxLength: 300 },
      lastQuarter: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["reportDate", "revenueVsConsensus", "epsVsConsensus", "oneOffs", "guidance"],
        properties: {
          reportDate: { type: ["string", "null"] },
          revenueVsConsensus: { type: ["string", "null"], maxLength: 200 },
          epsVsConsensus: { type: ["string", "null"], maxLength: 200 },
          oneOffs: { type: "array", items: { type: "string", maxLength: 200 } },
          guidance: { type: ["string", "null"], maxLength: 300 },
        },
      },
      analysts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "firm", "action", "target"],
          properties: { date: { type: "string" }, firm: { type: "string" }, action: { type: "string" }, target: { type: ["number", "null"] } },
        },
      },
      consensusTarget: { type: ["number", "null"] },
      events: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["date", "kind", "headline"], properties: { date: { type: "string" }, kind: { type: "string" }, headline: { type: "string", maxLength: 300 } } },
      },
      valuation: { type: ["string", "null"], maxLength: 300 },
      nextEarnings: { type: ["string", "null"] },
      reservas: {
        type: "array",
        items: { type: "object", additionalProperties: false, required: ["tipo", "detalle"], properties: { tipo: { type: "string", enum: [...RESERVA_TIPOS] }, detalle: { type: "string", maxLength: 200 } } },
      },
      valuationNumbers: {
        type: ["object", "null"],
        additionalProperties: false,
        required: ["metric", "current", "min5y", "max5y", "growthAccelerating"],
        properties: { metric: { type: ["string", "null"], maxLength: 60 }, current: { type: ["number", "null"] }, min5y: { type: ["number", "null"] }, max5y: { type: ["number", "null"] }, growthAccelerating: { type: ["boolean", "null"] } },
      },
    },
  },
};
export const VERIFY_VERSION = `v1-${createHash("sha256").update(RESEARCH_SYSTEM).update(STRUCTURE_SYSTEM).update(JSON.stringify(VERIFY_TOOL)).digest("hex").slice(0, 12)}`;

const trim = (max: number) => z.string().transform((s) => s.trim().slice(0, max));
const dateOrNull = z.string().nullable().transform((s) => {
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s.trim());
  return m ? m[1]! : s.trim().slice(0, 40);
});
const VerificationSchema = z
  .object({
    verdict: z.enum(VERDICTS),
    reason: trim(300).pipe(z.string().min(1)),
    lastQuarter: z
      .object({ reportDate: dateOrNull, revenueVsConsensus: trim(200).nullable(), epsVsConsensus: trim(200).nullable(), oneOffs: z.array(trim(200)).max(12), guidance: trim(300).nullable() })
      .strict()
      .nullable(),
    // Un ítem sin fecha (el modelo no la encontró) se descarta; no invalida la verificación entera (caso DEC 2026-09-10).
    analysts: z.array(z.object({ date: dateOrNull, firm: trim(80), action: trim(40), target: z.number().nullable() }).strict()).max(40).transform((xs) => xs.flatMap((x) => (x.date ? [{ ...x, date: x.date }] : []))),
    consensusTarget: z.number().nullable(),
    events: z.array(z.object({ date: dateOrNull, kind: trim(40), headline: trim(300) }).strict()).max(40).transform((xs) => xs.flatMap((x) => (x.date ? [{ ...x, date: x.date }] : []))),
    valuation: trim(300).nullable(),
    nextEarnings: dateOrNull,
    // Si el modelo los omite, quedan vacíos: un "con reservas" sin lista no se toca (falla cerrado).
    reservas: z.array(z.object({ tipo: z.enum(RESERVA_TIPOS), detalle: trim(200) }).strict()).max(12).default([]),
    valuationNumbers: z.object({ metric: trim(60).nullable(), current: z.number().nullable(), min5y: z.number().nullable(), max5y: z.number().nullable(), growthAccelerating: z.boolean().nullable() }).strict().nullable().default(null),
  })
  .strict();

/** Lo que devuelve el estructurador: la verificación más lo que el código necesita para decidir (no se guarda). */
export type VerificacionEstructurada = Omit<VerifierResult, "sources" | "researchText" | "model"> & { reservas: Reserva[]; valuationNumbers: ValuationNumbers | null };

export function parseVerification(args: unknown): VerificacionEstructurada {
  return VerificationSchema.parse(args);
}

/** Datos críticos que el informe dice no haber encontrado (su línea FALTANTES). `[]` si dice ninguno; null si no la trae. */
export function faltantesDe(text: string): string[] | null {
  const m = FALTANTES_RE.exec(text);
  if (!m) return null;
  const v = m[1]!.replace(/\.$/, "").trim();
  if (/^(ninguno|ninguna|nada|-|—)$/i.test(v)) return [];
  return v.split(";").map((x) => x.trim()).filter(Boolean).slice(0, 8);
}

/**
 * Falla cerrado (15/9): un "apto" con datos críticos sin encontrar, o de un informe que no dice cuáles le faltan, se
 * guarda como "con reservas". Lo decide el código, no el modelo: el 14/9 NBN y GFI salieron "apto" justamente por lo
 * que la verificación no encontró. Con reservas o evitar no cambian: ya frenan.
 */
export function aplicarFaltantes<T extends { verdict: (typeof VERDICTS)[number]; reason: string }>(v: T, faltantes: string[] | null): T {
  if (v.verdict !== "apto") return v;
  if (faltantes === null) return { ...v, verdict: "con_reservas", reason: "el informe no dijo qué datos críticos no encontró: no se puede dar por apta" };
  if (!faltantes.length) return v;
  return { ...v, verdict: "con_reservas", reason: `falta verificar: ${faltantes.join("; ")}`.slice(0, 300) };
}

/** "En su máximo de 5 años": el múltiplo está en el 10% de arriba de su propio rango. Con 0,85 SEZL (87,5%) seguiría con reservas. */
export const UMBRAL_MAXIMO = 0.9;
const coma = (n: number) => String(Math.round(n * 100) / 100).replace(".", ",");

/**
 * El criterio escrito desde el 13/9: es reserva una "valuación en su máximo de 5 años contra su propia historia sin que
 * el crecimiento se acelere (solo con el múltiplo actual y el rango de 5 años: sin esos números no es reserva)".
 */
export function reservaDeValuacionVale(n: ValuationNumbers | null): boolean {
  if (!n || n.current === null || n.min5y === null || n.max5y === null) return false;
  if (!(n.current > 0 && n.min5y > 0 && n.max5y > n.min5y)) return false;
  if (n.growthAccelerating === true) return false;
  return (n.current - n.min5y) / (n.max5y - n.min5y) >= UMBRAL_MAXIMO;
}

const porQueNoVale = (n: ValuationNumbers | null): string => {
  if (!n || n.current === null || n.min5y === null || n.max5y === null || !(n.current > 0 && n.min5y > 0 && n.max5y > n.min5y)) return "sin el múltiplo actual y su rango de 5 años no es reserva";
  const rango = `${n.metric ?? "múltiplo"} ${coma(n.current)}x en un rango de 5 años de ${coma(n.min5y)} a ${coma(n.max5y)}`;
  return (n.current - n.min5y) / (n.max5y - n.min5y) >= UMBRAL_MAXIMO ? `${rango}: está en su máximo pero el crecimiento se acelera, y una valuación premium que el crecimiento sostiene no es reserva` : `${rango}: no está en su máximo`;
};

/**
 * La reserva por valuación la decide el código (18/9). Desde el cuestionario del 15/9 hubo 17 verificaciones y ninguna
 * apta: en 15 el motivo era "valuación en el tercio superior de su historial de 5 años", que no es lo que dice el
 * criterio (APH 29,5x en 22–32,5; NVDA 45x en 25–70, el tercio del medio; CROX debajo de su mediana), y el plan compró
 * cero acciones cuatro días. Es la tercera vez que ese criterio falla por redacción. Solo actúa sobre "con reservas";
 * sin lista de reservas no toca nada (falla cerrado). Corre antes que `aplicarFaltantes`.
 */
export function aplicarValuacion<T extends { verdict: (typeof VERDICTS)[number]; reason: string; reservas: Reserva[]; valuationNumbers: ValuationNumbers | null }>(v: T): T {
  // Con dos reservas de valuación (P/E y valor libro, por ejemplo) los números son de una sola: no se toca.
  if (v.verdict !== "con_reservas" || v.reservas.filter((r) => r.tipo === "valuacion").length !== 1) return v;
  if (reservaDeValuacionVale(v.valuationNumbers)) return v;
  const quedan = v.reservas.filter((r) => r.tipo !== "valuacion");
  const porQue = porQueNoVale(v.valuationNumbers);
  if (!quedan.length) return { ...v, verdict: "apto", reservas: [], reason: `la única reserva era la valuación: ${porQue}`.slice(0, 300) };
  return { ...v, reservas: quedan, reason: `${quedan[0]!.detalle} (la valuación no es reserva: ${porQue})`.slice(0, 300) };
}

/**
 * Versiones guardadas cuyo informe responde el MISMO cuestionario de investigación que el vigente (18/9): cambió el
 * estructurador, no lo que se le pregunta a la web, así que su `researchText` se puede volver a estructurar sin gastar
 * búsquedas. Un test fija el hash de RESEARCH_SYSTEM: si el cuestionario cambia, esta lista se vacía.
 */
export const VERSIONES_MISMO_INFORME: readonly string[] = ["v1-07c33234178c-gemini"];

/**
 * Buscar es obligatorio (15/9): sin los 3.x, la falla más común de 2.5-flash era contestar de memoria (6 de 8 intentos
 * a las 12:15), y esa respuesta se descarta. Va en el pedido y no en el cuestionario: no cambia qué se pregunta, así
 * que no cambia la versión ni obliga a repetir lo ya verificado.
 */
export const BUSCAR = "Usá la búsqueda de Google para cada punto, con datos de este año: una respuesta sin búsquedas se descarta.";

const MESES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/**
 * Búsquedas concretas, en inglés, para empresas listadas en EE.UU. Con la instrucción general sola, 2.5-flash buscó en
 * 1 de cada 4 intentos el 15/9 (PBT nunca): con la lista a la vista, las hace.
 */
/** "2026-09-15" → "September 2026", para las búsquedas en inglés. */
export const mesEnIngles = (today: string) => `${MESES[Number(today.slice(5, 7)) - 1] ?? ""} ${today.slice(0, 4)}`;

export function busquedasPara(symbol: string, today: string, extra: string[] = []): string {
  const anio = today.slice(0, 4);
  const mes = MESES[Number(today.slice(5, 7)) - 1] ?? "";
  const q = [`${symbol} earnings release ${anio}`, `${symbol} guidance ${anio}`, `${symbol} lawsuit OR investigation OR license ${anio}`, `${symbol} analyst price target ${mes} ${anio}`, ...extra];
  return `# Búsquedas que tenés que hacer (como mínimo)\n${q.map((x) => `- "${x}"`).join("\n")}`;
}

export function buildResearchMessage(i: VerifierInput): string {
  return [`# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}`, `# Hoy\n${i.today}`, i.context ? `# Lo que ya sabe la app (contrastalo, no lo repitas)\n${i.context.slice(0, 2000)}` : null, busquedasPara(i.symbol, i.today), BUSCAR, "Respondé el cuestionario."].filter((x): x is string => x !== null).join("\n\n");
}

export interface GeminiVerifierOptions extends GeminiCallerOptions {
  /** Modelos para la llamada con búsqueda (la cuota de búsqueda gratis es más amplia en 2.5 Flash). */
  researchModels?: string[];
}

export class GeminiCandidateVerifier implements CandidateVerifier {
  readonly promptVersion = `${VERIFY_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  private readonly researchModels: string[];
  constructor(opts: GeminiVerifierOptions) {
    const { researchModels, ...rest } = opts;
    this.caller = new GeminiToolCaller({ maxOutputTokens: 4000, ...rest });
    // Solo 2.5-flash (15/9): con claves gratis es el único modelo con búsqueda de Google (500 por día por proyecto);
    // en los 3.x la búsqueda "Not available" y cada intento era un 429 seguro.
    this.researchModels = researchModels ?? ["gemini-2.5-flash"];
  }
  async verify(input: VerifierInput): Promise<VerifierResult> {
    // Presupuesto amplio y pensamiento acotado: el informe de 600 palabras nunca tiene que salir cortado (10/9: 2.5 Flash gastaba 3.800 tokens pensando y dejaba 450 caracteres de informe).
    // El informe tiene que venir entero: dictamen arriba y FALTANTES al final. Uno cortado se descarta y rota.
    const research = await this.caller.callGrounded(RESEARCH_SYSTEM, buildResearchMessage(input), { purpose: "verificacion", symbol: input.symbol }, { models: this.researchModels, maxOutputTokens: 12_000, thinkingBudget: 2048, requireText: INFORME_COMPLETO_RE });
    return this.estructurar(input.symbol, input.today, research);
  }
  /** ¿El informe guardado con esa versión se puede volver a estructurar, sin buscar de nuevo? */
  puedeReestructurar(promptVersion: string, researchText?: string): boolean {
    if (promptVersion === this.promptVersion || !VERSIONES_MISMO_INFORME.includes(promptVersion)) return false;
    // Un informe cortado no se puede re-estructurar nunca: decir que no acá hace que se busque de nuevo, en vez de
    // reintentar en vano hasta que venza.
    return researchText === undefined || INFORME_COMPLETO_RE.test(researchText);
  }
  /** Vuelve a estructurar un informe guardado: una llamada sin búsqueda, y las mismas reglas que una verificación nueva. */
  async reestructurar(i: { symbol: string; today: string; researchText: string; sources: Array<{ title: string; url: string }>; model: string | null }): Promise<VerifierResult> {
    if (!INFORME_COMPLETO_RE.test(i.researchText)) throw new Error(`informe guardado de ${i.symbol} incompleto: no se reestructura`);
    return this.estructurar(i.symbol, i.today, { text: i.researchText, sources: i.sources, model: i.model });
  }
  private async estructurar(symbol: string, today: string, research: { text: string; sources: Array<{ title: string; url: string }>; model: string | null }): Promise<VerifierResult> {
    const r = await this.caller.call(STRUCTURE_SYSTEM, `# Informe (${symbol}, ${today})\n${research.text}`, VERIFY_TOOL, { purpose: "verificacion_estructura", symbol });
    try {
      // Primero la valuación y después los faltantes: un apto que sale de acá también falla cerrado si le faltan datos.
      const { reservas: _r, valuationNumbers: _n, ...parsed } = aplicarFaltantes(aplicarValuacion(parseVerification(r.args)), faltantesDe(research.text));
      return { ...parsed, sources: research.sources, researchText: research.text, model: research.model };
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}
