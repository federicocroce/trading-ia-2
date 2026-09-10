import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { NarratorInput, Note, PositionNarrator } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

/**
 * Narrador de posiciones (spec etapa 1 §6). El verbo ya está decidido por reglas; el modelo
 * escribe el por qué con los números que recibió y solo puede pedir degradar a REVISAR.
 */
export const NARRATOR_SYSTEM = `Sos el analista de una cartera personal. Recibís UNA posición con el veredicto ya decidido por reglas (VENDER / REVISAR / MANTENER / SUMAR), sus números (cierre, stop, objetivo, ganancia, peso), los últimos 30 cierres, títulos de filings recientes, noticias y hechos de riesgo de la cartera.

Tu trabajo: escribir en español, en máximo dos oraciones, POR QUÉ ese veredicto tiene sentido hoy, citando los números que recibiste. No propongas otro verbo. No inventes datos: si algo no está en lo que recibiste, decí que no lo tenés. Nada de "podría", "posiblemente" sin un dato atrás.

Solo podés pedir DEGRADAR (degrade = true) si ves deterioro concreto en un filing o noticia recibidos (recorte de guidance, pérdida material, litigio nuevo, dilución, default). Entonces degradeReason debe citar ese título. Un precio que baja NO es motivo: de eso se ocupa el stop.

Respondé únicamente llamando a la herramienta position_note.`;

export const NOTE_TOOL: ToolSpec = {
  name: "position_note",
  description: "Nota de dos oraciones sobre una posición, y si hay motivo concreto para degradar el veredicto a REVISAR.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["narrative", "degrade"],
    properties: {
      narrative: { type: "string", maxLength: 400 },
      degrade: { type: "boolean" },
      degradeReason: { type: "string", minLength: 10 },
    },
  },
};

export const NARRATOR_VERSION = `n1-${createHash("sha256").update(NARRATOR_SYSTEM).update(JSON.stringify(NOTE_TOOL)).digest("hex").slice(0, 12)}`;

const NoteSchema = z
  .object({ narrative: z.string().min(1).max(400), degrade: z.boolean(), degradeReason: z.string().min(10).optional() })
  .strict()
  .refine((n) => !n.degrade || !!n.degradeReason, { message: "degrade exige degradeReason" });

/** Valida la salida del modelo. Cualquier cosa fuera del schema se rechaza. */
export function parseNote(args: unknown): Note {
  const n = NoteSchema.parse(args);
  return n.degradeReason ? { narrative: n.narrative, degrade: n.degrade, degradeReason: n.degradeReason } : { narrative: n.narrative, degrade: n.degrade };
}

export function buildNarratorMessage(i: NarratorInput): string {
  const p = i.position;
  return [
    `# Posición\n${p.symbol} (${p.market}, capa ${p.layer}): ${p.quantity} a costo ${p.avgCost}`,
    `# Veredicto por reglas\n${i.verb}: ${i.reason}\ncierre ${i.close} · stop ${i.stop ?? "sin stop"} · objetivo ${i.target ?? "—"} · ganancia ${i.gainPct}% · peso ${i.weightPct}%`,
    `# Últimos 30 cierres\n${i.last30.join(", ")}`,
    `# Filings recientes\n${i.filings.length ? i.filings.map((f) => `- ${f}`).join("\n") : "(ninguno)"}`,
    `# Noticias\n${i.news.length ? i.news.map((n) => `- ${n}`).join("\n") : "(ninguna)"}`,
    `# Riesgo de cartera\n${i.riskFacts.map((r) => `- ${r}`).join("\n")}`,
    "Llamá a position_note.",
  ].join("\n\n");
}

export class GeminiNarrator implements PositionNarrator {
  readonly promptVersion = `${NARRATOR_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  constructor(opts: GeminiCallerOptions) {
    this.caller = new GeminiToolCaller({ maxOutputTokens: 2000, ...opts });
  }
  async narrate(input: NarratorInput): Promise<Note> {
    const r = await this.caller.call(NARRATOR_SYSTEM, buildNarratorMessage(input), NOTE_TOOL, { purpose: "narrador", symbol: input.position.symbol });
    try {
      return parseNote(r.args);
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}

export class AnthropicNarrator implements PositionNarrator {
  readonly promptVersion = NARRATOR_VERSION;
  private readonly client: Anthropic;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5";
  }
  async narrate(input: NarratorInput): Promise<Note> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1000,
      system: NARRATOR_SYSTEM,
      tools: [{ name: NOTE_TOOL.name, description: NOTE_TOOL.description, input_schema: NOTE_TOOL.inputSchema as never }],
      tool_choice: { type: "tool", name: NOTE_TOOL.name },
      messages: [{ role: "user", content: buildNarratorMessage(input) }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("narrator: sin tool_use");
    return parseNote(call.input);
  }
}
