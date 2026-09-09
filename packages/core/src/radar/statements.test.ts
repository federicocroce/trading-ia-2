import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCoreMetrics, buildQuarters, coreEarnings, type CompanyFactsJson, type Fundamentals } from "../index.js";

const zvra = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8")) as CompanyFactsJson;
const M = (n: number | null) => (n === null ? null : Math.round(n / 1e5) / 10); // millones con un decimal

describe("buildQuarters (SEC companyfacts)", () => {
  const q = buildQuarters(zvra);
  const byEnd = Object.fromEntries(q.map((x) => [x.end, x]));
  it("devuelve hasta 8 trimestres ascendentes y termina en el Q2 2026", () => {
    expect(q.length).toBeGreaterThanOrEqual(6);
    expect(q.length).toBeLessThanOrEqual(8);
    expect(q[q.length - 1]!.end).toBe("2026-06-30");
    expect(q.map((x) => x.end)).toEqual([...q.map((x) => x.end)].sort());
  });
  it("toma los trimestres directos (80–100 días)", () => {
    expect(M(byEnd["2026-06-30"]!.operatingIncome)).toBe(16.8);
    expect(M(byEnd["2026-06-30"]!.netIncome)).toBe(8.8);
    expect(M(byEnd["2026-03-31"]!.operatingIncome)).toBe(52.1);
  });
  it("deriva el Q4 como anual menos nueve meses", () => {
    const q4 = byEnd["2025-12-31"]!;
    expect(q4.fp).toBe("Q4");
    // Precisión de la fuente (USD, no millones redondeados): FY -62,943,000 - 9M -72,258,000 = 9,315,000 → 9.3M.
    expect(M(q4.operatingIncome)).toBe(9.3);
    // FY 83,229,000 - 9M 71,064,000 = 12,165,000 → 12.2M.
    expect(M(q4.netIncome)).toBe(12.2);
    // FY 3,449,000 - 9M 2,948,000 = 501,000 → 0.5M.
    expect(M(q4.taxExpense)).toBe(0.5);
  });
  it("los flujos de caja (solo acumulados) salen por diferencia", () => {
    // 6M 23,174,000 - Q1 6,142,000 = 17,032,000 → 17.0M.
    expect(M(byEnd["2026-06-30"]!.operatingCashFlow)).toBe(17.0);
    expect(M(byEnd["2026-03-31"]!.operatingCashFlow)).toBe(6.1);
  });
  it("patrimonio y acciones diluidas del trimestre; ingresos por prioridad de tags", () => {
    expect(M(byEnd["2026-06-30"]!.equity)).toBe(217.7);
    expect(Math.round(byEnd["2026-06-30"]!.dilutedShares! / 1e5) / 10).toBe(61.3);
    expect(M(byEnd["2026-06-30"]!.revenue)).toBe(39.7);
  });
  it("captura todos los ítems extraordinarios del Q1 2026, con signo, y deduplica el mismo hecho re-tageado", () => {
    // El fixture real trae, además de la ganancia por disposición de activos, la misma cifra
    // re-tageada bajo GainLossOnDispositionOfIntangibleAssets (double-tagging real de XBRL): se
    // descarta por tener el mismo valor exacto que GainLossOnDispositionOfAssets1, que se conserva
    // por venir primero. También hay una pérdida por extinción de deuda, un deterioro de intangibles
    // y una baja de inventario: todos hechos directos de 89 días (2026-01-01..2026-03-31) en us-gaap.
    expect(byEnd["2026-03-31"]!.extraordinary).toEqual([
      { tag: "GainLossOnDispositionOfAssets1", value: 43_314_000 },
      { tag: "GainsLossesOnExtinguishmentOfDebt", value: -2_756_000 },
      { tag: "ImpairmentOfIntangibleAssetsFinitelived", value: -43_300_000 },
      { tag: "InventoryWriteDown", value: -485_000 },
    ]);
    expect(byEnd["2026-06-30"]!.extraordinary).toEqual([]);
    expect(byEnd["2026-06-30"]!.nonoperatingIncome).toBeLessThan(0); // Q2 2026: −4,0M (warrants)
  });
  it("sin hechos → sin trimestres", () => {
    expect(buildQuarters({ cik: 1, facts: {} })).toEqual([]);
  });
});

