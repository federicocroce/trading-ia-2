import { describe, expect, it } from "vitest";
import { KeyedRateLimiter, type UsageCallInput, type UsageRecorder, type UsageResult } from "@thesis/core";
import { GeminiHttpError, GeminiToolCaller, QuotaTracker, classifyAttemptError, parseQuotaDetails } from "../src/index.js";

function memRecorder() {
  const rows: Array<UsageCallInput & { id: string }> = [];
  const rec: UsageRecorder & { rows: typeof rows } = {
    rows,
    record(call) {
      const id = `id${rows.length + 1}`;
      rows.push({ ...call, id });
      return id;
    },
    setResult(id, result: UsageResult) {
      const r = rows.find((x) => x.id === id);
      if (r) r.result = result;
    },
  };
  return rec;
}
function fakeFetch(responses: Response[]) {
  const keys: string[] = [];
  const f = (async (_url: string | URL | Request, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get("x-goog-api-key") ?? "");
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, keys };
}
const TOOL = { name: "t", description: "d", inputSchema: { type: "object" } };
const ok = (args: unknown, usage = { promptTokenCount: 1200, candidatesTokenCount: 80, thoughtsTokenCount: 500 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "t", args } }] }, finishReason: "STOP" }], usageMetadata: usage }), { status: 200 });
const text = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] }, finishReason: "MALFORMED_FUNCTION_CALL" }] }), { status: 200 });
const http = (status: number, message: string, details?: unknown[]) => new Response(JSON.stringify({ error: { code: status, message, status: "X", ...(details ? { details } : {}) } }), { status });
const rpm429 = (retryDelay = "3s") => http(429, "You exceeded your current quota", [
  { "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] },
  { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
]);
const rpd429 = () => http(429, "You exceeded your current quota", [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }]);

function mk(responses: Response[], extra: Partial<ConstructorParameters<typeof GeminiToolCaller>[0]> = {}) {
  const ff = fakeFetch(responses);
  const rec = memRecorder();
  const sleeps: number[] = [];
  let now = Date.now();
  // Mismo reloj falso para el transporte y el rastreador: la marca "hasta medianoche PT" se compara contra él.
  const tracker = new QuotaTracker(() => now);
  const caller = new GeminiToolCaller({ keys: ["k0", "k1"], models: ["A", "B"], fetch: ff.fetch, recorder: rec, tracker, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; }, ...extra });
  return { caller, rec, keys: ff.keys, sleeps, tracker, tick: (ms: number) => { now += ms; } };
}

describe("parseQuotaDetails", () => {
  it("lee por minuto y la espera de RetryInfo", () => {
    expect(parseQuotaDetails([{ violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }, { retryDelay: "31s" }], "x")).toEqual({ quotaKind: "rpm", retryDelayMs: 31_000 });
  });
  it("tokens por minuto también es por minuto; por día es rpd; sin detalle no dice nada", () => {
    expect(parseQuotaDetails([{ violations: [{ quotaId: "GenerateContentInputTokensPerModelPerMinute-FreeTier" }] }], "x").quotaKind).toBe("rpm");
    expect(parseQuotaDetails([{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }], "x").quotaKind).toBe("rpd");
    expect(parseQuotaDetails(undefined, "You exceeded your current quota")).toEqual({});
  });
  it("classifyAttemptError: rpm solo con detalle; 429 sin detalle sigue siendo cuota; limit: 0 sigue muerto", () => {
    expect(classifyAttemptError(new GeminiHttpError("HTTP 429 x", 429, "rpm", 3000))).toBe("rpm");
    expect(classifyAttemptError(new GeminiHttpError("HTTP 429 x", 429, "rpd"))).toBe("quota");
    expect(classifyAttemptError(new GeminiHttpError("HTTP 429 x", 429))).toBe("quota");
    expect(classifyAttemptError(new GeminiHttpError("HTTP 429 quota limit: 0", 429, "rpm"))).toBe("muerto");
    expect(classifyAttemptError(new Error("HTTP 503 high demand"))).toBe("retryable");
  });
});

