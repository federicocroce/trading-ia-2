import type { Reasoner, ThesisProposal } from "@thesis/core";
import { PROMPT_VERSION, buildUserMessage, parseProposal, type BundleWithMarket } from "../shared.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { PROPOSE_TOOL } from "../tool.js";
import { GeminiToolCaller, type GeminiCallerOptions } from "./transport.js";

export { DEFAULT_GEMINI_MODELS } from "./transport.js";

/**
 * Razonador de tesis sobre Gemini (free tier). Reusa system prompt, mensaje de usuario,
 * schema de la tool y validación del razonador de Anthropic; solo cambia el transporte.
 */
export interface GeminiReasonerOptions extends GeminiCallerOptions {
  maxDocChars?: number;
}

export class GeminiReasoner implements Reasoner {
  readonly promptVersion = `${PROMPT_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  private readonly maxDocChars: number;

  constructor(opts: GeminiReasonerOptions) {
    const { maxDocChars, ...caller } = opts;
    this.caller = new GeminiToolCaller(caller);
    this.maxDocChars = maxDocChars ?? 60_000;
  }

  async propose(bundle: BundleWithMarket): Promise<ThesisProposal> {
    const r = await this.caller.call(SYSTEM_PROMPT, buildUserMessage(bundle, this.maxDocChars), {
      name: PROPOSE_TOOL.name,
      description: PROPOSE_TOOL.description ?? "",
      inputSchema: PROPOSE_TOOL.input_schema as Record<string, unknown>,
    }, { purpose: "tesis", symbol: bundle.event.ticker });
    try {
      return parseProposal(r.args, bundle);
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}
