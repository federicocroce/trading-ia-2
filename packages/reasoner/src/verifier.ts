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

export const RESEARCH_SYSTEM = `Sos analista de renta variable con acceso a búsqueda web. Recibís UNA empresa listada en EE.UU. y la fecha de hoy. Investigá y escribí un informe en español de como máximo 600 palabras, con fechas concretas y sin inventar: si algo no se puede verificar, decilo.

PRIMERA LÍNEA, obligatoria, antes de todo lo demás: "DICTAMEN: APTO" o "DICTAMEN: CON RESERVAS" o "DICTAMEN: EVITAR", seguido de " — " y UNA oración con el motivo. Después el cuestionario:
1. Último trimestre reportado: fecha; ingresos y ganancia por acción contra el consenso; ítems no recurrentes (ganancias por venta o fusión, liberación de reservas, marcas a valor razonable, beneficios fiscales, reversiones de contratos, cargos únicos); guía dada, subida o retirada.
2. Analistas en los últimos 90 días: fecha, firma, acción (inicia, sube, baja, mantiene) y objetivo. Objetivo de consenso y precio actual.
3. Eventos materiales en los últimos 90 días: regulatorios, litigios (incluidas demandas de accionistas y su estado), ofertas de acciones o convertibles, cambios de CEO o CFO, informes de vendedores en corto, incidentes de ciberseguridad, adquisiciones grandes.
4. Valuación: P/E o EV/EBITDA adelantado contra la historia propia y los pares, en una línea. Subida de los últimos 12 meses.
5. Próxima fecha de resultados.
6. Fuentes usadas (nombre y URL).

Criterio del dictamen, para tenerla 6 a 12 meses:
- EVITAR: la ganancia reportada se explica por un ítem único (ganancia contable de fusión, venta de activos, beneficio fiscal) y sin él el negocio pierde o apenas gana; ingresos cayendo y guía sin sostén; evento binario en menos de 6 semanas (decisión regulatoria, panel, juicio); precio en o por encima del objetivo del consenso tras una subida mayor al 50% en 12 meses; catalizadores ya consumidos con núcleo débil.
- CON RESERVAS: una salvedad seria que no invalida: ganancia de pico de ciclo (fletes, reservas de seguros en temporada benigna), guía que no sube con precios presionados, insiders vendiendo fuerte, cobertura de un solo analista, adquisición apalancada pendiente, demanda de accionistas con moción pendiente.
- APTO: superó y sostuvo o subió la guía, negocio limpio, y precio con margen contra el consenso o valuación por debajo de su historia. Una valuación premium NO es reserva si el crecimiento la sostiene (ejemplo: 28x adelantado con ventas +50% y pedidos +90% es APTO). Una pérdida esperada en una biotech en desarrollo tampoco es reserva por sí sola.
Si te faltan datos para un punto, decilo en ese punto; el dictamen igual va en la primera línea.`;

export const STRUCTURE_SYSTEM = `Recibís el informe de verificación de una empresa escrito por un analista. Volcalo a la tool candidate_verification sin agregar nada que no esté en el informe: fechas en YYYY-MM-DD cuando estén (si un ítem no tiene fecha, date null); números como números; lo que el informe no dice queda null o vacío. El dictamen y el motivo se copian de la primera línea del informe ("DICTAMEN: …"): apto, con_reservas o evitar; motivo: una oración, máximo 300 caracteres, en español. Si el informe está cortado, igual usá el dictamen de la primera línea.`;

export const VERIFY_TOOL: ToolSpec = {
  name: "candidate_verification",
  description: "Verificación web de un candidato: último trimestre, analistas, eventos, valuación, próximos resultados y dictamen.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "reason", "lastQuarter", "analysts", "consensusTarget", "events", "valuation", "nextEarnings"],
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
  })
  .strict();

export function parseVerification(args: unknown): Omit<VerifierResult, "sources" | "researchText" | "model"> {
  return VerificationSchema.parse(args);
}

export function buildResearchMessage(i: VerifierInput): string {
  return [`# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}`, `# Hoy\n${i.today}`, i.context ? `# Lo que ya sabe la app (contrastalo, no lo repitas)\n${i.context.slice(0, 2000)}` : null, "Respondé el cuestionario."].filter((x): x is string => x !== null).join("\n\n");
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
    this.researchModels = researchModels ?? ["gemini-2.5-flash", "gemini-3.6-flash", "gemini-3.8-flash"];
  }
  async verify(input: VerifierInput): Promise<VerifierResult> {
    // Presupuesto amplio y pensamiento acotado: el informe de 600 palabras nunca tiene que salir cortado (10/9: 2.5 Flash gastaba 3.800 tokens pensando y dejaba 450 caracteres de informe).
    const research = await this.caller.callGrounded(RESEARCH_SYSTEM, buildResearchMessage(input), { purpose: "verificacion", symbol: input.symbol }, { models: this.researchModels, maxOutputTokens: 12_000, thinkingBudget: 2048, requireText: DICTAMEN_RE });
    const r = await this.caller.call(STRUCTURE_SYSTEM, `# Informe (${input.symbol}, ${input.today})\n${research.text}`, VERIFY_TOOL, { purpose: "verificacion_estructura", symbol: input.symbol });
    try {
      const parsed = parseVerification(r.args);
      return { ...parsed, sources: research.sources, researchText: research.text, model: research.model };
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}
