/** Radar (etapa 2): tipos y puertos. Sin I/O. */
export type AssetClass = "accion_us" | "adr" | "accion_ar" | "cedear" | "etf" | "bono" | "commodity" | "cripto" | "efectivo";
export type EtfRole = "nucleo" | "satelite" | "cobertura";
export type EtfExposure = "rv_us" | "rv_internacional" | "emergentes" | "sector" | "commodity" | "bonos" | "cripto" | "argentina";

export interface EtfConfig {
  symbol: string;
  name: string;
  role: EtfRole;
  exposure: EtfExposure;
  ter: number;
  themes: string[];
  /** Peso objetivo dentro del núcleo (solo role nucleo). */
  coreWeight?: number;
}

export interface TaxonomyConfig {
  sectors: string[];
  themes: string[];
  industryToSector: Record<string, string>;
  industryToThemes: Record<string, string[]>;
  symbolToThemes: Record<string, string[]>;
  symbolToAssetClass: Record<string, AssetClass>;
}

export interface RadarPolicy {
  weights: { valuation: number; quality: number; growth: number; balance: number };
  quality: { minMcapUsd: number; minDollarVolumeUsd: number; minPrice: number };
  prefilter: { minPrice: number; minIexDollarVolume: number };
  technical: { maxReturn21dPct: number; earningsWithinDays: number };
  sizing: { riskPerTradePct: number; maxPositionPct: number; fallbackPortfolioUsd: number };
  candidates: { top: number; preselect: number; chronicWeeks: number };
  contribution: { monthlyUsd: number; coreTargetPct: number; maxPositionPct: number; maxNewPositionsPerMonth: number };
}

export type ThemesSource = "regla" | "modelo" | "manual";
export interface Tags {
  assetClass: AssetClass;
  sector: string;
  industry: string | null;
  themes: string[];
  themesSource: ThemesSource;
}
