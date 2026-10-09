import type { Card, CardInput, CardWriter, ClassifiedEvent, EventClassifier, EventClassifierInput, Note, NarratorInput, PositionNarrator, Reasoner, ThesisProposal } from "@thesis/core";
import { CARD_SYSTEM, CARD_TOOL, CARD_VERSION, buildCardMessage, parseCard } from "../card.js";
import { EVENTS_SYSTEM, EVENTS_TOOL, EVENTS_VERSION, buildEventsMessage, parseMaterialEvents } from "../events.js";
import { NARRATOR_SYSTEM, NARRATOR_VERSION, NOTE_TOOL, buildNarratorMessage, parseNote } from "../narrator.js";
import { SYSTEM_PROMPT } from "../prompts/system.js";
import { PROMPT_VERSION, buildUserMessage, parseProposal, type BundleWithMarket } from "../shared.js";
import { PROPOSE_TOOL } from "../tool.js";
import { LocalToolCaller, type LocalCallerOptions } from "./transport.js";

export { LocalToolCaller, type LocalCallerOptions } from "./transport.js";

/**
 * Las cuatro piezas que no buscan en la web, con el mismo prompt, la misma herramienta y el mismo parser que las de
 * Gemini. Lo único que cambia es quién responde, y eso queda en `promptVersion` (sufijo `-local`), para que una
 * fila diga con qué modelo se escribió su ficha.
 */
export class LocalCardWriter implements CardWriter {
  readonly promptVersion = `${CARD_VERSION}-local`;
  private readonly caller: LocalToolCaller;
  constructor(opts: LocalCallerOptions) {
    this.caller = new LocalToolCaller({ maxOutputTokens: 3000, ...opts });
  }
  async write(input: CardInput): Promise<Card> {
    const r = await this.caller.call(CARD_SYSTEM, buildCardMessage(input), CARD_TOOL, { purpose: "ficha", symbol: input.symbol });
    try {
      return parseCard(r.args, input.themeOptions);
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}

export class LocalEventClassifier implements EventClassifier {
  readonly promptVersion = `${EVENTS_VERSION}-local`;
  private readonly caller: LocalToolCaller;
  constructor(opts: LocalCallerOptions) {
    this.caller = new LocalToolCaller(opts);
  }
  async classify(input: EventClassifierInput): Promise<ClassifiedEvent[]> {
    const r = await this.caller.call(EVENTS_SYSTEM, buildEventsMessage(input), EVENTS_TOOL, { purpose: "eventos", symbol: input.symbol });
    try {
      return parseMaterialEvents(r.args, input);
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}

export class LocalNarrator implements PositionNarrator {
  readonly promptVersion = `${NARRATOR_VERSION}-local`;
  private readonly caller: LocalToolCaller;
  constructor(opts: LocalCallerOptions) {
    this.caller = new LocalToolCaller({ maxOutputTokens: 2000, ...opts });
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

export class LocalReasoner implements Reasoner {
  readonly promptVersion = `${PROMPT_VERSION}-local`;
  private readonly caller: LocalToolCaller;
  private readonly maxDocChars: number;
  constructor(opts: LocalCallerOptions & { maxDocChars?: number }) {
    const { maxDocChars, ...caller } = opts;
    this.caller = new LocalToolCaller({ maxOutputTokens: 4000, ...caller });
    this.maxDocChars = maxDocChars ?? 60_000;
  }
  async propose(bundle: BundleWithMarket): Promise<ThesisProposal> {
    const r = await this.caller.call(SYSTEM_PROMPT, buildUserMessage(bundle, this.maxDocChars), { name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description ?? "", inputSchema: PROPOSE_TOOL.input_schema as Record<string, unknown> }, { purpose: "tesis", symbol: bundle.event.ticker });
    try {
      return parseProposal(r.args, bundle);
    } catch (e) {
      this.caller.markValidation(r.callId);
      throw e;
    }
  }
}
