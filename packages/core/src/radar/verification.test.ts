import { describe, expect, it } from "vitest";
import { convictionFor, decideCandidate, planContribution, verificationFlag, type Candle, type CandidateRow, type Fundamentals } from "../index.js";

const series = (closes: number[], start = "2025-09-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
const up = series(Array.from({ length: 260 }, (_, i) => 80 + (20 * i) / 259));
const today = "2026-05-19";
const f: Fundamentals = { symbol: "X", asOf: today, metrics: { beta: 1, "totalDebt/totalEquityAnnual": 0.5 }, peers: [], industry: "I", mcapUsd: 20e9, dollarVolumeUsd: 50e6, nextEarnings: null, insiderBuys90d: 0, insiderSells90d: 0, analyst: null, earningsSurprises: null, priceUsd: 100 } as unknown as Fundamentals;
const policy = { technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
const base = { f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };

describe("decideCandidate con verificación web", () => {
  it("sin verificador no hay bandera; pendiente deja bandera sin cambiar el veredicto", () => {
    expect(verificationFlag(undefined)).toBeNull();
    const d = decideCandidate({ ...base, verification: null }, policy);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("verificacion_pendiente");
    }
  });
  it("apta: bandera, sigue COMPRAR", () => {
    const d = decideCandidate({ ...base, verification: { date: today, verdict: "apto", reason: "limpia" } }, policy);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("verificacion_apta");
    }
  });
  it("con reservas: bandera, sigue COMPRAR sola; con otra salvedad de calidad pasa a OBSERVAR", () => {
    const one = decideCandidate({ ...base, verification: { date: today, verdict: "con_reservas", reason: "reservas liberadas" } }, policy);
    if (!("excluded" in one)) {
      expect(one.verdict).toBe("COMPRAR");
      expect(one.flags).toContain("verificacion_reservas");
    }
    const two = decideCandidate({ ...base, verification: { date: today, verdict: "con_reservas", reason: "r" }, events: [{ date: "2026-05-01", kind: "litigio", severity: "moderado", headline: "demanda" }] }, policy);
    if (!("excluded" in two)) {
      expect(two.verdict).toBe("OBSERVAR");
      expect(two.reasons).toEqual(["salvedades_de_calidad"]);
    }
  });
  it("evitar: OBSERVAR por sí sola con motivo verificacion_evitar", () => {
    const d = decideCandidate({ ...base, verification: { date: today, verdict: "evitar", reason: "ganancia única de fusión" } }, policy);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("OBSERVAR");
      expect(d.reasons).toEqual(["verificacion_evitar"]);
      expect(d.flags).toContain("verificacion_evitar");
    }
  });
});

const row = (o: Partial<CandidateRow>): CandidateRow => ({
  candidateDate: "2026-09-10", symbol: "AAA", kind: "stock", verdict: "COMPRAR", score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
  close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 116, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, flags: [], nthAppearance: 1,
  summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
  close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, ...o,
});

describe("convicción con verificación web", () => {
  it("con reservas descuenta 0.3 citando fecha y motivo; apta suma a las razones sin bonificar; pendiente solo avisa", () => {
    const clean = convictionFor(row({}), null, {})!;
    const res = convictionFor(row({ flags: ["verificacion_reservas"], verification: { date: "2026-09-10", verdict: "con_reservas", reason: "reservas liberadas" } }), null, {})!;
    expect(res.conviction).toBeCloseTo(clean.conviction - 0.3, 4);
    expect(res.cautions).toContain("verificación web con reservas (2026-09-10): reservas liberadas");
    const apta = convictionFor(row({ flags: ["verificacion_apta"], verification: { date: "2026-09-10", verdict: "apto", reason: "limpia" } }), null, {})!;
    expect(apta.conviction).toBeCloseTo(clean.conviction, 4);
    expect(apta.reasons).toContain("verificación web apta (2026-09-10): limpia");
    const pend = convictionFor(row({ flags: ["verificacion_pendiente"] }), null, {})!;
    expect(pend.conviction).toBeCloseTo(clean.conviction, 4);
    expect(pend.allAligned).toBe(false);
  });
});

describe("plan: la verificación con reservas no entra como posición nueva y la nota lo dice", () => {
  const cfg = { monthlyUsd: 6500, coreTargetPct: 40, maxPositionPct: 15, maxNewPositionsPerMonth: 2, maxLinePctOfContribution: 50, coreSharePctWhileBelowTarget: 60, sumarSharePctOfRest: 30, watchLinesMax: 1, etfLinesMax: 1 };
  const b = (symbol: string, priority: number, verification: { verdict: "apto" | "con_reservas" | "evitar"; reason: string } | null) => ({ symbol, kind: "stock" as const, priority, score: 1, sizeUsd: 5000, close: 50, entryHigh: 51, stop: 45, target: 60, verification });
  it("HRTG 1° por convicción con reservas queda afuera con motivo; los siguientes entran", () => {
    const plan = planContribution({ month: "2026-09", portfolioValueUsd: 150_000, positions: [], sumarCandidates: [], buyCandidates: [b("HRTG", 1.5, { verdict: "con_reservas", reason: "temporada de huracanes" }), b("LNC", 1.4, { verdict: "apto", reason: "barata" }), b("NBN", 1.3, null)], coreEtfs: [], spyClose: null, closes: {} }, cfg, {});
    // Hasta el 13/9 NBN entraba con la verificación pendiente. Ya no: "¿qué me asegura que la siguiente esté bien?",
    // preguntó el dueño; sin verificar, nada. Queda afuera con su motivo.
    expect(plan.lines.filter((l) => l.kind === "comprar").map((l) => l.symbol)).toEqual(["LNC"]);
    expect(plan.leftOut?.find((x) => x.symbol === "NBN")?.reason).toMatch(/pendiente/);
    expect(plan.leftOut?.find((x) => x.symbol === "HRTG")?.reason).toBe("1° por convicción: verificación web con reservas: temporada de huracanes");
    expect(plan.notes.join(" ")).toContain("HRTG (1° por convicción: verificación web con reservas: temporada de huracanes)");
  });
});
