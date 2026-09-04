import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { ThesisProposal, impliedProbability, type DocumentBundle, type ImpliedMove, type Reasoner } from "@thesis/core";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import { TYPE_GUIDANCE } from "./prompts/byType.js";
import { PROPOSE_TOOL } from "./tool.js";

export { SYSTEM_PROMPT, TYPE_GUIDANCE, PROPOSE_TOOL };

export interface ReasonerOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
  /** Límite de caracteres por documento antes de enviarlo. */
  maxDocChars?: number;
}

/** Datos de mercado que el pipeline adjunta al bundle (opcionales). */
export interface MarketContext {
  spot: number | null;
  impliedMove: ImpliedMove | null;
}

export type BundleWithMarket = DocumentBundle & { market?: MarketContext };

/** Hash estable del prompt: cambia si cambia system, guía por tipo o el tool. */
export function promptHash(): string {
  const h = createHash("sha256");
  h.update(SYSTEM_PROMPT);
  h.update(JSON.stringify(TYPE_GUIDANCE));
  h.update(JSON.stringify(PROPOSE_TOOL));
  return h.digest("hex").slice(0, 12);
}

export const PROMPT_VERSION = `v1-${promptHash()}`;

/** Construye el user message. Puro, testeable sin red. */
export function buildUserMessage(bundle: BundleWithMarket, maxDocChars = 60_000): string {
  const { event, documents, comparables, market } = bundle;
  const parts: string[] = [];
  parts.push(`# Evento\nticker: ${event.ticker}\ntipo: ${event.eventType}\nfecha: ${event.eventDate ?? "sin fecha"}\ntítulo: ${event.title}\nref: ${event.source}:${event.sourceRef}\npayload: ${JSON.stringify(event.payload).slice(0, 2000)}`);
  parts.push(`# Guía para este tipo\n${TYPE_GUIDANCE[event.eventType]}`);
  if (market) {
    const m: string[] = [`spot: ${market.spot ?? "n/a"}`];
    if (market.impliedMove) {
      const im = market.impliedMove;
      m.push(`move implícito (straddle ATM ${im.expiration}): ±${(im.impliedMovePct * 100).toFixed(1)}% (straddle ${im.straddle.toFixed(2)})`);
      const grid = [-0.3, -0.2, -0.1, 0.1, 0.2, 0.3].map((r) => {
        const target = im.spot * (1 + r);
        const p = impliedProbability({ spot: im.spot, target, impliedMovePct: im.impliedMovePct, direction: r > 0 ? "long" : "short" });
        return `  ${r > 0 ? "+" : ""}${(r * 100).toFixed(0)}% (${target.toFixed(2)}): pMarket=${p.toFixed(3)}`;
      });
      m.push(`probabilidad implícita de alcanzar cada objetivo (usá esta tabla para pMarket):\n${grid.join("\n")}`);
    } else {
      m.push("sin cadena de opciones: estimá pMarket explícitamente.");
    }
    parts.push(`# Mercado\n${m.join("\n")}`);
  }
  if (comparables.length) {
    const rows = comparables.slice(0, 30).map((c) => {
      const t = c.thesis;
      return `- ${t.ticker} ${t.eventDate ?? ""} ${t.direction} pEst=${t.pEstimate} pMkt=${t.pMarket} → ${c.outcome.predictedOutcomeHappened ? "ACERTÓ" : "FALLÓ"} pnl=${c.outcome.pnlPct.toFixed(1)}%`;
    });
    const hits = comparables.filter((c) => c.outcome.predictedOutcomeHappened).length;
    parts.push(`# Comparables (${comparables.length}, tasa de acierto ${(100 * hits / comparables.length).toFixed(0)}%)\n${rows.join("\n")}`);
  } else {
    parts.push("# Comparables\nSin historial para este tipo de evento. Sé conservador con pEstimate.");
  }
  for (const d of documents) {
    parts.push(`# Documento: ${d.title}\nref: ${d.ref}\n\n${d.text.slice(0, maxDocChars)}`);
  }
  parts.push("Llamá a `propose_thesis` con tu tesis.");
  return parts.join("\n\n");
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

/** Valida la salida del LLM y fuerza pMarket desde opciones cuando existe (auditable). */
export function parseProposal(input: unknown, bundle: BundleWithMarket): ThesisProposal {
  const p = ThesisProposal.parse(input);
  if (p.ticker.toUpperCase() !== bundle.event.ticker.toUpperCase() && bundle.event.eventType !== "macro_ar") {
    throw new Error(`reasoner: ticker ${p.ticker} no coincide con el evento ${bundle.event.ticker}`);
  }
  const im = bundle.market?.impliedMove;
  if (im && bundle.event.eventType !== "macro_ar") {
    const pm = impliedProbability({ spot: im.spot, target: p.target, impliedMovePct: im.impliedMovePct, direction: p.direction });
    if (Number.isFinite(pm)) return { ...p, pMarket: Number(pm.toFixed(4)) };
  }
  return p;
}
