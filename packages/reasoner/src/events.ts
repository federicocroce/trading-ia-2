import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClassifiedEvent, EventClassifier, EventClassifierInput } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

/**
 * Clasificación de titulares (spec verificación §5). El prefiltro por reglas ya eligió qué mandar; el modelo
 * separa grave / moderado / ruido citando el titular. La regla severidad → veredicto vive en core (decideCandidate).
 */
const KINDS = ["regulatorio", "continuidad", "contable", "listado", "guidance", "dilucion", "litigio", "gestion", "analista", "otro"] as const;
const SEVERITIES = ["grave", "moderado", "ruido"] as const;

export const EVENTS_SYSTEM = `Sos analista de renta variable. Recibís UNA empresa y titulares recientes que un prefiltro por palabras clave marcó como posibles eventos materiales negativos. Clasificá cada titular relevante como un evento con severidad:
- grave: la propia empresa recibió un rechazo regulatorio, una complete response letter o un clinical hold sobre un producto principal; duda de continuidad (going concern, quiebra, default); reexpresión de estados, fraude o investigación de la SEC a la empresa; aviso de delisting.
- moderado: recorte de guidance; oferta de acciones o convertibles que diluye; demanda colectiva presentada o investigaciones de estudios de abogados tras una caída; salida del CEO o del CFO; rebaja de calificación de un analista.
- ruido: resúmenes de mercado con varias empresas, notas promocionales, menciones de terceros, noticias que no son sobre esta empresa o que no son negativas.
Reglas: usá solo lo recibido, nunca inferencias ni conocimiento externo; headline se copia idéntico al recibido; kind es el tipo del prefiltro salvo que sea claramente otro; why tiene como máximo 200 caracteres, en español, y cita el titular. Un mismo hecho en varios titulares: un evento por titular. Respondé únicamente llamando a la herramienta material_events.`;

export const EVENTS_TOOL: ToolSpec = {
  name: "material_events",
  description: "Eventos materiales negativos detectados en titulares de una empresa, con severidad y explicación breve.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["events"],
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "kind", "severity", "headline", "why"],
          properties: {
            date: { type: "string" },
            kind: { type: "string", enum: [...KINDS] },
            severity: { type: "string", enum: [...SEVERITIES] },
            headline: { type: "string" },
            why: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  },
};
export const EVENTS_VERSION = `e1-${createHash("sha256").update(EVENTS_SYSTEM).update(JSON.stringify(EVENTS_TOOL)).digest("hex").slice(0, 12)}`;

const EventsSchema = z.object({
  events: z.array(z.object({ date: z.string(), kind: z.enum(KINDS), severity: z.enum(SEVERITIES), headline: z.string().min(1), why: z.string().min(1).max(200) }).strict()),
}).strict();

const norm = (s: string) => s.trim().toLowerCase();

/** Fail-closed: un evento cuyo titular no vino en la entrada se descarta; fecha, URL y fuente salen del ítem recibido, no del modelo. */
export function parseMaterialEvents(args: unknown, input: EventClassifierInput): ClassifiedEvent[] {
  const parsed = EventsSchema.parse(args);
  const out: ClassifiedEvent[] = [];
  for (const e of parsed.events) {
    const item = input.items.find((i) => norm(i.headline) === norm(e.headline));
    if (!item) continue;
    out.push({ date: item.date, kind: e.kind, severity: e.severity, headline: item.headline, url: item.url, source: item.source, why: e.why });
  }
  return out;
}

export function buildEventsMessage(i: EventClassifierInput): string {
  const items = i.items.map((x) => `- ${x.date} · ${x.source ?? "sin fuente"} · prefiltro: ${x.kind}\n  titular: ${x.headline}${x.summary ? `\n  resumen: ${x.summary.slice(0, 300)}` : ""}`);
  return [`# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}`, `# Titulares (${i.items.length})\n${items.join("\n")}`, "Llamá a material_events."].join("\n\n");
}

export class GeminiEventClassifier implements EventClassifier {
  readonly promptVersion = `${EVENTS_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  constructor(opts: GeminiCallerOptions) {
    this.caller = new GeminiToolCaller({ maxOutputTokens: 3000, ...opts });
  }
  async classify(input: EventClassifierInput): Promise<ClassifiedEvent[]> {
    const { args } = await this.caller.call(EVENTS_SYSTEM, buildEventsMessage(input), EVENTS_TOOL);
    return parseMaterialEvents(args, input);
  }
}

export class AnthropicEventClassifier implements EventClassifier {
  readonly promptVersion = EVENTS_VERSION;
  private readonly client: Anthropic;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5";
  }
  async classify(input: EventClassifierInput): Promise<ClassifiedEvent[]> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: EVENTS_SYSTEM,
      tools: [{ name: EVENTS_TOOL.name, description: EVENTS_TOOL.description, input_schema: EVENTS_TOOL.inputSchema as never }],
      tool_choice: { type: "tool", name: EVENTS_TOOL.name },
      messages: [{ role: "user", content: buildEventsMessage(input) }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("events: sin tool_use");
    return parseMaterialEvents(call.input, input);
  }
}
