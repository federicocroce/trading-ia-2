import { KeyedRateLimiter, NO_USAGE, type UsageRecorder, type UsageResult } from "@thesis/core";
import { GeminiHttpError, QuotaTracker, withRotation } from "./rotation.js";

/** Una herramienta con schema JSON estricto; el modelo está obligado a llamarla. */
export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
export interface GeminiCallerOptions {
  /** GOOGLE_AI_API_KEY_1..4. Al menos una. Cada una es un proyecto distinto: la cuota es por key. */
  keys: string[];
  /** Orden de preferencia. La cuota free es por modelo: cada uno suma cuota. */
  models?: string[];
  fetch?: typeof fetch;
  /** Flash 3.x gasta tokens "pensando" antes del function call: dejar margen. */
  maxOutputTokens?: number;
  /** Compartir el mismo entre todos los llamadores del proceso: lo que aprende uno lo saben todos. */
  tracker?: QuotaTracker;
  /** Freno por minuto por modelo+key, también compartido. Default: uno propio de `rpmPerKey`. */
  pace?: KeyedRateLimiter;
  /** Tope por minuto por modelo+key si no se pasa `pace` (el free tier da 10). */
  rpmPerKey?: number;
  /** Registro de uso: una fila por intento, con tokens y resultado. */
  recorder?: UsageRecorder;
  log?: (msg: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** Qué se le pide al modelo y para qué símbolo: va al registro de uso. */
export interface CallMeta {
  purpose: string;
  symbol?: string | null;
}

export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
export const DEFAULT_RPM_PER_KEY = 8;
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GenerateResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ functionCall?: { name: string; args: unknown }; text?: string; thought?: boolean }> };
    finishReason?: string;
    groundingMetadata?: { webSearchQueries?: string[]; groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>; groundingSupports?: Array<{ groundingChunkIndices?: number[] }> };
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; toolUsePromptTokenCount?: number };
  error?: { status?: string; message?: string; details?: unknown[] };
}

/** Respuesta de una llamada con búsqueda de Google: texto, fuentes citadas y qué buscó. */
export interface GroundedResult {
  text: string;
  sources: Array<{ title: string; url: string }>;
  queries: string[];
  model: string;
  callId: string;
}

/** Lee el detalle del 429 de Google: QuotaFailure.violations[].quotaId (…PerMinute… / …PerDay…) y RetryInfo.retryDelay ("31s"). */
export function parseQuotaDetails(details: unknown[] | undefined, message: string): { quotaKind?: "rpm" | "rpd"; retryDelayMs?: number } {
  let quotaKind: "rpm" | "rpd" | undefined;
  let retryDelayMs: number | undefined;
  const ids: string[] = [];
  for (const d of details ?? []) {
    if (!d || typeof d !== "object") continue;
    const o = d as { violations?: Array<{ quotaId?: string; quotaMetric?: string }>; retryDelay?: string };
    for (const v of o.violations ?? []) ids.push(`${v.quotaId ?? ""} ${v.quotaMetric ?? ""}`);
    if (typeof o.retryDelay === "string") {
      const m = /^([\d.]+)s$/.exec(o.retryDelay.trim());
      if (m) retryDelayMs = Math.ceil(Number(m[1]) * 1000);
    }
  }
  const text = `${ids.join(" ")} ${message}`.toLowerCase();
  if (text.includes("perminute") || text.includes("per minute") || text.includes("per_minute")) quotaKind = "rpm";
  else if (text.includes("perday") || text.includes("per day") || text.includes("per_day") || text.includes("daily")) quotaKind = "rpd";
  return { ...(quotaKind ? { quotaKind } : {}), ...(retryDelayMs !== undefined ? { retryDelayMs } : {}) };
}

/**
 * Una llamada a Gemini (REST v1beta, sin SDK) con function call forzado y rotación de modelo+key.
 * Compartido por el razonador de tesis, la ficha, el clasificador de eventos y el narrador.
 */
export class GeminiToolCaller {
  private readonly keys: string[];
  private readonly models: string[];
  private readonly fetchFn: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly tracker: QuotaTracker;
  private readonly pace: KeyedRateLimiter;
  private readonly recorder: UsageRecorder;
  private readonly log: (msg: string) => void;
  private readonly now: (() => number) | undefined;
  private readonly sleep: ((ms: number) => Promise<void>) | undefined;

