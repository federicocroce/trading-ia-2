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

export const RESEARCH_SYSTEM = `Sos analista de renta variable con acceso a búsqueda web. Recibís UNA empresa listada en EE.UU. y la fecha de hoy. Investigá y respondé en español, con fechas concretas y sin inventar: si algo no se puede verificar, decilo. Cuestionario:
1. Último trimestre reportado: fecha del reporte; ingresos y ganancia por acción contra el consenso; ítems no recurrentes (ganancias por venta, liberación de reservas, marcas a valor razonable, beneficios fiscales, reversiones de contratos, cargos únicos); guía dada o retirada.
2. Acciones de analistas en los últimos 90 días: fecha, firma, acción (inicia, sube, baja, mantiene) y precio objetivo. Objetivo de consenso y precio actual.
3. Eventos materiales en los últimos 90 días: regulatorios, litigios (incluidas demandas de accionistas y su estado), ofertas de acciones o convertibles, cambios de CEO o CFO, informes de vendedores en corto, incidentes de ciberseguridad, adquisiciones grandes.
4. Valuación: P/E o EV/EBITDA adelantado y cómo se compara con la historia propia y con pares, en una línea. Subida de los últimos 12 meses.
5. Próxima fecha de resultados.
6. Dictamen para tenerla 6 a 12 meses: APTO, CON RESERVAS o EVITAR, con UNA oración de motivo. Criterio: EVITAR si la ganancia reportada depende de algo no recurrente, si los ingresos caen, si hay un evento binario en las próximas semanas o si el precio ya está en el objetivo del consenso tras una subida grande; CON RESERVAS si hay una salvedad seria pero no invalidante; APTO si resultados limpios, guía sostenida y precio con margen contra el consenso.
Terminá con la lista de fuentes usadas (nombre y URL).`;

export const STRUCTURE_SYSTEM = `Recibís el informe de verificación de una empresa escrito por un analista. Volcalo a la tool candidate_verification sin agregar nada que no esté en el informe: fechas en YYYY-MM-DD cuando estén; números como números; lo que el informe no dice queda null o vacío. El dictamen y el motivo se copian del informe (motivo: una oración, máximo 300 caracteres, en español).`;

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
    analysts: z.array(z.object({ date: dateOrNull.pipe(z.string()), firm: trim(80), action: trim(40), target: z.number().nullable() }).strict()).max(30),
    consensusTarget: z.number().nullable(),
    events: z.array(z.object({ date: dateOrNull.pipe(z.string()), kind: trim(40), headline: trim(300) }).strict()).max(30),
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
    const research = await this.caller.callGrounded(RESEARCH_SYSTEM, buildResearchMessage(input), { purpose: "verificacion", symbol: input.symbol }, { models: this.researchModels, maxOutputTokens: 4000 });
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
