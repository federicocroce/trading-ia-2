import { describe, expect, it } from "vitest";
import { ThesisProposal } from "@thesis/core";
import { PROMPT_VERSION, PROPOSE_TOOL, buildUserMessage, parseProposal, type BundleWithMarket } from "../src/index.js";

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

describe("tool schema ~ ThesisProposal", () => {
  it("mismas claves requeridas", () => {
    const req = (PROPOSE_TOOL.input_schema as unknown as { required: string[] }).required.sort();
    expect(req).toEqual(Object.keys(ThesisProposal.shape).sort());
  });
});

describe("buildUserMessage", () => {
  it("incluye evento, guía, tabla de pMarket y documentos recortados", () => {
    const msg = buildUserMessage(bundle, 50);
    expect(msg).toContain("ticker: XXXX");
    expect(msg).toContain("Evento: reporte trimestral");
    expect(msg).toContain("+10% (11.00): pMarket=");
    expect(msg).toContain("# Documento: 10-Q");
    expect(msg.split("# Documento: 10-Q")[1]!.length).toBeLessThan(200);
  });
  it("sin comparables avisa", () => {
    expect(buildUserMessage(bundle)).toContain("Sin historial");
  });
});

describe("parseProposal", () => {
  it("fuerza pMarket desde el move implícito", () => {
    const p = parseProposal(proposal, bundle);
    // target 11 con spot 10 y sigma 0.1: z = ln(1.1)/0.1 = 0.953 -> P(long) ≈ 0.17
    expect(p.pMarket).toBeCloseTo(0.170, 2);
  });
  it("respeta pMarket del LLM si no hay opciones", () => {
    expect(parseProposal(proposal, { ...bundle, market: { spot: 10, impliedMove: null } }).pMarket).toBe(0.4);
  });
  it("rechaza ticker distinto al evento", () => {
    expect(() => parseProposal({ ...proposal, ticker: "OTRO" }, bundle)).toThrow(/ticker/);
  });
  it("rechaza campos extra", () => {
    expect(() => parseProposal({ ...proposal, edge: 0.9 }, bundle)).toThrow();
  });
});

describe("PROMPT_VERSION", () => {
  it("es estable y con hash", () => expect(PROMPT_VERSION).toMatch(/^v1-[0-9a-f]{12}$/));
});