  constructor(o: GeminiCallerOptions) {
    if (!o.keys.length) throw new Error("Gemini: sin keys (GOOGLE_AI_API_KEY_1..4)");
    this.keys = o.keys;
    this.models = o.models ?? DEFAULT_GEMINI_MODELS;
    this.fetchFn = o.fetch ?? fetch;
    this.maxOutputTokens = o.maxOutputTokens ?? 8000;
    this.tracker = o.tracker ?? new QuotaTracker(o.now);
    this.pace = o.pace ?? new KeyedRateLimiter(o.rpmPerKey ?? DEFAULT_RPM_PER_KEY, o.now ?? Date.now, o.sleep);
    this.recorder = o.recorder ?? NO_USAGE;
    this.log = o.log ?? (() => {});
    this.now = o.now;
    this.sleep = o.sleep;
  }

  async call(system: string, user: string, tool: ToolSpec, meta: CallMeta = { purpose: "otro" }): Promise<{ args: unknown; model: string; usage: string; callId: string }> {
    const { result, model, keyIndex } = await withRotation({
      models: this.models,
      keys: this.keys,
      tracker: this.tracker,
      log: this.log,
      ...(this.now ? { now: this.now } : {}),
      ...(this.sleep ? { sleep: this.sleep } : {}),
      attempt: (m, key, k) => this.generate(m, key, k, system, user, tool, meta),
    });
    this.log(`[gemini] ${model} key#${keyIndex + 1} ok (${result.usage})`);
    return { ...result, model };
  }

  /** La respuesta llegó pero no pasó la validación: la llamada cuenta como desperdiciada. */
  markValidation(callId: string): void {
    if (callId) this.recorder.setResult(callId, "validacion");
  }

  /**
   * Llamada con la búsqueda de Google integrada (sin function call): el modelo busca, lee y responde en texto.
   * Misma rotación y registro; `models` permite otro orden (la cuota de búsqueda gratis es más amplia en 2.5 Flash).
   */
  async callGrounded(system: string, user: string, meta: CallMeta = { purpose: "otro" }, opts: { models?: string[]; maxOutputTokens?: number; thinkingBudget?: number; requireText?: RegExp } = {}): Promise<GroundedResult> {
    const { result, model, keyIndex } = await withRotation({
      models: opts.models ?? this.models,
      keys: this.keys,
      tracker: this.tracker,
      log: this.log,
      ...(this.now ? { now: this.now } : {}),
      ...(this.sleep ? { sleep: this.sleep } : {}),
      scope: "busqueda",
      attempt: (m, key, k) => this.generateGrounded(m, key, k, system, user, meta, opts.maxOutputTokens ?? this.maxOutputTokens, opts.thinkingBudget, opts.requireText),
    });
    this.log(`[gemini] ${model} key#${keyIndex + 1} ok con búsqueda (${result.usage}; ${result.queries.length} búsquedas, ${result.sources.length} fuentes)`);
    return { text: result.text, sources: result.sources, queries: result.queries, model, callId: result.callId };
  }

