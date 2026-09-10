import type { CompanyFactsJson, CoreEarnings, QuarterStatement } from "./types.js";
import type { FinnhubMetrics } from "./universe.js";
import type { Fundamentals } from "./ranking.js";

/**
 * Estados trimestrales desde XBRL (SEC companyfacts) y ganancia núcleo (spec verificación §4). Puro.
 * Un trimestre es una duración de 80–100 días; lo acumulado se deriva por diferencia con el acumulado anterior.
 */
export const REVENUE_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];
const OPERATING_TAGS = ["OperatingIncomeLoss"];
const NET_TAGS = ["NetIncomeLoss", "ProfitLoss"];
const PRETAX_TAGS = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"];
const TAX_TAGS = ["IncomeTaxExpenseBenefit"];
const NONOPERATING_TAGS = ["NonoperatingIncomeExpense", "OtherNonoperatingIncomeExpense"];
const OCF_TAGS = ["NetCashProvidedByUsedInOperatingActivities"];
const CAPEX_TAGS = ["PaymentsToAcquirePropertyPlantAndEquipment"];
const SHARES_TAGS = ["WeightedAverageNumberOfDilutedSharesOutstanding"];
const EQUITY_TAGS = ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"];
/** Con signo: las ganancias inflan el resultado (se restan para el núcleo); los cargos lo deprimen (se suman). */
export const EXTRAORDINARY_TAGS = {
  gains: ["GainLossOnDispositionOfAssets", "GainLossOnDispositionOfAssets1", "GainLossOnSaleOfBusiness", "GainLossOnDispositionOfIntangibleAssets", "GainLossOnSaleOfPropertyPlantEquipment", "GainsLossesOnExtinguishmentOfDebt", "DeconsolidationGainOrLossAmount", "BusinessCombinationBargainPurchaseGainRecognizedAmount"],
  charges: ["AssetImpairmentCharges", "ImpairmentOfLongLivedAssetsHeldForUse", "ImpairmentOfIntangibleAssetsExcludingGoodwill", "ImpairmentOfIntangibleAssetsFinitelived", "GoodwillImpairmentLoss", "RestructuringCharges", "LitigationSettlementExpense", "InventoryWriteDown"],
};
const FORMS = new Set(["10-Q", "10-K", "10-Q/A", "10-K/A"]);
const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const isQuarter = (d: number) => d >= 80 && d <= 100;

interface Fact { start: string | null; end: string; val: number; fp: string; filed: string }

/** Hechos de un tag (primera unidad), solo 10-Q/10-K, sin duplicados por (start, end): gana el `filed` más reciente. */
function factsOf(json: CompanyFactsJson, tag: string): Fact[] {
  const units = json.facts["us-gaap"]?.[tag]?.units;
  const first = units ? Object.values(units)[0] : undefined;
  if (!first) return [];
  const byKey = new Map<string, Fact>();
  for (const r of first) {
    if (r.form && !FORMS.has(r.form)) continue;
    const f: Fact = { start: r.start ?? null, end: r.end, val: r.val, fp: r.fp ?? "", filed: r.filed ?? "" };
    const k = `${f.start ?? ""}|${f.end}`;
    const prev = byKey.get(k);
    if (!prev || f.filed > prev.filed) byKey.set(k, f);
  }
  return [...byKey.values()];
}

/** Valor del trimestre que termina en `end`: directo (80–100 días) o acumulado menos el acumulado anterior con el mismo inicio. */
function quarterValue(facts: Fact[], end: string): { val: number; fp: string } | null {
  const direct = facts.find((f) => f.start && f.end === end && isQuarter(days(f.start, f.end)));
  if (direct) return { val: direct.val, fp: direct.fp };
  const cumul = facts.filter((f) => f.start && f.end === end && days(f.start, f.end) > 100).sort((a, b) => days(a.start!, a.end) - days(b.start!, b.end));
  for (const c of cumul) {
    const prev = facts.find((f) => f.start === c.start && f.end !== end && isQuarter(days(f.end, end)));
    if (prev) return { val: c.val - prev.val, fp: days(c.start!, c.end) > 300 ? "Q4" : c.fp };
  }
  return null;
}

function firstQuarterValue(json: CompanyFactsJson, tags: string[], end: string): { val: number; fp: string } | null {
  for (const t of tags) {
    const v = quarterValue(factsOf(json, t), end);
    if (v) return v;
  }
  return null;
}
function instantValue(json: CompanyFactsJson, tags: string[], end: string): number | null {
  for (const t of tags) {
    const f = factsOf(json, t).find((x) => !x.start && x.end === end);
    if (f) return f.val;
  }
  return null;
}

