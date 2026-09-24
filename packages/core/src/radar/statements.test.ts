import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCoreMetrics, buildQuarters, coreEarnings, hasExtraordinary, type CompanyFactsJson, type Fundamentals, type QuarterStatement } from "../index.js";

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

/**
 * 24/9: LLY entraba al plan con `sin_estados` aunque presenta 10-Q: no publica `OperatingIncomeLoss` (va directo al
 * resultado antes de impuestos), así que la ganancia núcleo no se calculaba y el ranking usaba lo de Finnhub. Lo mismo
 * 110 empresas de 521 sin núcleo (MRK, JNJ, GLXY, REITs, químicas). Si la empresa publica el resultado antes de
 * impuestos y el no operativo, el operativo es la resta. Los cuatro trimestres son los de la SEC guardados el 20/9.
 */
describe("coreEarnings sin OperatingIncomeLoss (LLY, 24/9)", () => {
  const base = { capex: null, equity: 30e9, receivables: 18e9, extraordinary: [], noncontrolling: null, operatingIncome: null, operatingCashFlow: 5e9 };
  const lly: QuarterStatement[] = [
    { ...base, fp: "Q3", start: "2025-07-01", end: "2025-09-30", revenue: 17_600_800_000, netIncome: 5_582_500_000, taxExpense: 1_649_900_000, pretaxIncome: 7_232_400_000, dilutedShares: 898_800_000, nonoperatingIncome: -133_100_000 },
    { ...base, fp: "Q4", start: "2025-10-01", end: "2025-12-31", revenue: 19_292_000_000, netIncome: 6_637_700_000, taxExpense: 1_628_500_000, pretaxIncome: 8_266_200_000, dilutedShares: -400_000, nonoperatingIncome: -108_300_000 },
    { ...base, fp: "Q1", start: "2026-01-01", end: "2026-03-31", revenue: 19_799_000_000, netIncome: 7_396_000_000, taxExpense: 1_454_000_000, pretaxIncome: 8_850_000_000, dilutedShares: 895_900_000, nonoperatingIncome: -65_000_000 },
    { ...base, fp: "Q2", start: "2026-04-01", end: "2026-06-30", revenue: 22_974_000_000, netIncome: 7_095_000_000, taxExpense: 2_152_000_000, pretaxIncome: 9_247_000_000, dilutedShares: 893_700_000, nonoperatingIncome: 269_000_000 },
  ];
  it("el operativo es el resultado antes de impuestos menos el no operativo", () => {
    const core = coreEarnings(lly)!;
    expect(core).not.toBeNull();
    // (7.232,4 + 133,1) + (8.266,2 + 108,3) + (8.850 + 65) + (9.247 − 269) = 33.633
    expect(M(core.operatingIncomeTTM)).toBe(33633);
    expect(core.coreEpsTTM).toBeGreaterThan(0);
  });
  it("sin el no operativo no se inventa: sigue sin núcleo (un banco, una aseguradora)", () => {
    expect(coreEarnings(lly.map((q) => ({ ...q, nonoperatingIncome: null })))).toBeNull();
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
  it("McDonald's del 12/9: una ganancia por acción absurda no reemplaza al P/E de la fuente", () => {
    // El extractor devolvía 711,1 acciones en vez de 711,1 millones, y el "P/E núcleo" daba 0,0 porque la
    // ganancia por acción salía 14 millones de dólares. Eso entraba en la tabla de comparables y en el score.
    const core = { asOf: "2026-09-12", revenueTTM: 26_000, operatingIncomeTTM: 11_000, coreOperatingIncomeTTM: 10_000, netIncomeTTM: 9_000, coreNetIncomeTTM: 8_000, coreEpsTTM: 14_224_666, operatingCashFlowTTM: null, freeCashFlowTTM: null, equity: 5_000, taxRate: 0.2, extraordinaryTTM: 1_000, extraordinaryItems: [], deviationPct: 0.11, noncontrollingTTM: null, receivablesPctRevenue: null, lastQuarterYoy: null };
    const f = { symbol: "MCD", asOf: "2026-09-12", metrics: { epsTTM: 12.5, peTTM: 20.6 }, peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 0, priceUsd: 257, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null };
    const r = applyCoreMetrics(f, core, 257);
    expect(r.metrics["peTTM"]).toBe(20.6); // se queda el de la fuente, no 0,0
    expect(r.metricsRaw!["peTTM"]).toBe(20.6);
  });

  it("una ganancia por acción del núcleo creíble sí reemplaza al P/E de la fuente", () => {
    const core = { asOf: "2026-09-12", revenueTTM: 1_000, operatingIncomeTTM: 200, coreOperatingIncomeTTM: 150, netIncomeTTM: 120, coreNetIncomeTTM: 90, coreEpsTTM: 9, operatingCashFlowTTM: null, freeCashFlowTTM: null, equity: 500, taxRate: 0.2, extraordinaryTTM: 30, extraordinaryItems: [], deviationPct: 0.25, noncontrollingTTM: null, receivablesPctRevenue: null, lastQuarterYoy: null };
    const f = { symbol: "X", asOf: "2026-09-12", metrics: { epsTTM: 12, peTTM: 10 }, peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 0, priceUsd: 120, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null };
    expect(applyCoreMetrics(f, core, 120).metrics["peTTM"]).toBeCloseTo(120 / 9, 2);
  });

  it("EPS núcleo ≤ 0 → P/E null (se trata como faltante en el ranking)", () => {
    const out = applyCoreMetrics(f(), { ...core!, coreEpsTTM: -0.1 }, 12.57);
    expect(out.metrics["peTTM"]).toBeNull();
  });
});

// Ronda final: sin ganancias extraordinarias operativas identificadas (extraordinaryTTM === 0), la fórmula
// núcleo ignora intereses (NOPAT) y puede mostrar un desvío grande contra el neto sin que sea extraordinario
// (empresa apalancada, con intereses). No debe marcarse la bandera ni reemplazarse las métricas.
describe("hasExtraordinary / applyCoreMetrics sin one-offs operativos (NOPAT)", () => {
  const f = (over: Partial<Fundamentals> = {}): Fundamentals => ({ symbol: "SYN", asOf: "2026-01-15", metrics: { peTTM: 15.2, roeTTM: 22.5, operatingMarginTTM: 20, netProfitMarginTTM: 9, psTTM: 3.1 }, peers: [], industry: "Industrials", mcapUsd: 5_000e6, dollarVolumeUsd: 20e6, priceUsd: 45, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null, ...over });
  const q = (end: string, start: string): QuarterStatement => ({
    start,
    end,
    fp: "Q",
    revenue: 500e6,
    operatingIncome: 100e6,
    netIncome: 45e6,
    pretaxIncome: 60e6,
    taxExpense: 15e6,
    nonoperatingIncome: 0,
    operatingCashFlow: 90e6,
    capex: 10e6,
    dilutedShares: 100e6,
    equity: 1_000e6,
    noncontrolling: null,
    receivables: null,
    extraordinary: [],
  });
  const noExtra = [
    q("2025-03-31", "2025-01-01"),
    q("2025-06-30", "2025-04-01"),
    q("2025-09-30", "2025-07-01"),
    q("2025-12-31", "2025-10-01"),
  ];
  const core = coreEarnings(noExtra)!;
  it("sin one-offs, el desvío contra el neto puede ser grande (intereses) pero no hay bandera", () => {
    expect(core.extraordinaryTTM).toBe(0);
    expect(Math.abs(core.deviationPct!)).toBeGreaterThan(0.25); // 400M núcleo op × 0.75 = 300M vs 180M neto reportado
    expect(hasExtraordinary(core)).toBe(false);
  });
  it("applyCoreMetrics no reemplaza peTTM/roeTTM/márgenes; statementsAsOf sí se marca", () => {
    const raw = f();
    const out = applyCoreMetrics(raw, core, 12.57);
    expect(out.metrics).toEqual(raw.metrics);
    expect(out.metrics["peTTM"]).toBe(raw.metrics["peTTM"]);
    expect(out.metrics["roeTTM"]).toBe(raw.metrics["roeTTM"]);
    expect(out.metrics["operatingMarginTTM"]).toBe(raw.metrics["operatingMarginTTM"]);
    expect(out.metrics["netProfitMarginTTM"]).toBe(raw.metrics["netProfitMarginTTM"]);
    expect(out.metricsRaw).toEqual(raw.metrics);
    expect(out.statementsAsOf).toBe(core.asOf);
  });
  it("ZVRA sigue con extraordinaryTTM ≠ 0: la bandera y el recálculo no cambian", () => {
    const zvraCore = coreEarnings(buildQuarters(zvra))!;
    expect(zvraCore.extraordinaryTTM).not.toBe(0);
    expect(hasExtraordinary(zvraCore)).toBe(true);
  });
});
