import { QuotaTracker, withRotation } from "./rotation.js";

/** Una herramienta con schema JSON estricto; el modelo está obligado a llamarla. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface GeminiCallerOptions {
  /** GOOGLE_AI_API_KEY_1..4. Al menos una. */
  keys: string[];
  /** Orden de preferencia. La cuota free es por modelo: cada uno suma cuota. */
  models?: string[];
  fetch?: typeof fetch;
  /** Flash 3.x gasta tokens "pensando" antes del function call: dejar margen. */
  maxOutputTokens?: number;
  tracker?: QuotaTracker;
  log?: (msg: string) => void;
  now?: () => number;
}
export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name: string; args: unknown } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { status?: string; message?: string };
}

/**
 * Una llamada a Gemini (REST v1beta, sin SDK) con function call forzado y rotación de modelo+key.
 * Compartido por el razonador de tesis y el narrador de cartera.
 */
export class GeminiToolCaller {
  private readonly keys: string[];
  private readonly models: string[];
  private readonly fetchFn: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly tracker: QuotaTracker;
  private readonly log: (msg: string) => void;
  private readonly now: (() => number) | undefined;

  constructor(o: GeminiCallerOptions) {
    if (!o.keys.length) throw new Error("Gemini: sin keys (GOOGLE_AI_API_KEY_1..4)");
    this.keys = o.keys;
    this.models = o.models ?? DEFAULT_GEMINI_MODELS;
    this.fetchFn = o.fetch ?? fetch;
    this.maxOutputTokens = o.maxOutputTokens ?? 8000;
    this.tracker = o.tracker ?? new QuotaTracker(o.now);
    this.log = o.log ?? (() => {});
    this.now = o.now;
  }

  async call(system: string, user: string, tool: ToolSpec): Promise<{ args: unknown; model: string; usage: string }> {
    const { result, model, keyIndex } = await withRotation({
      models: this.models,
      keys: this.keys,
      tracker: this.tracker,
      log: this.log,
      ...(this.now ? { now: this.now } : {}),
      attempt: (m, key) => this.generate(m, key, system, user, tool),
    });
    this.log(`[gemini] ${model} key#${keyIndex + 1} ok (${result.usage})`);
    return { ...result, model };
  }

  private async generate(model: string, key: string, system: string, user: string, tool: ToolSpec): Promise<{ args: unknown; usage: string }> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: tool.inputSchema }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } },
      generationConfig: { maxOutputTokens: this.maxOutputTokens, temperature: 0.1 },
    };
    const res = await this.fetchFn(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error?.status ?? ""} ${data.error?.message ?? ""}`.trim());
    const call = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall)?.functionCall;
    if (!call) throw new Error(`gemini: sin functionCall (finish=${data.candidates?.[0]?.finishReason ?? "?"})`);
    const u = data.usageMetadata ?? {};
    return { args: call.args, usage: `tokens in/out/think ${u.promptTokenCount ?? "?"}/${u.candidatesTokenCount ?? "?"}/${u.thoughtsTokenCount ?? "?"}` };
  }
}