export function buildQuarters(json: CompanyFactsJson): QuarterStatement[] {
  // Fines de trimestre: todo `end` con resultado neto u operativo obtenible.
  const ends = new Set<string>();
  for (const tag of [...NET_TAGS, ...OPERATING_TAGS]) for (const f of factsOf(json, tag)) if (f.start) ends.add(f.end);
  const out: QuarterStatement[] = [];
  for (const end of [...ends].sort()) {
    const op = firstQuarterValue(json, OPERATING_TAGS, end);
    const net = firstQuarterValue(json, NET_TAGS, end);
    if (!op && !net) continue;
    const startFact = [...OPERATING_TAGS, ...NET_TAGS].flatMap((t) => factsOf(json, t)).find((f) => f.start && f.end === end && isQuarter(days(f.start, f.end)));
    const start = startFact?.start ?? new Date(Date.parse(end) - 91 * DAY).toISOString().slice(0, 10);
    const extraordinary: Array<{ tag: string; value: number }> = [];
    for (const tag of EXTRAORDINARY_TAGS.gains) {
      const v = quarterValue(factsOf(json, tag), end);
      if (v && v.val !== 0) extraordinary.push({ tag, value: v.val });
    }
    for (const tag of EXTRAORDINARY_TAGS.charges) {
      const v = quarterValue(factsOf(json, tag), end);
      if (v && v.val !== 0) extraordinary.push({ tag, value: -Math.abs(v.val) });
    }
    // El mismo hecho puede llegar re-tageado bajo dos tags XBRL con el mismo valor exacto: se conserva el primero.
    const seen = new Set<number>();
    const unique = extraordinary.filter((e) => (seen.has(e.value) ? false : (seen.add(e.value), true)));
    out.push({
      start,
      end,
      fp: op?.fp || net?.fp || "",
      revenue: firstQuarterValue(json, REVENUE_TAGS, end)?.val ?? null,
      operatingIncome: op?.val ?? null,
      netIncome: net?.val ?? null,
      pretaxIncome: firstQuarterValue(json, PRETAX_TAGS, end)?.val ?? null,
      taxExpense: firstQuarterValue(json, TAX_TAGS, end)?.val ?? null,
      nonoperatingIncome: firstQuarterValue(json, NONOPERATING_TAGS, end)?.val ?? null,
      operatingCashFlow: firstQuarterValue(json, OCF_TAGS, end)?.val ?? null,
      capex: firstQuarterValue(json, CAPEX_TAGS, end)?.val ?? null,
      dilutedShares: firstQuarterValue(json, SHARES_TAGS, end)?.val ?? null,
      equity: instantValue(json, EQUITY_TAGS, end),
      extraordinary: unique,
    });
  }
  return out.slice(-8);
}

const DEVIATION_FLAG = 0.25;
const DEFAULT_TAX = 0.21;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const sumOrNull = (xs: Array<number | null>): number | null => (xs.some((x) => x === null) ? null : xs.reduce<number>((a, b) => a + (b as number), 0));

