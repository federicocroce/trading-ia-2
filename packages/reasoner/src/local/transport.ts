import { NO_USAGE, type UsageRecorder } from "@thesis/core";
import type { CallMeta, ToolSpec } from "../gemini/transport.js";

/**
 * Modelo local (9/10/2026). Un servidor compatible con OpenAI en la misma máquina (llama-server, LM Studio u
 * Ollama) en lugar de Gemini, para lo que no necesita buscar en la web: la ficha, el clasificador de titulares, el
 * narrador de cartera y la tesis.
 *
 * Por qué existe. El plan gratis de Gemini dio 98 llamadas buenas en todo el 9/10, agotadas en la hora siguiente al
 * reinicio de la cuota, contra 83 COMPRAR que necesitaban ficha. La ficha es una compuerta que puede degradar un
 * COMPRAR, y sin cuota no corría (ver `ficha_faltante`). Un modelo local no tiene cuota.
 *
 * La verificación NO viene acá: necesita buscar en la web y la hace el agente de Claude por cron (22/9).
 *
 * Sin caída a Gemini a propósito: si el servidor local no responde, la llamada falla y la fila queda sin ficha,
 * que `ficha_faltante` reporta. Caer a otro modelo en silencio haría que `promptVersion` dijera "local" sobre una
 * ficha de Gemini, que es el aviso falso que se arregló el 8/10.
 */
export interface LocalCallerOptions {
  /** Base del servidor, p. ej. http://127.0.0.1:8091 (sin /v1). */
  url: string;
  /** Nombre que va al registro de uso y al pedido. llama-server lo ignora; LM Studio y Ollama lo usan. */
  model: string;
  maxOutputTokens?: number;
  /** Un modelo local de 35B tarda segundos; un timeout corto lo cortaría a mitad de la ficha. */
  timeoutMs?: number;
  fetch?: typeof fetch;
  recorder?: UsageRecorder;
  log?: (msg: string) => void;
  now?: () => number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string } | string;
}

export class LocalToolCaller {
  private readonly url: string;
  private readonly model: string;
  private readonly maxOutputTokens: number;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly recorder: UsageRecorder;
  private readonly log: (msg: string) => void;
  private readonly now: () => number;

  constructor(o: LocalCallerOptions) {
    if (!o.url) throw new Error("modelo local: falta LOCAL_LLM_URL");
    this.url = o.url.replace(/\/+$/, "");
    this.model = o.model;
    this.maxOutputTokens = o.maxOutputTokens ?? 3000;
    this.timeoutMs = o.timeoutMs ?? 300_000;
    this.fetchFn = o.fetch ?? fetch;
    this.recorder = o.recorder ?? NO_USAGE;
    this.log = o.log ?? (() => {});
    this.now = o.now ?? Date.now;
  }

  /**
   * Misma forma que `GeminiToolCaller.call`: el modelo está obligado a devolver un JSON que cumple el esquema de
   * la herramienta (`response_format` con `json_schema`, que llama-server convierte en gramática). Los argumentos
   * los valida después el mismo parser que valida a Gemini.
   */
  async call(system: string, user: string, tool: ToolSpec, meta: CallMeta = { purpose: "otro" }): Promise<{ args: unknown; model: string; usage: string; callId: string }> {
    const t0 = this.now();
    const row = { source: "local" as const, endpoint: "chat/completions", model: this.model, purpose: meta.purpose, symbol: meta.symbol ?? null };
    const body = {
      model: this.model,
      messages: [
        { role: "system", content: `${system}\n\nDescripción de la herramienta ${tool.name}: ${tool.description}\nRespondé SOLO con el JSON de sus argumentos.` },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name: tool.name, schema: tool.inputSchema, strict: true } },
      temperature: 0.1,
      max_tokens: this.maxOutputTokens,
      // Qwen piensa antes de responder si no se le dice: con la salida atada a un esquema, el pensamiento solo gasta tiempo.
      chat_template_kwargs: { enable_thinking: false },
    };
    let res: Response;
    try {
      res = await this.fetchFn(`${this.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (e) {
      this.recorder.record({ ...row, status: null, result: "error", ms: this.now() - t0 });
      throw new Error(`modelo local: no responde en ${this.url} (${String(e).slice(0, 120)})`);
    }
    const data = (await res.json().catch(() => ({}))) as ChatResponse;
    const tokens = { tokensIn: data.usage?.prompt_tokens ?? null, tokensOut: data.usage?.completion_tokens ?? null, tokensThink: null };
    if (!res.ok) {
      const msg = typeof data.error === "string" ? data.error : (data.error?.message ?? "");
      this.recorder.record({ ...row, ...tokens, status: res.status, result: res.status === 503 ? "saturado" : "error", ms: this.now() - t0 });
      throw new Error(`modelo local: HTTP ${res.status} ${msg}`.trim());
    }
    const text = data.choices?.[0]?.message?.content ?? "";
    const finish = data.choices?.[0]?.finish_reason ?? "?";
    let args: unknown;
    try {
      args = JSON.parse(text);
    } catch {
      this.recorder.record({ ...row, ...tokens, status: res.status, result: "validacion", ms: this.now() - t0 });
      throw new Error(`modelo local: la respuesta no es JSON (finish=${finish}, ${text.length} caracteres)`);
    }
    const callId = this.recorder.record({ ...row, ...tokens, status: res.status, result: "ok", ms: this.now() - t0 });
    const usage = `${tokens.tokensIn ?? "?"} entrada, ${tokens.tokensOut ?? "?"} salida, ${Math.round((this.now() - t0) / 100) / 10} s`;
    this.log(`[local] ${this.model} ok (${usage})`);
    return { args, model: this.model, usage, callId };
  }

  markValidation(callId: string): void {
    if (callId) this.recorder.setResult(callId, "validacion");
  }
}
