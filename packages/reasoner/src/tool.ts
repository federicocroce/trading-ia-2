import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/** Esquema de la herramienta = ThesisProposal. Mantener en sincronía con @thesis/core (test de paridad). */
export const PROPOSE_TOOL: Tool = {
  name: "propose_thesis",
  description: "Devuelve una tesis de inversión estructurada sobre el evento analizado.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["ticker", "eventType", "eventDate", "direction", "pEstimate", "pMarket", "instrument", "entryMax", "target", "invalidation", "confidence", "reasoning", "sources"],
    properties: {
      ticker: { type: "string" },
      eventType: { type: "string", enum: ["fda", "earnings", "legal", "macro_ar", "operational"] },
      eventDate: { type: ["string", "null"], description: "YYYY-MM-DD o null" },
      direction: { type: "string", enum: ["long", "short"] },
      pEstimate: { type: "number", minimum: 0, maximum: 1 },
      pMarket: { type: "number", minimum: 0, maximum: 1 },
      instrument: { type: "string", enum: ["stock", "call", "put"] },
      entryMax: { type: "number", exclusiveMinimum: 0, description: "Precio máximo de entrada (acción) o prima máxima (opción)" },
      target: { type: "number", exclusiveMinimum: 0, description: "Precio objetivo del subyacente" },
      invalidation: { type: "string", minLength: 20 },
      confidence: { type: "string", enum: ["low", "med", "high"] },
      reasoning: { type: "string", minLength: 50 },
      sources: { type: "array", items: { type: "string" }, minItems: 1 },
    },
  },
};
