import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AXIS_METRICS, QUALITY_FLAGS, QUALITY_OBSERVE_AT, buildQuarters, convictionFor, coreEarnings, decideCandidate, earningsQualityFlags, lastQuarterYoy, type Candle, type CandidateRow, type CompanyFactsJson, type CoreEarnings, type Fundamentals } from "../index.js";

const nutx = JSON.parse(readFileSync("test/fixtures/nutx-companyfacts.json", "utf8")) as CompanyFactsJson;
const M = (n: number | null) => (n === null ? null : Math.round(n / 1e5) / 10);

describe("calidad de la ganancia: NUTX (companyfacts real, TTM al Q2 2026)", () => {
  const quarters = buildQuarters(nutx);
  const core = coreEarnings(quarters)!;
  it("lee la ganancia de los socios minoritarios por trimestre (directa y por diferencia de acumulados)", () => {
    const byEnd = Object.fromEntries(quarters.map((q) => [q.end, q]));
    expect(M(byEnd["2026-06-30"]!.noncontrolling)).toBe(30.5);
    expect(M(byEnd["2026-03-31"]!.noncontrolling)).toBe(16);
    expect(M(byEnd["2025-09-30"]!.noncontrolling)).toBe(41.4); // 9M − 6M
    expect(M(byEnd["2025-12-31"]!.noncontrolling)).toBe(4.8); // FY − 9M
  });
  it("resta los socios minoritarios del neto núcleo: EPS núcleo ≈ 28, no 41", () => {
    expect(M(core.noncontrollingTTM)).toBe(92.6);
    expect(M(core.coreOperatingIncomeTTM)).toBe(364.3);
    expect(core.taxRate).toBeCloseTo(0.2067, 3);
    expect(M(core.coreNetIncomeTTM)).toBe(196.4);
    expect(core.coreEpsTTM).toBeCloseTo(28, 0);
    expect(core.deviationPct).toBeCloseTo(-0.08, 1);
    expect(core.extraordinaryTTM).toBe(0);
  });
  it("último trimestre contra el año anterior: ingresos −13,6%, operativo +261%", () => {
    expect(core.lastQuarterYoy).toEqual({ end: "2026-06-30", revenuePct: expect.closeTo(-13.6, 0), operatingPct: expect.closeTo(261, -1) });
  });
  it("NUTX no tagea cuentas a cobrar con un elemento estándar: queda null, sin bandera", () => {
    expect(core.receivablesPctRevenue).toBeNull();
  });
  it("banderas: interés minoritario (32% de la ganancia) y ganancia sin ventas", () => {
    expect(earningsQualityFlags(core)).toEqual(["interes_minoritario", "ganancia_sin_ventas"]);
  });
});

describe("earningsQualityFlags con umbrales", () => {
  const core = (o: Partial<CoreEarnings>): CoreEarnings => ({ asOf: "2026-06-30", revenueTTM: 1000, operatingIncomeTTM: 200, coreOperatingIncomeTTM: 200, netIncomeTTM: 150, coreNetIncomeTTM: 150, coreEpsTTM: 1.5, operatingCashFlowTTM: 100, freeCashFlowTTM: 90, equity: 500, taxRate: 0.21, extraordinaryTTM: 0, extraordinaryItems: [], deviationPct: 0, noncontrollingTTM: null, receivablesPctRevenue: null, lastQuarterYoy: null, ...o });
  it("sin datos no hay banderas; null o undefined tampoco", () => {
    expect(earningsQualityFlags(core({}))).toEqual([]);
    expect(earningsQualityFlags(null)).toEqual([]);
    expect(earningsQualityFlags(undefined)).toEqual([]);
  });
  it("socios minoritarios: 20% marca, 19% no; negativo (absorben pérdida) no", () => {
    expect(earningsQualityFlags(core({ noncontrollingTTM: 37.5 }))).toEqual(["interes_minoritario"]); // 37.5 / 187.5 = 20%
    expect(earningsQualityFlags(core({ noncontrollingTTM: 35 }))).toEqual([]);
    expect(earningsQualityFlags(core({ noncontrollingTTM: -50 }))).toEqual([]);
  });
  it("cuentas a cobrar: 35% de los ingresos marca, 34% no", () => {
    expect(earningsQualityFlags(core({ receivablesPctRevenue: 0.35 }))).toEqual(["cobranza_lenta"]);
    expect(earningsQualityFlags(core({ receivablesPctRevenue: 0.34 }))).toEqual([]);
  });
  it("ganancia sin ventas: ingresos cayendo y operativo +50%; con ingresos subiendo no; sin comparable no", () => {
    expect(earningsQualityFlags(core({ lastQuarterYoy: { end: "2026-06-30", revenuePct: -1, operatingPct: 50 } }))).toEqual(["ganancia_sin_ventas"]);
    expect(earningsQualityFlags(core({ lastQuarterYoy: { end: "2026-06-30", revenuePct: 5, operatingPct: 300 } }))).toEqual([]);
    expect(earningsQualityFlags(core({ lastQuarterYoy: { end: "2026-06-30", revenuePct: -20, operatingPct: 49 } }))).toEqual([]);
    expect(earningsQualityFlags(core({ lastQuarterYoy: { end: "2026-06-30", revenuePct: -20, operatingPct: null } }))).toEqual([]);
  });
  it("lastQuarterYoy exige un trimestre 350–380 días antes y base positiva", () => {
    const q = (end: string, revenue: number, operatingIncome: number) => ({ start: end, end, fp: "Q", revenue, operatingIncome, netIncome: 0, pretaxIncome: null, taxExpense: null, nonoperatingIncome: null, operatingCashFlow: null, capex: null, dilutedShares: null, equity: null, noncontrolling: null, receivables: null, extraordinary: [] });
    expect(lastQuarterYoy([q("2025-06-30", 100, -5), q("2026-06-30", 90, 20)])).toEqual({ end: "2026-06-30", revenuePct: -10, operatingPct: null });
    expect(lastQuarterYoy([q("2025-09-30", 100, 10), q("2026-06-30", 90, 20)])).toBeNull();
    expect(lastQuarterYoy([])).toBeNull();
  });
});

