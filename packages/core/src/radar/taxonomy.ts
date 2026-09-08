import { z } from "zod";
import type { AssetClass, EtfConfig, Tags, TaxonomyConfig } from "./types.js";

/**
 * Taxonomía por ticker (spec etapa 2 §5): clase de activo, sector por tabla, temas por reglas.
 * Lo manual nunca se pisa; lo que no está en la lista de temas se descarta (el modelo no inventa categorías).
 */
export const AssetClassSchema = z.enum(["accion_us", "adr", "accion_ar", "cedear", "etf", "bono", "commodity", "cripto", "efectivo"]);
export const TaxonomyConfigSchema = z.object({
  sectors: z.array(z.string()),
  themes: z.array(z.string()),
  industryToSector: z.record(z.string()),
  industryToThemes: z.record(z.array(z.string())),
  symbolToThemes: z.record(z.array(z.string())),
  symbolToAssetClass: z.record(AssetClassSchema),
});
export const EtfConfigSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  role: z.enum(["nucleo", "satelite", "cobertura"]),
  exposure: z.enum(["rv_us", "rv_internacional", "emergentes", "sector", "commodity", "bonos", "cripto", "argentina"]),
  ter: z.number(),
  themes: z.array(z.string()),
  coreWeight: z.number().optional(),
});
export const ArgentinaConfigSchema = z.object({
  benchmark: z.string(),
  acciones: z.array(z.object({ symbol: z.string(), name: z.string(), adr: z.string().nullable(), sector: z.string(), themes: z.array(z.string()).optional() })),
  cedears: z.array(z.object({ symbol: z.string(), us: z.string(), ratio: z.number().positive() })),
});
export const RadarPolicySchema = z.object({
  weights: z.object({ valuation: z.number(), quality: z.number(), growth: z.number(), balance: z.number() }),
  quality: z.object({ minMcapUsd: z.number(), minDollarVolumeUsd: z.number(), minPrice: z.number() }),
  prefilter: z.object({ minPrice: z.number(), minIexDollarVolume: z.number() }),
  technical: z.object({ maxReturn21dPct: z.number(), earningsWithinDays: z.number() }),
  sizing: z.object({ riskPerTradePct: z.number(), maxPositionPct: z.number(), fallbackPortfolioUsd: z.number() }),
  candidates: z.object({ top: z.number(), preselect: z.number(), chronicWeeks: z.number() }),
  contribution: z.object({ monthlyUsd: z.number(), coreTargetPct: z.number(), maxPositionPct: z.number(), maxNewPositionsPerMonth: z.number(), maxLinePctOfContribution: z.number() }),
});

export function assetClassFor(i: { symbol: string; country: string | null; isEtf: boolean; positionMarket?: "us" | "adr" | "ar" }, t: TaxonomyConfig): AssetClass {
  if (i.isEtf) return "etf";
  const override = t.symbolToAssetClass[i.symbol.toUpperCase()];
  if (override) return override;
  if (i.positionMarket === "adr") return "adr";
  if (i.positionMarket === "ar") return "accion_ar";
  if (i.country && i.country !== "US") return "adr";
  return "accion_us";
}

export function sectorFor(industry: string | null, t: TaxonomyConfig): string {
  return (industry && t.industryToSector[industry]) || "Otros";
}

const onlyKnown = (xs: string[], t: TaxonomyConfig) => [...new Set(xs)].filter((x) => t.themes.includes(x));

export function themesFor(i: { symbol: string; industry: string | null; etf?: EtfConfig }, t: TaxonomyConfig): string[] {
  const fromIndustry = i.industry ? (t.industryToThemes[i.industry] ?? []) : [];
  const fromSymbol = t.symbolToThemes[i.symbol.toUpperCase()] ?? [];
  return onlyKnown([...fromIndustry, ...fromSymbol, ...(i.etf?.themes ?? [])], t);
}

/** Manual nunca se pisa. Modelo y regla se suman; el origen queda como el más "fuerte" (modelo > regla). */
export function mergeThemes(
  current: { themes: string[]; source: Tags["themesSource"] } | null,
  proposed: string[],
  proposedSource: "regla" | "modelo",
  t: TaxonomyConfig,
): { themes: string[]; source: Tags["themesSource"] } {
  if (current?.source === "manual") return current;
  const themes = onlyKnown([...(current?.themes ?? []), ...proposed], t);
  const source = current?.source === "modelo" || proposedSource === "modelo" ? "modelo" : "regla";
  return { themes, source };
}
