import { describe, expect, it } from "vitest";
import type { CardInput, UsageCallInput, UsageResult } from "@thesis/core";
import { CARD_TOOL, CARD_VERSION, LocalCardWriter, LocalToolCaller } from "../src/index.js";

/** Un registro de uso en memoria: para ver qué fila deja cada pedido. */
function registro() {
  const filas: Array<UsageCallInput & { id: string }> = [];
  return {
    filas,
    record: (c: UsageCallInput) => { const id = `id${filas.length + 1}`; filas.push({ ...c, id }); return id; },
    setResult: (id: string, result: UsageResult) => { const f = filas.find((x) => x.id === id); if (f) f.result = result; },
  };
}
const responde = (content: string, status = 200) =>
  (async (_url: string | URL | Request, init?: RequestInit) => {
    responde.ultimo = JSON.parse(String(init?.body ?? "{}"));
    return new Response(JSON.stringify(status === 200 ? { choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 1900, completion_tokens: 210 } } : { error: { message: "cargando" } }), { status });
  }) as unknown as typeof fetch & { ultimo?: unknown };
responde.ultimo = undefined as unknown;

/** La misma entrada que usa el test de la ficha de Gemini: lo que cambia es quién responde, no qué se le manda. */
const entrada: CardInput = {
  symbol: "STX", name: "Seagate", industry: "Technology Hardware", sector: "Tecnología", themes: [], themeOptions: ["memoria"],
  verdict: "COMPRAR", score: 1.2, axes: { valuation: 0.4, quality: 1.1, growth: 0.5, balance: 0.2 }, rankInGroup: 2, groupSize: 8, basis: "pares",
  own: { peTTM: 14 }, medians: { peTTM: 22 }, peers: ["WDC"], flags: ["insiders_venden"], insiders: { buys: 0, sells: 3 }, analyst: null,
  surprises: [], filings: [], close: 100, stop: 92, target: 116, riskScore: 4,
};
const fichaOk = JSON.stringify({ summary: "Fabrica discos rígidos.", whyRanks: "P/E 14 contra 22 de mediana del grupo.", mainRisk: "Insiders vendiendo.", moat: "moderado", themes: ["memoria", "inventado"], degrade: false });

describe("LocalToolCaller", () => {
  it("pide el JSON atado al esquema de la herramienta y sin pensamiento", async () => {
    const f = responde(fichaOk);
    const r = await new LocalToolCaller({ url: "http://127.0.0.1:8091/", model: "qwen", fetch: f }).call("sistema", "usuario", CARD_TOOL, { purpose: "ficha", symbol: "STX" });
    const body = responde.ultimo as { response_format: { json_schema: { name: string; schema: unknown } }; chat_template_kwargs: { enable_thinking: boolean } };
    expect(body.response_format.json_schema.name).toBe("candidate_card");
    expect(body.response_format.json_schema.schema).toEqual(CARD_TOOL.inputSchema);
    expect(body.chat_template_kwargs.enable_thinking).toBe(false);
    expect((r.args as { moat: string }).moat).toBe("moderado");
  });

  it("registra cada pedido con fuente local, propósito, símbolo y tokens", async () => {
    const u = registro();
    await new LocalToolCaller({ url: "http://x", model: "qwen", fetch: responde(fichaOk), recorder: u }).call("s", "u", CARD_TOOL, { purpose: "ficha", symbol: "STX" });
    expect(u.filas).toHaveLength(1);
    expect(u.filas[0]).toMatchObject({ source: "local", model: "qwen", purpose: "ficha", symbol: "STX", result: "ok", tokensIn: 1900, tokensOut: 210 });
  });

  it("si la respuesta no es JSON, falla y lo registra como validación (no como ok)", async () => {
    const u = registro();
    await expect(new LocalToolCaller({ url: "http://x", model: "qwen", fetch: responde("no es json"), recorder: u }).call("s", "u", CARD_TOOL)).rejects.toThrow(/no es JSON/);
    expect(u.filas[0]!.result).toBe("validacion");
  });

  it("si el servidor no responde, falla con un mensaje claro: no cae a otro modelo", async () => {
    const u = registro();
    const caido = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
    await expect(new LocalToolCaller({ url: "http://127.0.0.1:8091", model: "qwen", fetch: caido, recorder: u }).call("s", "u", CARD_TOOL)).rejects.toThrow(/no responde en http:\/\/127\.0\.0\.1:8091/);
    expect(u.filas[0]!.result).toBe("error");
  });

  it("un HTTP de error del servidor falla con su mensaje", async () => {
    await expect(new LocalToolCaller({ url: "http://x", model: "qwen", fetch: responde("", 503) }).call("s", "u", CARD_TOOL)).rejects.toThrow(/HTTP 503 cargando/);
  });
});

describe("LocalCardWriter", () => {
  it("usa el mismo parser que Gemini: descarta temas fuera de la lista", async () => {
    const w = new LocalCardWriter({ url: "http://x", model: "qwen", fetch: responde(fichaOk) });
    const c = await w.write(entrada);
    expect(c.themes).toEqual(["memoria"]);
  });

  it("la versión dice que la ficha la escribió el modelo local", () => {
    expect(new LocalCardWriter({ url: "http://x", model: "qwen" }).promptVersion).toBe(`${CARD_VERSION}-local`);
  });

  it("si el modelo pide degradar sin motivo, la ficha no valida y la llamada queda como desperdiciada", async () => {
    const u = registro();
    const sinMotivo = JSON.stringify({ ...JSON.parse(fichaOk), degrade: true });
    const w = new LocalCardWriter({ url: "http://x", model: "qwen", fetch: responde(sinMotivo), recorder: u });
    await expect(w.write(entrada)).rejects.toThrow();
    expect(u.filas[0]!.result).toBe("validacion");
  });
});