describe("coreEarnings (ZVRA, TTM al Q2 2026)", () => {
  const core = coreEarnings(buildQuarters(zvra))!;
  it("suma los últimos 4 trimestres y resta solo la ganancia operativa del Q1 2026", () => {
    expect(core.asOf).toBe("2026-06-30");
    expect(M(core.revenueTTM)).toBe(136.1);
    expect(M(core.operatingIncomeTTM)).toBe(82.4);
    expect(M(core.extraordinaryTTM)).toBe(43.3);
    expect(M(core.coreOperatingIncomeTTM)).toBe(39.1);
    expect(core.extraordinaryItems).toContainEqual({ tag: "GainLossOnDispositionOfAssets1", quarterEnd: "2026-03-31", value: 43_314_000 });
    expect(core.extraordinaryItems.filter((e) => e.value > 0)).toHaveLength(1);
    expect(core.extraordinaryItems.length).toBe(4); // el resto son cargos y pérdidas, informativos
  });
  it("una ganancia explicada por el resultado no operativo no se resta; los cargos no se suman", () => {
    const q = buildQuarters(zvra).slice(-4);
    const last = q[3]!;
    const nonOp = [...q.slice(0, 3), { ...last, nonoperatingIncome: 99e6, extraordinary: [{ tag: "GainLossOnDispositionOfIntangibleAssets", value: 100e6 }] }];
    expect(M(coreEarnings(nonOp)!.extraordinaryTTM)).toBe(43.3); // la de 100M no cuenta
    const op = [...q.slice(0, 3), { ...last, nonoperatingIncome: 0, extraordinary: [{ tag: "GainLossOnDispositionOfIntangibleAssets", value: 100e6 }] }];
    expect(M(coreEarnings(op)!.extraordinaryTTM)).toBe(143.3);
    const charged = q.map((x) => ({ ...x, extraordinary: [{ tag: "AssetImpairmentCharges", value: -50e6 }] }));
    expect(coreEarnings(charged)!.coreOperatingIncomeTTM).toBe(coreEarnings(charged)!.operatingIncomeTTM);
  });
  it("tasa efectiva acotada, neto núcleo, EPS núcleo y desvío", () => {
    expect(core.taxRate).toBeGreaterThan(0.1);
    expect(core.taxRate).toBeLessThan(0.2);
    expect(M(core.coreNetIncomeTTM)).toBeGreaterThan(31);
    expect(M(core.coreNetIncomeTTM)).toBeLessThan(35);
    expect(core.coreEpsTTM!).toBeGreaterThan(0.5);
    expect(core.coreEpsTTM!).toBeLessThan(0.58);
    expect(core.deviationPct!).toBeGreaterThan(0.38);
    expect(core.deviationPct!).toBeLessThan(0.48);
    expect(M(core.freeCashFlowTTM)).toBeGreaterThan(25);
  });
  it("con menos de 4 trimestres completos no hay núcleo; 21% por defecto sin impuestos", () => {
    expect(coreEarnings(buildQuarters(zvra).slice(-3))).toBeNull();
    const flat = buildQuarters(zvra).slice(-4).map((q) => ({ ...q, taxExpense: null, pretaxIncome: null, extraordinary: [] }));
    expect(coreEarnings(flat)!.taxRate).toBe(0.21);
    expect(coreEarnings(flat)!.deviationPct).toBeLessThan(0.25);
  });
  it("operativo negativo: sin escudo fiscal (núcleo = operativo)", () => {
    const loss = buildQuarters(zvra).slice(-4).map((q) => ({ ...q, operatingIncome: -1e6, extraordinary: [] }));
    expect(coreEarnings(loss)!.coreNetIncomeTTM).toBe(-4e6);
  });
});

describe("applyCoreMetrics", () => {
  const f = (over: Partial<Fundamentals> = {}): Fundamentals => ({ symbol: "ZVRA", asOf: "2026-09-07", metrics: { peTTM: 12.8462, roeTTM: 32.77, operatingMarginTTM: 60.54, netProfitMarginTTM: 42.82, psTTM: 5.5 }, peers: [], industry: "Pharmaceuticals", mcapUsd: 748e6, dollarVolumeUsd: 10e6, priceUsd: 12.57, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null, ...over });
  const core = coreEarnings(buildQuarters(zvra));
  it("reemplaza P/E, ROE y márgenes con la ganancia núcleo y conserva Finnhub en metricsRaw", () => {
    const out = applyCoreMetrics(f(), core, 12.57);
    expect(out.metrics["peTTM"]!).toBeGreaterThan(22);
    expect(out.metrics["peTTM"]!).toBeLessThan(25);
    expect(out.metrics["operatingMarginTTM"]!).toBeGreaterThan(28);
    expect(out.metrics["operatingMarginTTM"]!).toBeLessThan(30);
    expect(out.metrics["netProfitMarginTTM"]!).toBeLessThan(26);
    expect(out.metrics["roeTTM"]!).toBeLessThan(17);
    expect(out.metrics["psTTM"]).toBe(5.5); // lo que no se recalcula queda igual
    expect(out.metricsRaw?.["peTTM"]).toBe(12.8462);
    expect(out.statementsAsOf).toBe("2026-06-30");
  });
  it("sin núcleo: no toca métricas y marca statementsAsOf null", () => {
    const out = applyCoreMetrics(f(), null, 12.57);
    expect(out.metrics["peTTM"]).toBe(12.8462);
    expect(out.statementsAsOf).toBeNull();
  });
  it("EPS núcleo ≤ 0 → P/E null (se trata como faltante en el ranking)", () => {
    const out = applyCoreMetrics(f(), { ...core!, coreEpsTTM: -0.1 }, 12.57);
    expect(out.metrics["peTTM"]).toBeNull();
  });
});
