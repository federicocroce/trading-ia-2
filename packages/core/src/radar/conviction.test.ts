import { describe, expect, it } from "vitest";
import { convictionFor, topPicks } from "./conviction.js";
import type { CandidateRow, Tags } from "./types.js";

const base: CandidateRow = {
  candidateDate: "2026-09-07", symbol: "AAA", kind: "stock", verdict: "COMPRAR", score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 116, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
};
const row = (o: Partial<CandidateRow>): CandidateRow => ({ ...base, ...o });
const tags = (themes: string[]): Tags => ({ assetClass: "accion_us", sector: "Tecnología", industry: null, themes, themesSource: "regla" });

describe("convictionFor", () => {
  it("solo acciones COMPRAR con el stop por debajo del precio", () => {
    expect(convictionFor(row({ verdict: "OBSERVAR" }), null, {})).toBeNull();
    expect(convictionFor(row({ kind: "etf", verdict: "NUCLEO" }), null, {})).toBeNull();
    expect(convictionFor(row({ stop: 105, target: null }), null, {})).toBeNull();
    expect(convictionFor(row({ score: null }), null, {})).toBeNull();
  });

  it("sin salvedades: todo acompaña, con la ganancia al objetivo y las razones en palabras", () => {
    const p = convictionFor(row({ flags: ["consenso_compra", "sorpresa_positiva"] }), tags(["IA"]), {})!;
    expect(p.allAligned).toBe(true);
    expect(p.cautions).toEqual([]);
    expect(p.gainPct).toBe(16);
    expect(p.lossPct).toBe(-8);
    expect(p.reasons).toEqual([
      "1° de 20 pares por fundamentals (score 1.20)",
      "analistas: consenso de compra",
      "último resultado sorprendió para arriba",
      "objetivo +16.0% contra stop -8.0% (2 a 1)",
      "riesgo 4/10",
    ]);
    // score × fiabilidad(1) + 0.2 + 0.2
    expect(p.conviction).toBeCloseTo(1.6, 4);
  });

  it("descuenta grupo chico, riesgo alto, banderas negativas, objetivo cercano y temas donde ya estás cargado", () => {
    const p = convictionFor(
      row({ score: 1.5, groupSize: 5, riskScore: 9, flags: ["insiders_venden", "sorpresa_negativa"], stop: 98, target: 104 }),
      tags(["argentina", "bancos"]),
      { argentina: 75.6 },
    )!;
    expect(p.allAligned).toBe(false);
    expect(p.cautions).toEqual([
      "grupo chico (5 pares): el rank vale menos",
      "riesgo 9/10: papel volátil, respetá el tamaño",
      "insiders vendieron en los últimos 90 días",
      "último resultado decepcionó",
      "objetivo a solo +4.0%: poco margen para comisiones y ruido",
      "ya tenés 75.6% de la cartera en argentina",
    ]);
    // 1.5 × 0.5 − 0.15 − 0.3 − 0.4 (riesgo 9) − 0.3 (objetivo) − 0.3 (tema) = −0.7
    expect(p.conviction).toBeCloseTo(-0.7, 4);
  });

  it("descuenta 0.3 y lo dice cuando el candidato se mueve como un papel que ya tenés", () => {
    const p = convictionFor(row({}), null, {}, { AAA: { with: "YPF", corr: 0.82 } })!;
    expect(p.allAligned).toBe(false);
    expect(p.cautions).toEqual(["se mueve como YPF que ya tenés (correlación 0.82)"]);
    expect(p.conviction).toBeCloseTo(0.9, 4);
  });
});

describe("topPicks", () => {
  it("ordena por convicción, deja afuera lo que no califica y corta en n", () => {
    const rows = [
      row({ symbol: "MEH", score: 1.6, groupSize: 5, riskScore: 9 }),
      row({ symbol: "TOP", score: 1.3, flags: ["consenso_compra", "insiders_compran"] }),
      row({ symbol: "OBS", verdict: "OBSERVAR", score: 2 }),
      row({ symbol: "MID", score: 1.4 }),
    ];
    const picks = topPicks(rows, {}, {}, 2);
    expect(picks.map((p) => p.symbol)).toEqual(["TOP", "MID"]);
  });
});