describe("liberación de reservas (aseguradoras) entra como ganancia extraordinaria", () => {
  const fact = (start: string, end: string, val: number) => ({ start, end, val, fp: "Q2", form: "10-Q", filed: "2026-08-05" });
  const json: CompanyFactsJson = {
    cik: 1,
    facts: {
      "us-gaap": {
        OperatingIncomeLoss: { units: { USD: [fact("2026-04-01", "2026-06-30", 60e6)] } },
        NetIncomeLoss: { units: { USD: [fact("2026-04-01", "2026-06-30", 45e6)] } },
        SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense: { units: { USD: [fact("2026-04-01", "2026-06-30", -23.38e6)] } },
      },
    },
  };
  it("el tag negativo (favorable) queda como ganancia positiva; HRTG Q2 2026 −23,4M → +23,4M", () => {
    const q = buildQuarters(json);
    expect(q).toHaveLength(1);
    expect(q[0]!.extraordinary).toEqual([{ tag: "SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense", value: 23.38e6 }]);
  });
});

describe("decideCandidate: dos o más salvedades de calidad o litigio → OBSERVAR", () => {
  const series = (closes: number[], start = "2025-09-01"): Candle[] => closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 1_000_000 }));
  const up = series(Array.from({ length: 260 }, (_, i) => 80 + (20 * i) / 259));
  const today = "2026-05-19";
  const f: Fundamentals = { symbol: "NUTX", asOf: today, metrics: { beta: 0.7, "totalDebt/totalEquityAnnual": 0.8 }, peers: [], industry: "Health Care", mcapUsd: 1.3e9, dollarVolumeUsd: 30e6, nextEarnings: null, insiderBuys90d: 0, insiderSells90d: 0, analyst: null, earningsSurprises: null, priceUsd: 100 } as unknown as Fundamentals;
  const policy = { technical: { maxReturn21dPct: 15, earningsWithinDays: 10 }, sizing: { riskPerTradePct: 1, maxPositionPct: 10, fallbackPortfolioUsd: 150_000 }, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  const core = coreEarnings(buildQuarters(nutx))!;
  it("NUTX con sus estados (dos salvedades) ya es OBSERVAR; con la demanda colectiva, tres", () => {
    const d = decideCandidate({ f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, core, events: [{ date: "2026-05-01", kind: "litigio", severity: "moderado", headline: "Faces Class-Action Lawsuit" }] }, policy);
    expect("excluded" in d).toBe(false);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("OBSERVAR");
      expect(d.reasons).toEqual(["salvedades_de_calidad"]);
      expect(d.flags).toEqual(expect.arrayContaining(["interes_minoritario", "ganancia_sin_ventas", "evento_moderado", "salvedades_de_calidad"]));
    }
    const sinEvento = decideCandidate({ f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, core }, policy);
    if (!("excluded" in sinEvento)) expect(sinEvento.verdict).toBe("OBSERVAR");
  });
  it("una sola salvedad sigue COMPRAR", () => {
    const one = { ...core, noncontrollingTTM: null };
    const d = decideCandidate({ f, candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, core: one }, policy);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("ganancia_sin_ventas");
      expect(d.flags).not.toContain("interes_minoritario");
    }
    expect(QUALITY_OBSERVE_AT).toBe(2);
    expect(QUALITY_FLAGS.has("evento_moderado")).toBe(true);
  });
});

describe("convicción: cada salvedad de calidad descuenta 0.3 y lo dice", () => {
  const base: CandidateRow = {
    candidateDate: "2026-09-10", symbol: "AAA", kind: "stock", verdict: "COMPRAR", score: 1.2, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 20,
    close: 100, entryLow: 100, entryHigh: 102, stop: 92, target: 116, sizeUsd: 10_000, sizeQty: 100, riskScore: 4, flags: [], nthAppearance: 1,
    summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null,
    close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null,
  };
  it("tres salvedades: −0.9 y tres textos", () => {
    const clean = convictionFor(base, null, {})!;
    const p = convictionFor({ ...base, flags: ["interes_minoritario", "cobranza_lenta", "ganancia_sin_ventas"] }, null, {})!;
    expect(p.conviction).toBeCloseTo(clean.conviction - 0.9, 4);
    expect(p.cautions.some((c) => c.includes("socios minoritarios"))).toBe(true);
    expect(p.cautions.some((c) => c.includes("cuentas a cobrar"))).toBe(true);
    expect(p.cautions.some((c) => c.includes("vendió menos"))).toBe(true);
    expect(p.allAligned).toBe(false);
  });
});

describe("eje de crecimiento", () => {
  it("incluye el último trimestre interanual", () => {
    expect(AXIS_METRICS.growth.map((m) => m.key)).toContain("revenueGrowthQuarterlyYoy");
  });
});
