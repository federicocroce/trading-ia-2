import { describe, expect, it } from "vitest";
import type { NarratorInput } from "@thesis/core";
import { GeminiNarrator, NARRATOR_SYSTEM, NARRATOR_VERSION, NOTE_TOOL, buildNarratorMessage, parseNote } from "../src/index.js";

const input: NarratorInput = {
  position: { symbol: "YPF", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null },
  verb: "MANTENER",
  reason: "Dejá correr.",
  close: 52.7,
  stop: 48.1,
  target: 61.9,
  gainPct: 75.6,
  weightPct: 22.5,
  last30: [50, 51, 52.7],
  filings: ["6-K — YPF S.A. dividendo"],
  news: ["YPF anunció inversión en Vaca Muerta"],
  riskFacts: ["peso en cartera 22.5%", "el país AR concentra 55% de la cartera"],
};

function fakeFetch(args: unknown) {
  const calls: any[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "position_note", args } }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("narrator", () => {
  it("el mensaje lleva verbo, números, filings, noticias y hechos de riesgo", () => {
    const m = buildNarratorMessage(input);
    for (const s of ["MANTENER", "52.7", "48.1", "61.9", "75.6", "22.5", "6-K", "Vaca Muerta", "concentra 55%"]) expect(m).toContain(s);
  });
  it("parseNote exige motivo cuando degrada y rechaza extras", () => {
    expect(parseNote({ narrative: "ok", degrade: false })).toEqual({ narrative: "ok", degrade: false });
    expect(() => parseNote({ narrative: "ok", degrade: true })).toThrow();
    expect(() => parseNote({ narrative: "ok", degrade: false, verb: "VENDER" })).toThrow();
  });
  it("GeminiNarrator manda system, mensaje y tool position_note forzada", async () => {
    const { f, calls } = fakeFetch({ narrative: "Sigue arriba del stop 48.1 con 75.6% de ganancia.", degrade: false });
    const note = await new GeminiNarrator({ keys: ["k"], fetch: f }).narrate(input);
    expect(note.degrade).toBe(false);
    expect(calls[0].systemInstruction.parts[0].text).toBe(NARRATOR_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(NOTE_TOOL.name);
    expect(calls[0].toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(["position_note"]);
  });
  it("versión estable con hash", () => expect(NARRATOR_VERSION).toMatch(/^n1-[0-9a-f]{12}$/));
});
