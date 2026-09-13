import { describe, expect, it } from "vitest";
import { convictionFor, topPicks, verificationOrder } from "./conviction.js";
import type { CandidateRow, Tags } from "./types.js";

const base: CandidateRow = {
  candidateDate: "2026-09-07", symbol: "AAA", kind: "stock", verdict: "COMPRAR", score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
  // Objetivo como lo calcula el motor desde el 12/9: techo de la franja + 2 × (techo − stop) = 102 + 2 × 10.
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 122, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, flags: [], nthAppearance: 1,
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
    expect(p.gainPct).toBeCloseTo(19.6078, 3);
    expect(p.lossPct).toBeCloseTo(-9.8039, 3);
    expect(p.base).toBe(102);
    expect(p.reasons).toEqual([
      "1° de 20 pares por fundamentals (score 1.20)",
      "analistas: consenso de compra",
      "último resultado sorprendió para arriba",
      "objetivo +19.6% contra stop -9.8% desde 102 (2 a 1)",
      "riesgo 4/10",
    ]);
    // score × fiabilidad(1) + 0.2 + 0.2
    expect(p.conviction).toBeCloseTo(1.6, 4);
  });

  it("descuenta grupo chico, riesgo alto, banderas negativas, objetivo cercano y temas donde ya estás cargado", () => {
    const p = convictionFor(
      row({ score: 1.5, groupSize: 5, riskScore: 9, flags: ["insiders_venden", "sorpresa_negativa"], entryHigh: 100, stop: 98, target: 104 }),
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

describe("ganancia, pérdida y consenso desde el precio que se paga (13/9)", () => {
  // NVDA del 13/9: la tarjeta decía "objetivo +9.1% contra stop -1.6% (2 a 1)", o sea 5,9 a 1. Los porcentajes
  // salían del cierre (218,29) y el 2 a 1, del techo de la franja (222,66).
  const nvda = row({ symbol: "NVDA", close: 218.29, entryLow: 218.29, entryHigh: 222.66, stop: 214.89, target: 238.2, verification: { date: "2026-09-10", verdict: "apto", reason: "r", consensusTarget: 327 } });
  it("los dos porcentajes salen del techo de la franja y el texto dice desde dónde", () => {
    const p = convictionFor(nvda, null, {})!;
    expect(p.base).toBe(222.66);
    expect(p.gainPct).toBeCloseTo(6.98, 2);
    expect(p.lossPct).toBeCloseTo(-3.49, 2);
    expect(p.reasons).toContain("objetivo +7.0% contra stop -3.5% desde 222.66 (2 a 1)");
  });
  it("el consenso de analistas va al lado, medido desde el mismo precio", () => {
    const p = convictionFor(nvda, null, {})!;
    expect(p.consensus).toEqual({ target: 327, upsidePct: expect.closeTo(46.86, 1) });
  });
  it("si el objetivo queda arriba del consenso lo dice, sin restar convicción", () => {
    // LNC con el stop nuevo: objetivo 52,50 contra una mediana de 47 en 11 analistas.
    const lnc = row({ symbol: "LNC", close: 43.84, entryLow: 43.84, entryHigh: 44.72, stop: 40.83, target: 52.5 });
    const sin = convictionFor(lnc, null, {})!;
    const con = convictionFor({ ...lnc, analystTargets: { n: 11, median: 47, min: 42, max: 53, latestDate: "2026-08-24" } }, null, {})!;
    expect(con.cautions.some((c) => c.includes("arriba del consenso"))).toBe(true);
    expect(con.conviction).toBeCloseTo(sin.conviction, 4);
  });
  it("una fila que no es 2 a 1 desde la entrada muestra su relación real, no un 2 a 1 escrito a mano", () => {
    const p = convictionFor(row({ target: 116 }), null, {})!;
    expect(p.reasons).toContain("objetivo +13.7% contra stop -9.8% desde 102 (1.4 a 1)");
  });
});

describe("convicción: eventos y estados", () => {
  it("evento moderado penaliza 0.3 y cita fecha y titular", () => {
    const base = convictionFor(row({ flags: [] }), null, {})!;
    const p = convictionFor(row({ flags: ["evento_moderado"], events: [{ date: "2026-07-27", kind: "analista", severity: "moderado", headline: "BTIG baja objetivo a 24" }] }), null, {})!;
    expect(p.conviction).toBeCloseTo(base.conviction - 0.3, 4);
    expect(p.cautions).toContain("evento moderado 2026-07-27: BTIG baja objetivo a 24");
  });
  it("titulares sin clasificar penalizan 0.3; extraordinarios y sin estados solo avisan", () => {
    const base = convictionFor(row({ flags: [] }), null, {})!;
    expect(convictionFor(row({ flags: ["eventos_sin_clasificar"] }), null, {})!.conviction).toBeCloseTo(base.conviction - 0.3, 4);
    const x = convictionFor(row({ flags: ["resultado_extraordinario", "sin_estados"] }), null, {})!;
    expect(x.conviction).toBeCloseTo(base.conviction, 4);
    expect(x.cautions.some((c) => c.includes("extraordinarios"))).toBe(true);
    expect(x.allAligned).toBe(false);
  });
});

describe("verificationOrder (13/9)", () => {
  it("TSM es 2ª por convicción y 10ª por score: se verifica antes que STNG, que tiene más score y menos convicción", () => {
    // El 13/9 el presupuesto de 8 verificaciones se gastó por score (APH, NVDA, NBN, STNG, LNC, SMCI, DEC, HIPO) y TSM
    // y GFI, que el plan necesita, quedaron sin verificar con el cuestionario nuevo.
    const tsm = row({ symbol: "TSM", score: 0.88, flags: ["insiders_compran", "consenso_compra", "sorpresa_positiva"] });
    const stng = row({ symbol: "STNG", score: 1.0, flags: ["sorpresa_negativa", "verificacion_reservas"] });
    const etf = row({ symbol: "XLF", kind: "etf", score: null });
    const observar = row({ symbol: "OBS", verdict: "OBSERVAR", score: 2 });
    expect(verificationOrder([stng, etf, observar, tsm], {}).map((r) => r.symbol)).toEqual(["TSM", "STNG", "OBS", "XLF"]);
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
