import { describe, expect, it } from "vitest";
import { AnthropicNarrator, AnthropicReasoner, GeminiNarrator, GeminiReasoner } from "@thesis/reasoner";
import { resolveReasoner } from "./config.js";
import { buildNarrator, buildReasoner } from "./container.js";

const gemini = { GOOGLE_AI_API_KEY_1: "g1", GOOGLE_AI_API_KEY_2: "g2" };

describe("resolveReasoner", () => {
  it("con keys de Gemini y sin Anthropic elige gemini", () => {
    const r = resolveReasoner(gemini);
    expect(r.kind).toBe("gemini");
    expect(r.geminiKeys).toEqual(["g1", "g2"]);
  });
  it("con ANTHROPIC_API_KEY elige anthropic aunque haya Gemini", () => {
    expect(resolveReasoner({ ...gemini, ANTHROPIC_API_KEY: "sk" }).kind).toBe("anthropic");
  });
  it("REASONER=gemini fuerza gemini aunque haya Anthropic", () => {
    expect(resolveReasoner({ ...gemini, ANTHROPIC_API_KEY: "sk", REASONER: "gemini" }).kind).toBe("gemini");
  });
  it("REASONER=gemini sin keys falla", () => {
    expect(() => resolveReasoner({ REASONER: "gemini", ANTHROPIC_API_KEY: "sk" })).toThrow(/GOOGLE_AI_API_KEY/);
  });
  it("REASONER desconocido falla", () => {
    expect(() => resolveReasoner({ ...gemini, REASONER: "openai" })).toThrow(/REASONER/);
  });
  it("sin ninguna key falla con mensaje claro", () => {
    expect(() => resolveReasoner({})).toThrow(/ANTHROPIC_API_KEY|GOOGLE_AI_API_KEY/);
  });
  it("ignora keys vacías y respeta el orden 1..4", () => {
    expect(resolveReasoner({ GOOGLE_AI_API_KEY_1: "", GOOGLE_AI_API_KEY_3: "g3", GOOGLE_AI_API_KEY_4: "g4" }).geminiKeys).toEqual(["g3", "g4"]);
  });
  it("GEMINI_MODELS separa por coma", () => {
    expect(resolveReasoner({ ...gemini, GEMINI_MODELS: " gemini-2.5-flash, gemini-3.6-flash " }).geminiModels).toEqual(["gemini-2.5-flash", "gemini-3.6-flash"]);
    expect(resolveReasoner(gemini).geminiModels).toBeUndefined();
  });
});

describe("buildReasoner", () => {
  it("gemini → GeminiReasoner", () => {
    expect(buildReasoner({ kind: "gemini", geminiKeys: ["g1"] })).toBeInstanceOf(GeminiReasoner);
  });
  it("anthropic → AnthropicReasoner", () => {
    expect(buildReasoner({ kind: "anthropic", anthropicApiKey: "sk", geminiKeys: [] })).toBeInstanceOf(AnthropicReasoner);
  });
});

describe("buildNarrator", () => {
  it("sigue la misma regla que el razonador", () => {
    expect(buildNarrator({ kind: "gemini", geminiKeys: ["g1"] })).toBeInstanceOf(GeminiNarrator);
    expect(buildNarrator({ kind: "anthropic", anthropicApiKey: "sk", geminiKeys: [] })).toBeInstanceOf(AnthropicNarrator);
  });
});
