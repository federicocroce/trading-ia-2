import type { CompanyFactsJson, QuarterStatement } from "./types.js";

/**
 * Estados trimestrales desde XBRL (SEC companyfacts) y ganancia núcleo (spec verificación §4). Puro.
 * Un trimestre es una duración de 80–100 días; lo acumulado se deriva por diferencia con el acumulado anterior.
 */
export const REVENUE_TAGS = ["Revenues", "RevenueFromContractWithCustomerExcludingAssessedTax", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"];
const OPERATING_TAGS = ["OperatingIncomeLoss"];
const NET_TAGS = ["NetIncomeLoss", "ProfitLoss"];
const PRETAX_TAGS = ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments"];
const TAX_TAGS = ["IncomeTaxExpenseBenefit"];
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
    out.push({
      start,
      end,
      fp: op?.fp || net?.fp || "",
      revenue: firstQuarterValue(json, REVENUE_TAGS, end)?.val ?? null,
      operatingIncome: op?.val ?? null,
      netIncome: net?.val ?? null,
      pretaxIncome: firstQuarterValue(json, PRETAX_TAGS, end)?.val ?? null,
      taxExpense: firstQuarterValue(json, TAX_TAGS, end)?.val ?? null,
      operatingCashFlow: firstQuarterValue(json, OCF_TAGS, end)?.val ?? null,
      capex: firstQuarterValue(json, CAPEX_TAGS, end)?.val ?? null,
      dilutedShares: firstQuarterValue(json, SHARES_TAGS, end)?.val ?? null,
      equity: instantValue(json, EQUITY_TAGS, end),
      extraordinary,
    });
  }
  return out.slice(-8);
}
