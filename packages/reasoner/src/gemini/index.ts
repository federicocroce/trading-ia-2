import type { Reasoner, ThesisProposal } from "@thesis/core";
import { PROMPT_VERSION, buildUserMessage, parseProposal, type BundleWithMarket } from "../shared.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { PROPOSE_TOOL } from "../tool.js";
import { QuotaTracker, withRotation } from "./rotation.js";

/**
 * Razonador sobre Gemini (free tier) vía REST v1beta, sin SDK: un solo POST por intento.
 * Reusa system prompt, mensaje de usuario, schema de la tool y validación del razonador
 * de Anthropic; solo cambia el transporte y la rotación de modelo+key.
 */
export interface GeminiReasonerOptions {
  /** GOOGLE_AI_API_KEY_1..4. Al menos una. */
  keys: string[];
  /** Orden de preferencia. La cuota free es por modelo: cada uno suma cuota. */
  models?: string[];
  fetch?: typeof fetch;
  /** Flash 3.x gasta tokens "pensando" antes del function call: dejar margen. */
  maxOutputTokens?: number;
  maxDocChars?: number;
  tracker?: QuotaTracker;
  log?: (msg: string) => void;
  now?: () => number;
}

export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; functionCall?: { name: string; args: unknown } }> }; finishReason?: string }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { code?: number; message?: string; status?: string };
}

export class GeminiReasoner implements Reasoner {
  readonly promptVersion = `${PROMPT_VERSION}-gemini`;
  private readonly keys: string[];
  private readonly models: string[];
  private readonly fetchFn: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly maxDocChars: number;
  private readonly tracker: QuotaTracker;
  private readonly log: (msg: string) => void;
  private readonly now: (() => number) | undefined;

  constructor(opts: GeminiReasonerOptions) {
    if (!opts.keys.length) throw new Error("GeminiReasoner: sin keys (GOOGLE_AI_API_KEY_1..4)");
    this.keys = opts.keys;
    this.models = opts.models ?? DEFAULT_GEMINI_MODELS;
    this.fetchFn = opts.fetch ?? fetch;
    this.maxOutputTokens = opts.maxOutputTokens ?? 8000;
    this.maxDocChars = opts.maxDocChars ?? 60_000;
    this.tracker = opts.tracker ?? new QuotaTracker(opts.now);
    this.log = opts.log ?? (() => {});
    this.now = opts.now;
  }

  async propose(bundle: BundleWithMarket): Promise<ThesisProposal> {
    const userMessage = buildUserMessage(bundle, this.maxDocChars);
    const { result, model, keyIndex } = await withRotation({
      models: this.models,
      keys: this.keys,
      tracker: this.tracker,
      log: this.log,
      ...(this.now ? { now: this.now } : {}),
      attempt: (m, key) => this.generate(m, key, userMessage),
    });
    this.log(`[gemini] ${model} key#${keyIndex + 1} ok (${result.usage})`);
    return parseProposal(result.args, bundle);
  }

  private async generate(model: string, key: string, userMessage: string): Promise<{ args: unknown; usage: string }> {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ text: userMessage }] }],
      tools: [{ functionDeclarations: [{ name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description, parametersJsonSchema: PROPOSE_TOOL.input_schema }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [PROPOSE_TOOL.name] } },
      generationConfig: { maxOutputTokens: this.maxOutputTokens, temperature: 0.1 },
    };
    const res = await this.fetchFn(`${BASE}/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error?.status ?? ""} ${data.error?.message ?? ""}`.trim());
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const call = parts.find((p) => p.functionCall)?.functionCall;
    if (!call) throw new Error(`gemini: sin functionCall (finish=${data.candidates?.[0]?.finishReason ?? "?"})`);
    const u = data.usageMetadata ?? {};
    return { args: call.args, usage: `tokens in/out/think ${u.promptTokenCount ?? "?"}/${u.candidatesTokenCount ?? "?"}/${u.thoughtsTokenCount ?? "?"}` };
  }
}
