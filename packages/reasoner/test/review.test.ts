import { describe, expect, it } from "vitest";
import { GeminiPreTradeReviewer, REVIEW_SYSTEM, buildReviewMessage, parseReview } from "../src/index.js";

function fakeFetch(responses: Response[]) {
  const calls: Array<{ model: string; body: { tools?: unknown[]; contents: Array<{ parts: Array<{ text: string }> }>; systemInstruction: { parts: Array<{ text: string }> } } }> = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ model: /models\/([^:]+):/.exec(String(url))?.[1] ?? "?", body: JSON.parse(String(init?.body)) });
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas");
    return r;
  }) as unknown as typeof fetch;
  return { fetch: f, calls };
}
const grounded = (text: string) => new Response(JSON.stringify({
  candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP", groundingMetadata: { webSearchQueries: ["GFI Tarkwa lease"], groundingChunks: [{ web: { uri: "https://redirect/1", title: "miningweekly.com" } }] } }],
  usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 600, thoughtsTokenCount: 200, toolUsePromptTokenCount: 3000 },
}), { status: 200 });

describe("revisión antes de comprar (15/9)", () => {
  it("el prompt busca razones para NO comprar, con dato, fuente y fecha, y no repite la verificación", () => {
    expect(REVIEW_SYSTEM).toContain("razones para NO comprarla hoy");
    expect(REVIEW_SYSTEM).toContain("licencias, permisos o concesiones");
    expect(REVIEW_SYSTEM).toContain("sin fuente no es objeción");
    expect(REVIEW_SYSTEM).toContain("REVISIÓN: SIN OBJECIONES");
    const m = buildReviewMessage({ symbol: "GFI", name: "Gold Fields", today: "2026-09-15", verification: { verdict: "apto", reason: "primer semestre fuerte", date: "2026-09-14" }, line: { kind: "comprar", close: 43.09, stop: 38 } });
    expect(m).toContain("GFI — Gold Fields");
    expect(m).toContain("apto (2026-09-14): primer semestre fuerte");
    expect(m).toContain("Usá la búsqueda de Google");
  });
  it("la primera línea decide, en el código: sin objeciones, objeción (con la principal) o no pude verificar", () => {
    expect(parseReview("REVISIÓN: SIN OBJECIONES — nada material en 30 días.\n...")).toEqual({ verdict: "sin_objeciones", reason: "nada material en 30 días." });
    expect(parseReview("REVISION: OBJECIÓN — la licencia de Tarkwa vence en abril de 2027 (Mining Weekly, 25/8).")).toEqual({ verdict: "objecion", reason: "la licencia de Tarkwa vence en abril de 2027 (Mining Weekly, 25/8)." });
    expect(parseReview("REVISIÓN: NO PUDE VERIFICAR — no encontré el comunicado del trimestre")).toMatchObject({ verdict: "no_pude_verificar" });
    // Sin la línea no hay revisión: no se inventa un "sin objeciones".
    expect(() => parseReview("informe sin la línea")).toThrow();
  });
  it("por defecto busca solo con gemini-2.5-flash (15/9)", async () => {
    const saturado = () => new Response(JSON.stringify({ error: { code: 503, message: "high demand", status: "UNAVAILABLE" } }), { status: 503 });
    const ff = fakeFetch([saturado()]);
    await expect(new GeminiPreTradeReviewer({ keys: ["k0"], fetch: ff.fetch }).review({ symbol: "APH", name: null, today: "2026-09-15", verification: null, line: { kind: "comprar", close: 1, stop: 1 } })).rejects.toThrow();
    expect(ff.calls.map((c) => c.model)).toEqual(["gemini-2.5-flash"]);
  });
  it("GFI el 14/9: con búsqueda de Google, devuelve la objeción con su fuente", async () => {
    const ff = fakeFetch([grounded("REVISIÓN: OBJECIÓN — la licencia de Tarkwa vence en abril de 2027 y la empresa dice que un mal resultado tendría 'material and adverse impact'.\n1. ...")]);
    const r = await new GeminiPreTradeReviewer({ keys: ["k0"], models: ["A"], reviewModels: ["A"], fetch: ff.fetch }).review({ symbol: "GFI", name: "Gold Fields", today: "2026-09-15", verification: null, line: { kind: "comprar", close: 43.09, stop: 38 } });
    expect(ff.calls[0]!.body.tools).toEqual([{ google_search: {} }]);
    expect(r.verdict).toBe("objecion");
    expect(r.reason).toContain("Tarkwa");
    expect(r.sources).toEqual([{ title: "miningweekly.com", url: "https://redirect/1" }]);
  });
});
