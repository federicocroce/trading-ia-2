import { createHash } from "node:crypto";
import type { PreTradeReviewInput, PreTradeReviewResult, PreTradeReviewer } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions } from "./gemini/transport.js";
import { BUSCAR } from "./verifier.js";

/**
 * Revisión antes de comprar (15/9). La verificación es un analista que responde un cuestionario; esta es otra persona
 * que, con la orden en la mano, busca por qué NO comprar hoy. El 14/9 la verificación dio "apto" a GFI sin ver que la
 * licencia de Tarkwa vence en abril de 2027, y a NBN sin ver su inmobiliario comercial. Una sola llamada con búsqueda:
 * la primera línea decide, y la lee el código.
 */
export const REVIEW_SYSTEM = `Sos el último control antes de una compra, con acceso a búsqueda web. Otro analista ya verificó la empresa y dijo que se puede comprar. Tu trabajo NO es repetir su análisis: es buscar razones para NO comprarla hoy. Mirá lo publicado en los últimos 30 días y lo que vence en los próximos 6 meses:
1. Resultados: ganancia explicada por ítems únicos, guía recortada o retirada, advertencias de ganancias.
2. Regulación: licencias, permisos o concesiones que vencen o están en revisión, investigaciones, sanciones, litigios materiales, decisiones judiciales o regulatorias con fecha.
3. Capital: ofertas de acciones o convertibles, ventas grandes de insiders o del accionista de control, cambios de rating de deuda.
4. Analistas: rebajas de recomendación o de objetivo en los últimos 30 días.
5. Noticias de los últimos 7 días que cambien la tesis.
Cada objeción con el dato, la fuente (nombre y URL) y la fecha: sin fuente no es objeción. Una noticia vieja ya conocida o una opinión sin datos no son objeción.

PRIMERA LÍNEA, obligatoria: "REVISIÓN: SIN OBJECIONES — " y una oración, o "REVISIÓN: OBJECIÓN — " y la objeción más importante en una oración, o "REVISIÓN: NO PUDE VERIFICAR — " y qué no pudiste verificar. Después, la lista de objeciones con sus fuentes, en español, como máximo 300 palabras.`;

export const REVISION_RE = /REVISI[ÓO]N:\s*(SIN OBJECIONES|OBJECI[ÓO]N|NO PUDE VERIFICAR)\s*(?:—|–|-|:)?\s*(.*)/i;
export const REVIEW_VERSION = `r1-${createHash("sha256").update(REVIEW_SYSTEM).digest("hex").slice(0, 12)}`;

export function buildReviewMessage(i: PreTradeReviewInput): string {
  const verif = i.verification ? `${i.verification.verdict} (${i.verification.date}): ${i.verification.reason}` : "sin verificación guardada";
  return [
    `# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}`,
    `# Hoy\n${i.today}`,
    `# La orden\n${i.line.kind === "sumar" ? "sumar a una posición que ya tiene" : "compra nueva"}${i.line.close !== null ? `, precio ${i.line.close}` : ""}${i.line.stop !== null ? `, stop ${i.line.stop}` : ""}`,
    `# Lo que dijo la verificación (contrastalo, no lo repitas)\n${verif}`,
    BUSCAR,
    "Buscá razones para no comprarla hoy.",
  ].join("\n\n");
}

/** La primera línea decide. Sin ella no hay revisión: no se inventa un "sin objeciones". */
export function parseReview(text: string): Pick<PreTradeReviewResult, "verdict" | "reason"> {
  const m = REVISION_RE.exec(text);
  if (!m) throw new Error("revisión sin la línea REVISIÓN");
  const k = m[1]!.toUpperCase();
  const verdict = k.startsWith("SIN") ? "sin_objeciones" : k.startsWith("NO PUDE") ? "no_pude_verificar" : "objecion";
  return { verdict, reason: (m[2] ?? "").trim().slice(0, 300) || "sin detalle" };
}

export interface GeminiReviewerOptions extends GeminiCallerOptions {
  /** Modelos para la llamada con búsqueda. */
  reviewModels?: string[];
}

export class GeminiPreTradeReviewer implements PreTradeReviewer {
  readonly promptVersion = `${REVIEW_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  private readonly models: string[];
  constructor(opts: GeminiReviewerOptions) {
    const { reviewModels, ...rest } = opts;
    this.caller = new GeminiToolCaller({ maxOutputTokens: 4000, ...rest });
    // Solo 2.5-flash: con claves gratis es el único modelo con búsqueda de Google (ver `GeminiCandidateVerifier`).
    this.models = reviewModels ?? ["gemini-2.5-flash"];
  }
  async review(input: PreTradeReviewInput): Promise<PreTradeReviewResult> {
    const r = await this.caller.callGrounded(REVIEW_SYSTEM, buildReviewMessage(input), { purpose: "revision_compra", symbol: input.symbol }, { models: this.models, maxOutputTokens: 8_000, thinkingBudget: 1024, requireText: REVISION_RE });
    return { ...parseReview(r.text), sources: r.sources, researchText: r.text, model: r.model };
  }
}
