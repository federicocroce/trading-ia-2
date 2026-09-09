import { describe, expect, it } from "vitest";
import type { EventClassifierInput } from "@thesis/core";
import { EVENTS_SYSTEM, EVENTS_TOOL, GeminiEventClassifier, buildEventsMessage, parseMaterialEvents } from "../src/index.js";

const input: EventClassifierInput = {
  symbol: "ZVRA", name: "Zevra Therapeutics",
  items: [
    { date: "2026-07-24", source: "Benzinga", headline: "Zevra Therapeutics Receives Negative Opinion From EMA CHMP On Its Marketing Authorization Application For Arimoclomol", summary: null, url: "https://n/1", kind: "regulatorio" },
    { date: "2026-07-27", source: "PRNewswire", headline: "Levi & Korsinsky Notifies Investors of Pending Investigation Into Zevra Therapeutics (ZVRA)", summary: "law firm", url: "https://n/2", kind: "litigio" },
  ],
};
const good = { events: [
  { date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: input.items[0]!.headline, why: "El CHMP recomendó no autorizar arimoclomol en la UE." },
  { date: "2026-07-27", kind: "litigio", severity: "moderado", headline: input.items[1]!.headline, why: "Estudio de abogados tras la caída." },
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
  it("el mensaje lleva símbolo, nombre, fecha, fuente, tipo del prefiltro y titular de cada ítem", () => {
    const m = buildEventsMessage(input);
    for (const s of ["ZVRA", "Zevra Therapeutics", "2026-07-24", "Benzinga", "regulatorio", "EMA CHMP", "litigio", "law firm"]) expect(m).toContain(s);
  });
  it("parseMaterialEvents: toma fecha, url y fuente del ítem recibido y descarta titulares que no vinieron", () => {
    const out = parseMaterialEvents(good, input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2026-07-24", url: "https://n/1", source: "Benzinga", severity: "grave", kind: "regulatorio" });
    const invented = { events: [{ ...good.events[0], headline: "Zevra approved everywhere" }] };
    expect(parseMaterialEvents(invented, input)).toEqual([]);
    expect(parseMaterialEvents({ events: [{ ...good.events[0], headline: good.events[0]!.headline.toLowerCase() }] }, input)).toHaveLength(1); // mayúsculas no importan
  });
  it("severidad o tipo inválidos → error; why obligatorio", () => {
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], severity: "catastrófico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], kind: "meteorológico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], why: "" }] }, input)).toThrow();
  });
  it("GeminiEventClassifier manda system y tool material_events forzada", async () => {
    const { f, calls } = fakeFetch(good);
    const out = await new GeminiEventClassifier({ keys: ["k"], fetch: f }).classify(input);
    expect(out.map((e) => e.severity)).toEqual(["grave", "moderado"]);
    expect(calls[0].systemInstruction.parts[0].text).toBe(EVENTS_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(EVENTS_TOOL.name);
  });
});
