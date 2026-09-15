import { describe, expect, it } from "vitest";
import type { UsageCallInput, UsageRecorder, UsageResult } from "@thesis/core";
import { GeminiCandidateVerifier, GeminiToolCaller, RESEARCH_SYSTEM, VERIFY_TOOL, VERIFY_VERSION, aplicarFaltantes, buildResearchMessage, faltantesDe, parseVerification } from "../src/index.js";

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
  /*
   * Enmienda del 13/9. NBN salió "apto" porque la verificación tomó la sorpresa del trimestre tal como venía: salía de
   * un crédito fiscal comprado y de reservas liberadas, y limpia quedaba en línea con el consenso; además cotizaba en
   * su máximo de 5 años contra el valor libro y dependía de fondeo mayorista con inmobiliario comercial al 485% del
   * capital. Y APH, NVDA y LNC tenían salvedades que yo no consideré motivo para no comprar: el criterio las nombra.
   */
  it("el cuestionario pide lo que dio vuelta a NBN, y el criterio separa lo que no es reserva", () => {
    expect(RESEARCH_SYSTEM).toContain("ganancia por acción LIMPIA");
    expect(RESEARCH_SYSTEM).toContain("historia propia de 5 años");
    expect(RESEARCH_SYSTEM).toContain("300% del capital");
    expect(RESEARCH_SYSTEM).toContain("ejercicio de opciones");
    expect(RESEARCH_SYSTEM).toContain("antimonopolio");
    expect(RESEARCH_SYSTEM).toContain("revisión anual de supuestos");
  });
  it("una reserva sin el número que la sostiene no cuenta (LNC, HIPO y DEC del 13/9)", () => {
    // La primera versión del criterio hizo que el modelo repitiera casi textual "valuación en su máximo de 5 años sin
    // aceleración" para LNC, HIPO y DEC. En LNC era falso: 0,57 veces el valor libro contra 0,83–0,87 en 2019–2021.
    // Y le atribuyó a LNC un beneficio fiscal de 0,35 que el comunicado no tiene.
    expect(RESEARCH_SYSTEM).toContain("sin esos números no es reserva");
    expect(RESEARCH_SYSTEM).toContain("nombrás el ítem, su monto y la fuente");
  });
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
  it("un analista o evento sin fecha se descarta en vez de invalidar la verificación", () => {
    const p = parseVerification({ ...args, analysts: [...args.analysts, { date: null, firm: "Sin fecha", action: "mantiene", target: 10 }], events: [{ date: null, kind: "litigio", headline: "sin fecha" }, ...args.events] });
    expect(p.analysts.map((a) => a.firm)).toEqual(["UBS", "Piper Sandler"]);
    expect(p.events).toHaveLength(1);
  });
});

describe("verificador que falla cerrado (15/9)", () => {
  /*
   * El 13/9 agregué "si no encontraste el número, no uses la reserva para el dictamen" para frenar los datos
   * inventados de LNC. Terminó al revés: el 14/9 NBN salió "apto" porque la verificación "no encontró" su inmobiliario
   * comercial (485% del capital, en el mismo comunicado) ni sus ítems no recurrentes, y GFI salió "apto" sin ver que la
   * licencia de Tarkwa vence en abril de 2027. No encontrar un dato crítico no es una buena noticia.
   */
  it("el cuestionario ya no convierte un dato faltante en aprobación, y pide licencias y el comunicado de resultados", () => {
    expect(RESEARCH_SYSTEM).not.toContain("no la uses para el dictamen");
    expect(RESEARCH_SYSTEM).toContain("no encontrar un dato crítico no es una buena noticia");
    expect(RESEARCH_SYSTEM).toContain("licencias, permisos o concesiones");
    expect(RESEARCH_SYSTEM).toContain("comunicado de resultados");
    expect(RESEARCH_SYSTEM).toContain("FALTANTES:");
    // Lo que frena los datos inventados sigue: una reserva de valuación necesita sus números.
    expect(RESEARCH_SYSTEM).toContain("sin esos números no es reserva");
  });
  it("la línea FALTANTES se lee en el código: ninguno, una lista, o no está", () => {
    expect(faltantesDe("DICTAMEN: APTO — x\n...\nFALTANTES: ninguno")).toEqual([]);
    expect(faltantesDe("DICTAMEN: APTO — x\nFALTANTES: inmobiliario comercial sobre capital; ítems no recurrentes del trimestre.")).toEqual(["inmobiliario comercial sobre capital", "ítems no recurrentes del trimestre"]);
    expect(faltantesDe("DICTAMEN: APTO — x\nsin la línea")).toBeNull();
  });
  it("un apto con datos críticos faltantes pasa a con reservas; los demás dictámenes no cambian", () => {
    const apto = { verdict: "apto" as const, reason: "superó y subió la guía" };
    expect(aplicarFaltantes(apto, ["licencia de Tarkwa (vence en abril de 2027)"])).toEqual({ verdict: "con_reservas", reason: "falta verificar: licencia de Tarkwa (vence en abril de 2027)" });
    expect(aplicarFaltantes(apto, null).verdict).toBe("con_reservas");
    expect(aplicarFaltantes(apto, [])).toEqual(apto);
    expect(aplicarFaltantes({ verdict: "evitar" as const, reason: "x" }, ["y"]).verdict).toBe("evitar");
  });
  it("GFI el 14/9: el modelo dice APTO pero declara que no encontró el estado de la licencia; lo que se guarda es con reservas", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — primer semestre fuerte.\n## Informe GFI\n…\nFALTANTES: estado de la licencia de Tarkwa en Ghana"), call({ ...args, verdict: "apto", reason: "primer semestre fuerte" })]);
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch });
    const r = await v.verify({ symbol: "GFI", name: "Gold Fields", today: "2026-09-14" });
    expect(r.verdict).toBe("con_reservas");
    expect(r.reason).toContain("licencia de Tarkwa");
  });
  it("un informe sin la línea FALTANTES está incompleto (cortado): se rota, como el que no trae dictamen", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — x.\n1. Último trimestre… (se cortó)"), grounded("DICTAMEN: APTO — x.\n1. Último trimestre…\nFALTANTES: ninguno"), call(args)]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "NVDA", name: null, today: "2026-09-15" });
    expect(r.verdict).toBe("apto");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok", "ok"]);
  });
});

