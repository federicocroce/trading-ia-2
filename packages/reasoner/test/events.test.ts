import { describe, expect, it } from "vitest";
import type { EventClassifierInput } from "@thesis/core";
import { EVENTS_SYSTEM, EVENTS_TOOL, GeminiEventClassifier, buildEventsMessage, parseMaterialEvents } from "../src/index.js";

const input: EventClassifierInput = {
  symbol: "ZVRA", name: "Zevra Therapeutics",
  items: [
    { id: 0, date: "2026-07-24", source: "Benzinga", headline: "Zevra Therapeutics Receives Negative Opinion From EMA CHMP On Its Marketing Authorization Application For Arimoclomol", summary: null, url: "https://n/1", kind: "regulatorio" },
    { id: 1, date: "2026-07-27", source: "PRNewswire", headline: "Levi & Korsinsky Notifies Investors of Pending Investigation Into Zevra Therapeutics (ZVRA)", summary: "law firm", url: "https://n/2", kind: "litigio" },
  ],
};
const good = { events: [
  { id: 0, date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: input.items[0]!.headline, why: "El CHMP recomendó no autorizar arimoclomol en la UE." },
  { id: 1, date: "2026-07-27", kind: "litigio", severity: "moderado", headline: input.items[1]!.headline, why: "Estudio de abogados tras la caída." },
] };

function fakeFetch(args: unknown) {
  const calls: any[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "material_events", args } }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("clasificador de titulares", () => {
  it("el mensaje lleva el id, símbolo, nombre, fecha, fuente, tipo del prefiltro y titular de cada ítem", () => {
    const m = buildEventsMessage(input);
    for (const s of ["ZVRA", "Zevra Therapeutics", "[id 0]", "[id 1]", "2026-07-24", "Benzinga", "regulatorio", "EMA CHMP", "litigio", "law firm"]) expect(m).toContain(s);
  });
  it("parseMaterialEvents: matchea por id, toma fecha/url/fuente/titular del ítem recibido y descarta ids desconocidos", () => {
    const out = parseMaterialEvents(good, input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2026-07-24", url: "https://n/1", source: "Benzinga", severity: "grave", kind: "regulatorio" });
    const unknownId = { events: [{ ...good.events[0], id: 99 }] };
    expect(parseMaterialEvents(unknownId, input)).toEqual([]);
  });
  it("titular del modelo distinto del original: igual se acepta por id, y se usa el titular del ítem", () => {
    const mismatched = { events: [{ ...good.events[0], headline: "Zevra approved everywhere" }] };
    const out = parseMaterialEvents(mismatched, input);
    expect(out).toHaveLength(1);
    expect(out[0]!.headline).toBe(input.items[0]!.headline); // nunca el texto inventado por el modelo
  });
  it("severidad o tipo inválidos → error; why obligatorio (vacío o solo espacios); why largo se trunca a 200", () => {
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], severity: "catastrófico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], kind: "meteorológico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], why: "" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], why: "   " }] }, input)).toThrow(); // solo espacios: trim vacío, no pasa min(1)
    const long = "x".repeat(300);
    const out = parseMaterialEvents({ events: [{ ...good.events[0], why: long }] }, input);
    expect(out[0]!.why).toHaveLength(200);
  });
  it("titular del modelo igual al de OTRO ítem del envío: id probablemente mezclado, se descarta el evento entero", () => {
    const shuffled = { events: [{ ...good.events[0], id: 0, headline: input.items[1]!.headline }] };
    expect(parseMaterialEvents(shuffled, input)).toEqual([]);
    const ownHeadline = { events: [{ ...good.events[0], id: 0, headline: input.items[0]!.headline }] };
    const out1 = parseMaterialEvents(ownHeadline, input);
    expect(out1).toHaveLength(1);
    expect(out1[0]!.headline).toBe(input.items[0]!.headline);
    const unrelated = { events: [{ ...good.events[0], id: 0, headline: "Zevra approved everywhere" }] };
    const out2 = parseMaterialEvents(unrelated, input);
    expect(out2).toHaveLength(1);
    expect(out2[0]!.headline).toBe(input.items[0]!.headline);
  });
  it("GeminiEventClassifier manda system y tool material_events forzada", async () => {
    const { f, calls } = fakeFetch(good);
    const out = await new GeminiEventClassifier({ keys: ["k"], fetch: f }).classify(input);
    expect(out.map((e) => e.severity)).toEqual(["grave", "moderado"]);
    expect(calls[0].systemInstruction.parts[0].text).toBe(EVENTS_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(EVENTS_TOOL.name);
    expect(calls[0].generationConfig.maxOutputTokens).toBe(8000); // sin override: default del transporte
  });
});
