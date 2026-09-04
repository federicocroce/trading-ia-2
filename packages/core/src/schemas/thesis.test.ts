import { describe, expect, it } from "vitest";
import { ThesisProposal, computeEdge } from "./thesis.js";
import { brierScore } from "./outcome.js";
import { rawEventDedupeKey } from "./event.js";

const valid = {
  ticker: "XXXX",
  eventType: "earnings",
  eventDate: "2026-10-14",
  direction: "long",
  pEstimate: 0.72,
  pMarket: 0.55,
  instrument: "stock",
  entryMax: 12.4,
  target: 18,
  invalidation: "Guidance Q4 por debajo de consenso en el call de earnings.",
  confidence: "med",
  reasoning: "Resumen de razonamiento con al menos cincuenta caracteres para pasar la validación mínima.",
  sources: ["edgar:0001234-26-000123"],
} as const;

describe("ThesisProposal", () => {
  it("acepta una propuesta válida", () => {
    expect(ThesisProposal.parse(valid).ticker).toBe("XXXX");
  });
  it("rechaza claves extra (el LLM no puede inventar campos, ej. edge)", () => {
    expect(() => ThesisProposal.parse({ ...valid, edge: 0.5 })).toThrow();
  });
  it("exige invalidación concreta", () => {
    expect(() => ThesisProposal.parse({ ...valid, invalidation: "baja" })).toThrow();
  });
  it("exige al menos una fuente", () => {
    expect(() => ThesisProposal.parse({ ...valid, sources: [] })).toThrow();
  });
});

describe("computeEdge", () => {
  it("long: pEstimate - pMarket", () => {
    expect(computeEdge({ pEstimate: 0.7, pMarket: 0.55, direction: "long" })).toBeCloseTo(0.15);
  });
  it("short: invierte el signo", () => {
    expect(computeEdge({ pEstimate: 0.3, pMarket: 0.55, direction: "short" })).toBeCloseTo(0.25);
  });
});

describe("brierScore", () => {
  it("0 para predicciones perfectas", () => {
    expect(brierScore([{ p: 1, happened: true }, { p: 0, happened: false }])).toBe(0);
  });
  it("0.25 para 0.5 siempre", () => {
    expect(brierScore([{ p: 0.5, happened: true }, { p: 0.5, happened: false }])).toBe(0.25);
  });
  it("NaN sin datos", () => {
    expect(brierScore([])).toBeNaN();
  });
});

describe("rawEventDedupeKey", () => {
  it("normaliza ticker y tolera fecha nula", () => {
    expect(rawEventDedupeKey({ ticker: "ypf", eventType: "operational", eventDate: null, sourceRef: "a" })).toBe(
      "YPF|operational|-|a",
    );
  });
});