describe("búsqueda solo en 2.5-flash (15/9)", () => {
  it("por defecto el verificador busca solo con gemini-2.5-flash: con claves gratis los 3.x no tienen búsqueda", async () => {
    const saturado = () => new Response(JSON.stringify({ error: { code: 503, message: "high demand", status: "UNAVAILABLE" } }), { status: 503 });
    const ff = fakeFetch([saturado(), saturado()]);
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], fetch: ff.fetch });
    await expect(v.verify({ symbol: "APH", name: null, today: "2026-09-15" })).rejects.toThrow();
    expect(ff.calls.map((c) => c.model)).toEqual(["gemini-2.5-flash", "gemini-2.5-flash"]);
  });
});

describe("GeminiCandidateVerifier: dos llamadas (investigar con búsqueda, estructurar)", () => {
  it("investiga con google_search en el modelo de investigación, estructura con la tool, y registra ambas con su propósito", async () => {
    const ff = fakeFetch([grounded("DICTAMEN: APTO — superó y subió guía.\n## Informe NVDA\nResultados del 26/8…\nFuentes: sec.gov, cnbc.com\nFALTANTES: ninguno"), call(args)]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["gemini-3.8-flash", "gemini-2.5-flash"], researchModels: ["gemini-2.5-flash"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "NVDA", name: "NVIDIA", today: "2026-09-10" });
    expect(ff.calls[0]!.model).toBe("gemini-2.5-flash");
    expect(ff.calls[0]!.body.tools).toEqual([{ google_search: {} }]);
    expect((ff.calls[0]!.body as unknown as { generationConfig: unknown }).generationConfig).toEqual({ maxOutputTokens: 12_000, temperature: 0.1, thinkingConfig: { thinkingBudget: 2048 } });
    expect(ff.calls[0]!.body.systemInstruction.parts[0]!.text).toContain("DICTAMEN:");
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
    const ff = fakeFetch([grounded("DICTAMEN: APTO — motivo.\ninforme\nFALTANTES: ninguno"), call({ ...args, verdict: "mmm" })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    await expect(v.verify({ symbol: "X", name: null, today: "2026-09-10" })).rejects.toThrow();
    expect(rec.rows.map((x) => x.result)).toEqual(["ok", "validacion"]);
  });
  it("un informe cortado (sin la línea DICTAMEN) se descarta y rota: nunca se guarda un 'con reservas' por parseo", async () => {
    const cut = grounded("## Informe LNC\n1. Último trimestre reportado: el 30 de julio de 2026 la compañía report");
    const ff = fakeFetch([cut, grounded("DICTAMEN: APTO — 5x adelantado y 0,55x valor libro.\n1. Último trimestre…\nFALTANTES: ninguno"), call({ ...args, verdict: "apto", reason: "5x adelantado" })]);
    const rec = memRecorder();
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await v.verify({ symbol: "LNC", name: "Lincoln National", today: "2026-09-11" });
    expect(r.verdict).toBe("apto");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok", "ok"]);
  });
  it("si ningún intento trae dictamen, la verificación falla (queda pendiente, no 'con reservas')", async () => {
    const ff = fakeFetch([grounded("informe cortado"), grounded("otro informe cortado")]);
    const v = new GeminiCandidateVerifier({ keys: ["k0", "k1"], models: ["A"], researchModels: ["A"], fetch: ff.fetch });
    await expect(v.verify({ symbol: "LNC", name: null, today: "2026-09-11" })).rejects.toThrow(/incompleta/);
  });
  it("callGrounded sin fuentes ni búsquedas (respondió de memoria) registra validación y pasa al siguiente intento", async () => {
    const fromMemory = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "DICTAMEN: APTO — de memoria" }] }, finishReason: "STOP" }] }), { status: 200 });
    const ff = fakeFetch([fromMemory, grounded("con fuentes")]);
    const rec = memRecorder();
    const caller = new GeminiToolCaller({ keys: ["k0", "k1"], models: ["A"], fetch: ff.fetch, recorder: rec });
    const r = await caller.callGrounded("s", "u", { purpose: "verificacion" });
    expect(r.text).toBe("con fuentes");
    expect(rec.rows.map((x) => x.result)).toEqual(["validacion", "ok"]);
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