  private async generateGrounded(model: string, key: string, keyIndex: number, system: string, user: string, meta: CallMeta, maxOutputTokens: number, thinkingBudget?: number, requireText?: RegExp): Promise<{ text: string; sources: GroundedResult["sources"]; queries: string[]; usage: string; callId: string }> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ google_search: {} }],
      // El pensamiento cuenta dentro de maxOutputTokens: sin tope, 2.5 Flash gastaba el presupuesto pensando y el informe salía cortado.
      generationConfig: { maxOutputTokens, temperature: 0.1, ...(thinkingBudget !== undefined ? { thinkingConfig: { thinkingBudget } } : {}) },
    };
    const { data, res, row, tokens, t0, now } = await this.post(model, key, keyIndex, body, meta);
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text as string).join("").trim();
    const finish = data.candidates?.[0]?.finishReason ?? "?";
    if (!text) {
      this.recorder.record({ ...row, ...tokens, status: res.status, result: "validacion", ms: now() - t0 });
      throw new Error(`gemini: respuesta con búsqueda sin texto (finish=${finish})`);
    }
    if (finish === "MAX_TOKENS") this.log(`[gemini] ${model} key#${keyIndex + 1}: respuesta con búsqueda cortada por maxOutputTokens (${text.length} caracteres)`);
    const gm = data.candidates?.[0]?.groundingMetadata ?? {};
    const sources = (gm.groundingChunks ?? []).flatMap((c) => (c.web?.uri ? [{ title: c.web.title ?? c.web.uri, url: c.web.uri }] : []));
    // Sin fuentes, búsquedas ni atribución, el modelo respondió de memoria (pasa cuando la cuota de búsqueda está
    // agotada o el modelo no la tiene): eso no es una verificación. Se descarta y la rotación prueba otro modelo o clave.
    // La atribución (groundingSupports) la pone el sistema de búsqueda de Google, no el modelo: el 15/9 la mayoría de
    // las respuestas de 2.5-flash traían solo eso, sin la lista de fuentes, con datos del 10-Q de junio de 2026, y
    // la guarda las descartaba todas.
    if (sources.length === 0 && (gm.webSearchQueries ?? []).length === 0 && (gm.groundingSupports ?? []).length === 0) {
      this.recorder.record({ ...row, ...tokens, status: res.status, result: "validacion", ms: now() - t0 });
      throw new Error("gemini: respuesta con búsqueda sin fuentes ni búsquedas (respondió de memoria)");
    }
    // El llamador puede exigir que el texto traiga su conclusión (la verificación exige la línea DICTAMEN):
    // un informe cortado no se acepta, se descarta y la rotación prueba otro modelo o clave.
    if (requireText && !requireText.test(text)) {
      this.recorder.record({ ...row, ...tokens, status: res.status, result: "validacion", ms: now() - t0 });
      throw new Error(`gemini: respuesta con búsqueda incompleta (sin ${requireText.source}, finish=${finish}, ${text.length} caracteres)`);
    }
    const callId = this.recorder.record({ ...row, ...tokens, status: res.status, result: "ok", ms: now() - t0 });
    return { text, sources, queries: gm.webSearchQueries ?? [], usage: this.usageText(data), callId };
  }

  private usageText(data: GenerateResponse): string {
    const u = data.usageMetadata ?? {};
    return `tokens in/out/think ${u.promptTokenCount ?? "?"}/${u.candidatesTokenCount ?? "?"}/${u.thoughtsTokenCount ?? "?"}`;
  }

  /** POST común: registra la fila en fallo (red, HTTP) y devuelve lo necesario para que el llamador registre el éxito. */
  private async post(model: string, key: string, keyIndex: number, body: unknown, meta: CallMeta) {
    await this.pace.acquire(`${model}#${keyIndex}`);
    const now = this.now ?? Date.now;
    const t0 = now();
    const row = { source: "gemini" as const, endpoint: model, model, keyIndex: keyIndex + 1, purpose: meta.purpose, symbol: meta.symbol ?? null };
    let res: Response;
    try {
      res = await this.fetchFn(`${BASE}/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify(body),
      });
    } catch (e) {
      this.recorder.record({ ...row, status: null, result: "error", ms: now() - t0 });
      throw e;
    }
    const data = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok) {
      const message = `HTTP ${res.status} ${data.error?.status ?? ""} ${data.error?.message ?? ""}`.trim();
      const q = res.status === 429 ? parseQuotaDetails(data.error?.details, message) : {};
      // Un 429 sin detalle no es "cuota diaria": el 15/9 eran búsquedas en 3.x, que el plan gratis no tiene, y la
      // pantalla de Uso decía "agotada hoy" con dos llamadas en el día.
      const result: UsageResult = res.status === 429 ? (q.quotaKind === "rpm" ? "rpm" : q.quotaKind === "rpd" ? "rpd" : "limite") : res.status === 503 || res.status === 502 ? "saturado" : "error";
      this.recorder.record({ ...row, status: res.status, result, ms: now() - t0 });
      throw new GeminiHttpError(message, res.status, q.quotaKind, q.retryDelayMs);
    }
    const u = data.usageMetadata ?? {};
    // Con búsqueda, lo que el modelo leyó de la web viaja aparte (toolUsePromptTokenCount): cuenta como entrada.
    const tokens = { tokensIn: u.promptTokenCount === undefined ? null : u.promptTokenCount + (u.toolUsePromptTokenCount ?? 0), tokensOut: u.candidatesTokenCount ?? null, tokensThink: u.thoughtsTokenCount ?? null };
    return { data, res, row, tokens, t0, now };
  }

  private async generate(model: string, key: string, keyIndex: number, system: string, user: string, tool: ToolSpec, meta: CallMeta): Promise<{ args: unknown; usage: string; callId: string }> {
    const body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: tool.inputSchema }] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } },
      generationConfig: { maxOutputTokens: this.maxOutputTokens, temperature: 0.1 },
    };
    const { data, res, row, tokens, t0, now } = await this.post(model, key, keyIndex, body, meta);
    const call = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall)?.functionCall;
    if (!call) {
      this.recorder.record({ ...row, ...tokens, status: res.status, result: "validacion", ms: now() - t0 });
      throw new Error(`gemini: sin functionCall (finish=${data.candidates?.[0]?.finishReason ?? "?"})`);
    }
    const callId = this.recorder.record({ ...row, ...tokens, status: res.status, result: "ok", ms: now() - t0 });
    return { args: call.args, usage: this.usageText(data), callId };
  }
}
