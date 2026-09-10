import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Card, CardInput, CardWriter } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

/**
 * Ficha de candidato (spec etapa 2 §9). El verdict ya está decidido por reglas; el modelo
 * explica con los números recibidos, sugiere temas de la lista y solo puede degradar a OBSERVAR.
 */
export const CARD_SYSTEM = `Sos analista de renta variable. Recibís UNA empresa candidata con su veredicto ya decidido por reglas (COMPRAR u OBSERVAR), su score fundamental contra pares con el detalle por eje (valuación, calidad, crecimiento, balance), sus métricas y las medianas del grupo, banderas, insiders, consenso, últimas sorpresas de resultados, títulos de filings recientes y la lista de temas permitidos.

Escribí en español, breve y concreto:
- summary: qué hace la empresa, máximo dos oraciones. Para esto sí podés usar lo que sabés de la empresa por su nombre (es información pública y estable); si no la conocés, decilo. Todo lo demás (números, comparaciones, riesgos) sale solo de lo recibido.
- whyRanks: por qué rankea donde rankea, máximo dos oraciones, citando números recibidos y su lugar entre pares.
- mainRisk: el riesgo principal, una oración, basado en datos recibidos (deuda, márgenes, sorpresas negativas, insiders vendiendo, resultados cerca).
- moat: debil, moderado, fuerte o desconocido. Solo fuerte con evidencia en los números (márgenes y ROE muy por encima del grupo de forma sostenida).
- themes: subconjunto de la lista de temas permitidos que apliquen. No inventes temas.
Si recibís "Estados (SEC)": cuando la sección lista ítems extraordinarios, las métricas propias ya están recalculadas con la ganancia núcleo (operativo sin extraordinarios, neto de impuestos); citá el P/E y los márgenes recalculados, nunca los de Finnhub, y si el desvío supera 25% decilo en mainRisk con el ítem que lo causa.
Si recibís "Eventos materiales" con uno grave (rechazo regulatorio, continuidad, reexpresión, delisting), mainRisk tiene que mencionarlo con su fecha; no lo minimices.
No propongas otro verbo. Solo podés pedir degradar (degrade = true) COMPRAR a OBSERVAR si ves deterioro concreto en un filing o dato recibido (recorte de guidance, pérdida material, litigio, dilución, default): degradeReason debe citarlo. Respondé únicamente llamando a la herramienta candidate_card.`;

export const CARD_TOOL: ToolSpec = {
  name: "candidate_card",
  description: "Ficha corta de una empresa candidata: qué hace, por qué rankea, riesgo principal, foso, temas y si hay motivo concreto para degradar a OBSERVAR.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["summary", "whyRanks", "mainRisk", "moat", "themes", "degrade"],
    properties: {
      summary: { type: "string", maxLength: 400 },
      whyRanks: { type: "string", maxLength: 400 },
      mainRisk: { type: "string", maxLength: 300 },
      moat: { type: "string", enum: ["debil", "moderado", "fuerte", "desconocido"] },
      themes: { type: "array", items: { type: "string" } },
      degrade: { type: "boolean" },
      degradeReason: { type: "string", minLength: 10 },
    },
  },
};
export const CARD_VERSION = `c1-${createHash("sha256").update(CARD_SYSTEM).update(JSON.stringify(CARD_TOOL)).digest("hex").slice(0, 12)}`;

const CardSchema = z
  .object({
    summary: z.string().min(1).max(400),
    whyRanks: z.string().min(1).max(400),
    mainRisk: z.string().min(1).max(300),
    moat: z.enum(["debil", "moderado", "fuerte", "desconocido"]),
    themes: z.array(z.string()),
    degrade: z.boolean(),
    degradeReason: z.string().min(10).optional(),
  })
  .strict()
  .refine((c) => !c.degrade || !!c.degradeReason, { message: "degrade exige degradeReason" });

/** Valida la salida del modelo; los temas fuera de la lista se descartan (el modelo no inventa categorías). */
/** Recorta un texto largo del modelo al último fin de oración que entra en `max`; si no hay, corta seco. */
export function trimToLimit(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const cut = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"), head.endsWith(".") ? head.length - 1 : -1);
  return cut >= max * 0.3 ? head.slice(0, cut + 1) : `${head.slice(0, max - 1).trimEnd()}…`;
}

const CARD_LIMITS: Record<string, number> = { summary: 400, whyRanks: 400, mainRisk: 300 };

export function parseCard(args: unknown, themeOptions: string[]): Card {
  // El modelo suele mandar degradeReason: "" cuando no degrada; se trata como ausente.
  const base = args && typeof args === "object" && "degradeReason" in args && !String((args as { degradeReason: unknown }).degradeReason ?? "").trim() ? { ...(args as object), degradeReason: undefined } : args;
  // Y se pasa del largo en los textos: recortar en vez de tirar la llamada (una de cada tres fichas se perdía así).
  const raw = base && typeof base === "object" ? Object.fromEntries(Object.entries(base as Record<string, unknown>).map(([k, v]) => [k, typeof v === "string" && CARD_LIMITS[k] ? trimToLimit(v, CARD_LIMITS[k]!) : v])) : base;
  const c = CardSchema.parse(raw);
  const themes = [...new Set(c.themes)].filter((t) => themeOptions.includes(t));
  return { summary: c.summary, whyRanks: c.whyRanks, mainRisk: c.mainRisk, moat: c.moat, themes, degrade: c.degrade, ...(c.degradeReason ? { degradeReason: c.degradeReason } : {}) };
}