/** Ganancia núcleo sobre los últimos 4 trimestres (spec verificación §4): operativo núcleo = operativo − ganancias extraordinarias operativas. null si no hay 4 con operativo y neto. */
export function coreEarnings(quarters: QuarterStatement[]): CoreEarnings | null {
  const last4 = quarters.filter((q) => q.operatingIncome !== null && q.netIncome !== null).slice(-4);
  if (last4.length < 4) return null;
  const operatingIncomeTTM = sumOrNull(last4.map((q) => q.operatingIncome))!;
  const netIncomeTTM = sumOrNull(last4.map((q) => q.netIncome))!;
  const extraordinaryItems = last4.flatMap((q) => q.extraordinary.map((e) => ({ tag: e.tag, quarterEnd: q.end, value: e.value })));
  /** Una ganancia extraordinaria se resta del operativo solo si es positiva y no está explicada por el resultado no operativo del trimestre
   *  (si NonoperatingIncomeExpense ≥ 80% de la ganancia, la ganancia vive fuera del operativo: caso del voucher de ZVRA en Q2 2025).
   *  Cargos e impairments NO se suman de vuelta: en XBRL muchos viven en notas, no en el estado de resultados (caso ZVRA Q1 2026). */
  const NONOPERATING_SHARE = 0.8;
  const operatingGain = (q: QuarterStatement, e: { value: number }) => e.value > 0 && !(q.nonoperatingIncome !== null && q.nonoperatingIncome >= NONOPERATING_SHARE * e.value);
  const extraordinaryTTM = last4.reduce((s, q) => s + q.extraordinary.filter((e) => operatingGain(q, e)).reduce((a, e) => a + e.value, 0), 0);
  const coreOperatingIncomeTTM = operatingIncomeTTM - extraordinaryTTM;
  const pretax = sumOrNull(last4.map((q) => q.pretaxIncome));
  const tax = sumOrNull(last4.map((q) => q.taxExpense));
  const taxRate = pretax !== null && tax !== null && pretax > 0 ? r4(Math.min(0.35, Math.max(0, tax / pretax))) : DEFAULT_TAX;
  // Con pérdida operativa no hay escudo fiscal: el núcleo es el operativo.
  const coreNetIncomeTTM = coreOperatingIncomeTTM > 0 ? coreOperatingIncomeTTM * (1 - taxRate) : coreOperatingIncomeTTM;
  const shares = last4[last4.length - 1]!.dilutedShares;
  const coreEpsTTM = shares && shares > 0 ? r4(coreNetIncomeTTM / shares) : null;
  const ocf = sumOrNull(last4.map((q) => q.operatingCashFlow));
  const capex = sumOrNull(last4.map((q) => q.capex));
  const deviationPct = r4((netIncomeTTM - coreNetIncomeTTM) / Math.max(Math.abs(netIncomeTTM), Math.abs(coreNetIncomeTTM), 1));
  return {
    asOf: last4[last4.length - 1]!.end,
    revenueTTM: sumOrNull(last4.map((q) => q.revenue)),
    operatingIncomeTTM,
    coreOperatingIncomeTTM,
    netIncomeTTM,
    coreNetIncomeTTM,
    coreEpsTTM,
    operatingCashFlowTTM: ocf,
    freeCashFlowTTM: ocf === null ? null : ocf - (capex ?? 0),
    equity: last4[last4.length - 1]!.equity,
    taxRate,
    extraordinaryTTM,
    extraordinaryItems,
    deviationPct,
  };
}

/** Bandera `resultado_extraordinario`: solo con ganancias extraordinarias operativas identificadas (`extraordinaryTTM ≠ 0`) y un desvío > 25%. Sin one-offs identificados, la fórmula ignora intereses (NOPAT) y un desvío grande no dice nada sobre extraordinarios: no se marca. */
export const hasExtraordinary = (core: CoreEarnings | null | undefined): boolean =>
  !!core && core.extraordinaryTTM !== 0 && core.deviationPct !== null && Math.abs(core.deviationPct) > DEVIATION_FLAG;

/** Reemplaza P/E, ROE y márgenes por las cifras núcleo; Finnhub queda en `metricsRaw`. Sin núcleo o sin ingresos: nada cambia, `statementsAsOf` null.
 *  Sin ganancias extraordinarias operativas identificadas (`extraordinaryTTM === 0`): tampoco se reemplaza (el núcleo ignora intereses y sesgaría a
 *  favor de empresas apalancadas), pero `statementsAsOf` sí se marca: los estados están disponibles y se muestran. */
export function applyCoreMetrics(f: Fundamentals, core: CoreEarnings | null, priceUsd: number): Fundamentals {
  const raw = f.metricsRaw ?? f.metrics;
  if (!core || core.revenueTTM === null || core.revenueTTM <= 0 || core.coreOperatingIncomeTTM === null) return { ...f, metrics: raw, metricsRaw: raw, statementsAsOf: null };
  if (core.extraordinaryTTM === 0) return { ...f, metrics: raw, metricsRaw: raw, statementsAsOf: core.asOf };
  const metrics: FinnhubMetrics = { ...raw };
  metrics["peTTM"] = core.coreEpsTTM !== null && core.coreEpsTTM > 0 ? r4(priceUsd / core.coreEpsTTM) : null;
  metrics["operatingMarginTTM"] = r4((core.coreOperatingIncomeTTM / core.revenueTTM) * 100);
  metrics["netProfitMarginTTM"] = core.coreNetIncomeTTM === null ? raw["netProfitMarginTTM"] : r4((core.coreNetIncomeTTM / core.revenueTTM) * 100);
  metrics["roeTTM"] = core.equity && core.equity > 0 && core.coreNetIncomeTTM !== null ? r4((core.coreNetIncomeTTM / core.equity) * 100) : raw["roeTTM"];
  return { ...f, metrics, metricsRaw: raw, statementsAsOf: core.asOf };
}
