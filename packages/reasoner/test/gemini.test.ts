import { describe, expect, it } from "vitest";
import { GeminiReasoner, PROPOSE_TOOL, SYSTEM_PROMPT, buildUserMessage, type BundleWithMarket } from "../src/index.js";

const bundle: BundleWithMarket = {
  event: { id: "e", ticker: "XXXX", eventType: "earnings", source: "earnings_calendar", eventDate: "2026-09-20", sourceRef: "r", title: "Earnings", payload: {}, observedAt: "2026-09-04T00:00:00Z" },
  documents: [{ ref: "edgar:1", title: "10-Q", text: "texto ".repeat(100) }],
  comparables: [],
  market: { spot: 10, impliedMove: { ticker: "XXXX", expiration: "2026-09-25", spot: 10, straddle: 1, impliedMovePct: 0.1 } },
};

const proposal = {
  ticker: "XXXX", eventType: "earnings", eventDate: "2026-09-20", direction: "long", pEstimate: 0.6, pMarket: 0.4, instrument: "stock",
  entryMax: 10.2, target: 11, invalidation: "Preanuncio negativo de guidance antes del reporte.", confidence: "med",
  reasoning: "Razonamiento suficientemente largo para pasar la validación mínima de cincuenta caracteres.", sources: ["edgar:1"],
};

interface Captured { url: string; key: string | null; body: any }

/** fetch falso: devuelve las respuestas en orden y captura cada request. */
function fakeFetch(responses: Response[]) {
  const calls: Captured[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(url), key: headers.get("x-goog-api-key"), body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const okCall = (args: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "propose_thesis", args } }] }, finishReason: "STOP" }] }), { status: 200 });
const okText = () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no puedo" }] }, finishReason: "STOP" }] }), { status: 200 });
const httpError = (status: number, message: string) => new Response(JSON.stringify({ error: { code: status, message, status: "X" } }), { status });

const mk = (responses: Response[], extra: Partial<ConstructorParameters<typeof GeminiReasoner>[0]> = {}) => {
  const ff = fakeFetch(responses);
  const r = new GeminiReasoner({ keys: ["k0", "k1"], models: ["gemini-3.8-flash", "gemini-2.5-flash"], fetch: ff.fetch, ...extra });
  return { r, calls: ff.calls };
};

describe("GeminiReasoner", () => {
  it("sin keys no se construye", () => {
    expect(() => new GeminiReasoner({ keys: [] })).toThrow(/GOOGLE_AI_API_KEY/);
  });

  it("promptVersion distingue las tesis de Gemini de las de Claude", () => {
    expect(mk([]).r.promptVersion).toMatch(/^v1-[0-9a-f]{12}-gemini$/);
  });

  it("manda system prompt, mensaje de usuario y el schema de la tool tal cual, con function call forzado", async () => {
    const { r, calls } = mk([okCall(proposal)], { maxDocChars: 50 });
    await r.propose(bundle);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(c.key).toBe("k0");
    expect(c.body.systemInstruction.parts[0].text).toBe(SYSTEM_PROMPT);
    expect(c.body.contents[0].parts[0].text).toBe(buildUserMessage(bundle, 50));
    expect(c.body.tools[0].functionDeclarations[0]).toEqual({ name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description, parametersJsonSchema: PROPOSE_TOOL.input_schema });
    expect(c.body.toolConfig.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["propose_thesis"] });
  });

  it("devuelve la propuesta validada con pMarket forzado desde opciones", async () => {
    const p = await mk([okCall(proposal)]).r.propose(bundle);
    expect(p.ticker).toBe("XXXX");
    expect(p.pMarket).toBeCloseTo(0.17, 2);
  });

  it("503 rota a la siguiente key del mismo modelo", async () => {
    const { r, calls } = mk([httpError(503, "This model is currently experiencing high demand"), okCall(proposal)]);
    await r.propose(bundle);
    expect(calls.map((c) => c.key)).toEqual(["k0", "k1"]);
    expect(calls.every((c) => c.url.includes("gemini-3.8-flash"))).toBe(true);
  });

  it("429 de cuota deja esa key fuera de la próxima llamada", async () => {
    const { r, calls } = mk([httpError(429, "RESOURCE_EXHAUSTED: quota exceeded"), okCall(proposal), okCall(proposal)]);
    await r.propose(bundle);
    await r.propose(bundle);
    expect(calls.map((c) => c.key)).toEqual(["k0", "k1", "k1"]);
  });

  it("respuesta sin functionCall pasa al siguiente intento", async () => {
    const { r, calls } = mk([okText(), okCall(proposal)]);
    await r.propose(bundle);
    expect(calls).toHaveLength(2);
  });

  it("si todo falla, lanza con el último error", async () => {
    const { r } = mk([httpError(503, "high demand"), httpError(503, "high demand"), httpError(503, "high demand"), httpError(500, "boom")]);
    await expect(r.propose(bundle)).rejects.toThrow(/HTTP 500 .*boom/);
  });
});
