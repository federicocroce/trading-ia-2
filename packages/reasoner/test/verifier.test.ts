import { describe, expect, it } from "vitest";
import type { UsageCallInput, UsageRecorder, UsageResult } from "@thesis/core";
import { GeminiCandidateVerifier, GeminiToolCaller, VERIFY_TOOL, VERIFY_VERSION, buildResearchMessage, parseVerification } from "../src/index.js";

function memRecorder() {
  const rows: Array<UsageCallInput & { id: string }> = [];
  const rec: UsageRecorder & { rows: typeof rows } = {
    rows,
    record(call) { const id = `id${rows.length + 1}`; rows.push({ ...call, id }); return id; },
    setResult(id, result: UsageResult) { const r = rows.find((x) => x.id === id); if (r) r.result = result; },
  };
  return rec;
}
interface Captured { model: string; body: { tools?: unknown[]; contents: Array<{ parts: Array<{ text: string }> }>; systemInstruction: { parts: Array<{ text: string }> } } }
function fakeFetch(responses: Response[]) {
  const calls: Captured[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ model: /models\/([^:]+):/.exec(String(url))?.[1] ?? "?", body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const grounded = (text: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text: "pensando…", thought: true }, { text }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["NVDA Q2 FY27 results", "NVDA analyst price target"], groundingChunks: [{ web: { uri: "https://redirect/1", title: "sec.gov" } }, { web: { uri: "https://redirect/2", title: "cnbc.com" } }, { retrievedContext: {} }] } }],
  usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 900, thoughtsTokenCount: 300, toolUsePromptTokenCount: 4000 },
}), { status: 200 });
const call = (args: unknown) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "candidate_verification", args } }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 300, thoughtsTokenCount: 200 } }), { status: 200 });
const args = {
  verdict: "apto", reason: "Superó y subió guía; China excluida de la guía; 18,6x adelantado con crecimiento 70%.",
  lastQuarter: { reportDate: "2026-08-26", revenueVsConsensus: "96,2B vs 91,9B (+4,7%)", epsVsConsensus: "2,22 vs 2,08 no GAAP", oneOffs: ["ganancia de 7,8B por acciones (GAAP)"], guidance: "Q3 108B ±2% vs 104B esperado" },
  analysts: [{ date: "2026-08-27", firm: "UBS", action: "sube objetivo", target: 300 }, { date: "2026-09-09T00:00:00Z", firm: "Piper Sandler", action: "inicia", target: 300 }],
  consensusTarget: 328, events: [{ date: "2026-09-03", kind: "adquisicion", headline: "Compra Hugging Face por 12,9B" }], valuation: "18,6x adelantado vs 35–40x de su historia", nextEarnings: "2026-11-18",
};

describe("verificador: prompts y parseo", () => {
  it("versión estable con hash; el mensaje lleva empresa, fecha y contexto", () => {
    expect(VERIFY_VERSION).toMatch(/^v1-[0-9a-f]{12}$/);
    const m = buildResearchMessage({ symbol: "NVDA", name: "NVIDIA", today: "2026-09-10", context: "banderas: consenso_compra" });
    expect(m).toContain("NVDA — NVIDIA");
    expect(m).toContain("2026-09-10");
    expect(m).toContain("consenso_compra");
    expect(VERIFY_TOOL.inputSchema).toHaveProperty("required");
  });
  it("parseVerification normaliza fechas con hora, recorta textos y rechaza dictámenes desconocidos", () => {
    const p = parseVerification(args);
    expect(p.verdict).toBe("apto");
    expect(p.analysts[1]!.date).toBe("2026-09-09");
    expect(p.lastQuarter?.reportDate).toBe("2026-08-26");
    expect(() => parseVerification({ ...args, verdict: "comprar" })).toThrow();
    expect(() => parseVerification({ ...args, extra: 1 })).toThrow();
    expect(parseVerification({ ...args, reason: `${"x".repeat(400)}` }).reason).toHaveLength(300);
  });
});

describe("GeminiCandidateVerifier: dos llamadas (investigar con búsqueda, estructurar)", () => {
  it("investiga con google_search en el modelo de investigación, estructura con la tool, y registra ambas con su propósito", async () => {
    const ff = fakeFetch([grounded("## Informe NVDA\nResultados del 26/8…\nFuentes: sec.gov, cnbc.com"), call(args)]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["gemini-3.8-flash", "gemini-2.5-flash"], researchModels: ["gemini-2.5-flash"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "NVDA", name: "NVIDIA", today: "2026-09-10" });
    expect(ff.calls[0]!.model).toBe("gemini-2.5-flash");
    expect(ff.calls[0]!.body.tools).toEqual([{ google_search: {} }]);
    expect(ff.calls[0]!.body.contents[0]!.parts[0]!.text).toContain("NVDA — NVIDIA");
    expect(ff.calls[1]!.model).toBe("gemini-3.8-flash");
    expect(ff.calls[1]!.body.contents[0]!.parts[0]!.text).toContain("Informe NVDA");
    expect(r.verdict).toBe("apto");
    expect(r.sources).toEqual([{ title: "sec.gov", url: "https://redirect/1" }, { title: "cnbc.com", url: "https://redirect/2" }]);
    expect(r.researchText).toContain("Resultados del 26/8");
    expect(r.model).toBe("gemini-2.5-flash");
    expect(rec.rows.map((x) => [x.purpose, x.result, x.tokensIn])).toEqual([["verificacion", "ok", 4500], ["verificacion_estructura", "ok", 1500]]);
    expect(v.promptVersion).toBe(`${VERIFY_VERSION}-gemini`);
  });
  it("estructura inválida marca la segunda llamada como validación y lanza", async () => {
    const ff = fakeFetch([grounded("informe"), call({ ...args, verdict: "mmm" })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    await expect(v.verify({ symbol: "X", name: null, today: "2026-09-10" })).rejects.toThrow();
    expect(rec.rows.map((x) => x.result)).toEqual(["ok", "validacion"]);
  });
  it("callGrounded sin texto registra validación y pasa al siguiente intento", async () => {
    const empty = new Response(JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] }), { status: 200 });
    const ff = fakeFetch([empty, grounded("ok al segundo intento")]);
    const rec = memRecorder();
    const caller = new GeminiToolCaller({ keys: ["k0", "k1"], models: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(r.text).toBe("ok al segundo intento");
    expect(r.queries).toHaveLength(2);
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok"]);
  });
});
