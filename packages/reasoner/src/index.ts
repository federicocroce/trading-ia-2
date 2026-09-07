import Anthropic from "@anthropic-ai/sdk";
import type { Reasoner, ThesisProposal } from "@thesis/core";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { TYPE_GUIDANCE } from "./prompts/byType.js";
import { PROPOSE_TOOL } from "./tool.js";
import { PROMPT_VERSION, buildUserMessage, parseProposal, type BundleWithMarket } from "./shared.js";

export { SYSTEM_PROMPT, TYPE_GUIDANCE, PROPOSE_TOOL };
export { PROMPT_VERSION, buildUserMessage, parseProposal, promptHash, type BundleWithMarket, type MarketContext } from "./shared.js";
export { GeminiReasoner, DEFAULT_GEMINI_MODELS, type GeminiReasonerOptions } from "./gemini/index.js";
export { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";
export { QuotaTracker } from "./gemini/rotation.js";
export * from "./narrator.js";

export interface ReasonerOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Límite de caracteres por documento antes de enviarlo. */
  maxDocChars?: number;
}

export class AnthropicReasoner implements Reasoner {
  readonly promptVersion = PROMPT_VERSION;
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly maxDocChars: number;

  constructor(opts: ReasonerOptions = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-4-5";
    this.maxTokens = opts.maxTokens ?? 4000;
    this.maxDocChars = opts.maxDocChars ?? 60_000;
  }

  async propose(bundle: BundleWithMarket): Promise<ThesisProposal> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: SYSTEM_PROMPT,
      tools: [PROPOSE_TOOL],
      tool_choice: { type: "tool", name: PROPOSE_TOOL.name },
      messages: [{ role: "user", content: buildUserMessage(bundle, this.maxDocChars) }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("reasoner: sin tool_use en la respuesta");
    return parseProposal(call.input, bundle);
  }
}