describe("GeminiToolCaller: registro de uso", () => {
  it("una llamada ok deja fila con modelo, clave, propósito, símbolo, tokens y tiempo; markValidation la marca", async () => {
    const { caller, rec } = mk([ok({ a: 1 })]);
    const r = await caller.call("s", "u", TOOL, { purpose: "ficha", symbol: "NVDA" });
    expect(r.args).toEqual({ a: 1 });
    expect(r.model).toBe("A");
    expect(rec.rows).toHaveLength(1);
    expect(rec.rows[0]).toMatchObject({ source: "gemini", endpoint: "A", model: "A", keyIndex: 1, purpose: "ficha", symbol: "NVDA", status: 200, result: "ok", tokensIn: 1200, tokensOut: 80, tokensThink: 500 });
    expect(r.callId).toBe("id1");
    caller.markValidation(r.callId);
    expect(rec.rows[0]!.result).toBe("validacion");
  });
  it("429 por minuto: registra rpm, espera lo que pide Google y reintenta la MISMA clave sin marcarla agotada", async () => {
    const { caller, rec, keys, sleeps, tracker } = mk([rpm429("3s"), ok({ b: 2 })]);
    const r = await caller.call("s", "u", TOOL, { purpose: "eventos" });
    expect(r.args).toEqual({ b: 2 });
    expect(keys).toEqual(["k0", "k0"]);
    expect(sleeps).toEqual([3000]);
    expect(rec.rows.map((x) => x.result)).toEqual(["rpm", "ok"]);
    expect(tracker.isExhausted("A", 0)).toBe(false);
  });
  it("429 por minuto dos veces seguidas: pasa a la siguiente clave, sin marcar el día", async () => {
    const { caller, keys, sleeps, tracker } = mk([rpm429("2s"), rpm429("2s"), ok({ c: 3 })]);
    await caller.call("s", "u", TOOL);
    expect(keys).toEqual(["k0", "k0", "k1"]);
    expect(sleeps).toEqual([2000]);
    expect(tracker.isExhausted("A", 0)).toBe(false);
  });
  it("429 por día: registra rpd y deja la clave fuera hasta el reinicio; la siguiente responde", async () => {
    const { caller, rec, keys, tracker } = mk([rpd429(), ok({ d: 4 })]);
    await caller.call("s", "u", TOOL);
    expect(keys).toEqual(["k0", "k1"]);
    expect(rec.rows.map((x) => x.result)).toEqual(["rpd", "ok"]);
    expect(tracker.isExhausted("A", 0)).toBe(true);
    expect(tracker.isExhausted("A", 1)).toBe(false);
  });
  it("15/9: un 429 sin detalle se registra como 'limite', no como cuota diaria (la pantalla de Uso decía 'agotada hoy')", async () => {
    const { caller, rec } = mk([http(429, "You exceeded your current quota"), ok({ g: 7 })]);
    await caller.call("s", "u", TOOL);
    expect(rec.rows.map((x) => x.result)).toEqual(["limite", "ok"]);
  });
  it("15/9: una búsqueda rechazada con 429 no deja afuera al modelo para las llamadas comunes", async () => {
    // Con claves gratis, los 3.x no tienen búsqueda de Google: el 429 de una verificación dejaba 3.6 y 3.8 fuera hasta
    // la medianoche del Pacífico para TODO (narrador, tesis, fichas), y la app entera cargaba sobre 2.5, saturado.
    const grounded = (t: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: t }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["q"], groundingChunks: [{ web: { uri: "https://x", title: "x" } }] } }] }), { status: 200 });
    const { caller, keys, tracker } = mk([http(429, "You exceeded your current quota"), grounded("con fuentes"), ok({ f: 6 })]);
    await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(tracker.isExhausted("busqueda:A", 0)).toBe(true);
    expect(tracker.isExhausted("A", 0)).toBe(false);
    await caller.call("s", "u", TOOL);
    expect(keys).toEqual(["k0", "k1", "k0"]);
  });
  it("15/9: una respuesta con atribución de Google (groundingSupports) pero sin la lista de fuentes buscó: no es 'de memoria'", async () => {
    // Forma real de las respuestas de 2.5-flash el 15/9 (PBT): 6 fragmentos atribuidos al fragmento 0, con datos del 10-Q
    // de junio de 2026, y sin webSearchQueries ni groundingChunks. La guarda las descartaba todas como "de memoria".
    const soloAtribucion = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "DICTAMEN: CON RESERVAS — x" }] }, finishReason: "STOP", groundingMetadata: { groundingSupports: [{ segment: { startIndex: 0, endIndex: 10, text: "10-Q de junio de 2026" }, groundingChunkIndices: [0] }] } }] }), { status: 200 });
    const { caller, rec } = mk([soloAtribucion]);
    const r = await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(r.text).toContain("DICTAMEN");
    expect(r.sources).toEqual([]);
    expect(rec.rows.map((x) => x.result)).toEqual(["ok"]);
  });
  it("sin atribución, sin búsquedas y sin fuentes sí es de memoria: se descarta", async () => {
    const deMemoria = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "DICTAMEN: APTO — de memoria" }] }, finishReason: "STOP", groundingMetadata: {} }] }), { status: 200 });
    const conFuentes = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["q"] } }] }), { status: 200 });
    const { caller, rec } = mk([deMemoria, conFuentes]);
    await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok"]);
  });
  it("503 registra saturado; respuesta sin functionCall registra validación; el error de red registra error", async () => {
    const { caller, rec } = mk([http(503, "high demand"), text(), ok({ e: 5 })]);
    await caller.call("s", "u", TOOL);
    expect(rec.rows.map((x) => x.result)).toEqual(["saturado", "validacion", "ok"]);
    expect(rec.rows[0]!.status).toBe(503);
    const bad = mk([]);
    await expect(bad.caller.call("s", "u", TOOL)).rejects.toThrow();
    expect(bad.rec.rows.map((x) => [x.status, x.result])).toEqual([[null, "error"], [null, "error"], [null, "error"], [null, "error"]]);
  });
  it("el freno por minuto es por modelo+clave y se comparte si se pasa el mismo", async () => {
    const sleeps: number[] = [];
    let now = 0;
    const pace = new KeyedRateLimiter(1, () => now, async (ms) => { sleeps.push(ms); now += ms; });
    const a = mk([ok({}), ok({})], { pace, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    const b = mk([ok({})], { pace, now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } });
    await a.caller.call("s", "u", TOOL);
    await b.caller.call("s", "u", TOOL); // misma clave A#0 desde otro llamador: espera
    expect(sleeps).toEqual([60_001]);
  });
  it("sin recorder ni tracker sigue funcionando (defaults)", async () => {
    const ff = fakeFetch([ok({ z: 1 })]);
    const caller = new GeminiToolCaller({ keys: ["k0"], models: ["A"], fetch: ff.fetch });
    expect((await caller.call("s", "u", TOOL)).args).toEqual({ z: 1 });
  });
});