const fmt = (v: number | null | undefined) => (v === null || v === undefined ? "—" : String(v));
const M = (v: number | null) => (v === null ? "—" : `${(v / 1e6).toFixed(1)}M`);
function statementsSection(i: CardInput): string {
  if (!i.quarters?.length) return "# Estados (SEC)\nsin estados: las métricas son de Finnhub y pueden incluir extraordinarios";
  const rows = i.quarters.map((q) => `${q.end}: ingresos ${M(q.revenue)} · operativo ${M(q.operatingIncome)} · neto ${M(q.netIncome)} · flujo operativo ${M(q.operatingCashFlow)}`);
  const c = i.core;
  const items = c?.extraordinaryItems.length ? ` por extraordinarios: ${c.extraordinaryItems.map((e) => `${e.tag} ${M(e.value)} (${e.quarterEnd})`).join(", ")}` : "";
  const deviation = c && c.extraordinaryTTM === 0 ? "sin extraordinarios identificados: las métricas propias son de Finnhub" : `desvío ${c && c.deviationPct !== null ? `${Math.round(c.deviationPct * 100)}%` : "—"}`;
  const ttm = c ? `TTM: ingresos ${M(c.revenueTTM)} · operativo núcleo ${M(c.coreOperatingIncomeTTM)} · neto reportado ${M(c.netIncomeTTM)} · neto núcleo ${M(c.coreNetIncomeTTM)} · EPS núcleo ${c.coreEpsTTM ?? "—"} · ${deviation}${items}` : "TTM: sin núcleo (menos de 4 trimestres completos)";
  return `# Estados (SEC, últimos 4 trimestres)\n${rows.join("\n")}\n${ttm}`;
}

function eventsSection(i: CardInput): string {
  if (!i.events?.length) return "# Eventos materiales (90 días)\n(ninguno detectado en noticias)";
  return `# Eventos materiales (90 días)\n${i.events.map((e) => `- ${e.date} [${e.severity}] ${e.kind}: ${e.headline}`).join("\n")}`;
}

export function buildCardMessage(i: CardInput): string {
  const axes = Object.entries(i.axes).map(([k, v]) => `${k} ${fmt(v)}`).join(" · ");
  const metrics = Object.keys(i.own).map((k) => `${k}: propia ${fmt(i.own[k])} / mediana ${fmt(i.medians[k])}`).join("\n");
  return [
    `# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}\nindustria: ${i.industry ?? "desconocida"} · sector: ${i.sector} · temas actuales: ${i.themes.join(", ") || "(ninguno)"}`,
    `# Veredicto por reglas\n${i.verdict} · score ${i.score} · rank ${i.rankInGroup}/${i.groupSize} entre ${i.basis} (${i.peers.join(", ")})\nejes (z contra el grupo): ${axes}\ncierre ${i.close} · stop ${fmt(i.stop)} · objetivo ${fmt(i.target)} · riesgo ${i.riskScore}/10`,
    `# Métricas (propia / mediana del grupo)\n${metrics}`,
    ...(i.quarters !== undefined ? [statementsSection(i)] : []),
    ...(i.events !== undefined ? [eventsSection(i)] : []),
    `# Banderas\n${i.flags.join(", ") || "(ninguna)"}`,
    `# Insiders 90 días\n${i.insiders ? `compras ${i.insiders.buys}, ventas ${i.insiders.sells}` : "sin dato"}`,
    `# Consenso de analistas\n${i.analyst ? `strongBuy ${i.analyst.strongBuy}, buy ${i.analyst.buy}, hold ${i.analyst.hold}, sell ${i.analyst.sell}, strongSell ${i.analyst.strongSell} (${i.analyst.period})` : "sin dato"}`,
    `# Sorpresas de resultados\n${i.surprises?.length ? i.surprises.map((s) => `${s.period}: ${fmt(s.surprisePercent)}%`).join(", ") : "sin dato"}`,
    `# Filings recientes\n${i.filings.length ? i.filings.map((f) => `- ${f}`).join("\n") : "(ninguno)"}`,
    `# Temas permitidos\n${i.themeOptions.join(", ")}`,
    "Llamá a candidate_card.",
  ].join("\n\n");
}

export class GeminiCardWriter implements CardWriter {
  readonly promptVersion = `${CARD_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  constructor(opts: GeminiCallerOptions) {
    this.caller = new GeminiToolCaller({ maxOutputTokens: 3000, ...opts });
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

export class AnthropicCardWriter implements CardWriter {
  readonly promptVersion = CARD_VERSION;
  private readonly client: Anthropic;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5";
  }
  async write(input: CardInput): Promise<Card> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: CARD_SYSTEM,
      tools: [{ name: CARD_TOOL.name, description: CARD_TOOL.description, input_schema: CARD_TOOL.inputSchema as never }],
      tool_choice: { type: "tool", name: CARD_TOOL.name },
      messages: [{ role: "user", content: buildCardMessage(input) }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("card: sin tool_use");
    return parseCard(call.input, input.themeOptions);
  }
}
