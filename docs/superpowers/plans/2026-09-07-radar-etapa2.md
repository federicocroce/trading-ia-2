# Radar etapa 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Candidatos nuevos para comprar (acciones US rankeadas contra pares + ETFs curados), plan del aporte mensual, taxonomía por ticker y medición contra SPY, en thesis-engine.

**Architecture:** Reglas puras en `packages/core/src/radar` (taxonomía, filtros de universo, z-scores contra pares, veredicto/tamaño/riesgo de candidatos, motor ETF, plan del aporte, medición). Adaptadores Alpaca (assets, snapshots por lote) y Finnhub (metric, peers, consenso, sorpresas, insiders, calendario) con limitador de 55/min. Pipeline `packages/pipeline/src/radar.ts` con jobs reanudables contra `RadarStore`. Ficha con `GeminiToolCaller`/Anthropic. Rutas `/radar/*` y `/taxonomy/*`, pestaña Radar, crons.

**Tech Stack:** igual que etapa 1. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-07-radar-etapa2-design.md`

## Global Constraints

- Fail-closed en todo filtro: dato faltante = no pasa, con motivo.
- Capitalización USD = `shareOutstanding × precio USD (Alpaca)`; volumen USD = `3MonthAverageTradingVolume × 1e6 × precio USD`. Nunca `marketCapitalization` de Finnhub.
- Quality bar: capitalización ≥ 500M, volumen ≥ 5M/día, precio ≥ 5. Pre-filtro Alpaca: precio ≥ 5 y `volumen IEX × precio ≥ 500.000`.
- Score = 0.35 valuación + 0.30 calidad + 0.25 crecimiento + 0.10 balance, z robusto (mediana/MAD × 1.4826, winsor ±3), reponderado si falta un eje; ≤ 1 eje → no rankea. Grupo: pares ∩ universo (máx 10); < 4 → industria; < 4 → `sin_pares`.
- Técnico filtra: cierre < SMA200 → excluido; retorno 21 velas > 15% → OBSERVAR; resultados ≤ 10 días → OBSERVAR; sin 200 velas → excluido. Residente crónico: 4ª semana seguida → OBSERVAR.
- Tamaño: 1% del valor de Cartera de riesgo entre entrada alta y stop; tope 10% del valor; sin snapshot, `fallbackPortfolioUsd`. Riesgo 1–10 según tabla de la spec §6.
- El modelo solo degrada COMPRAR → OBSERVAR. Temas fuera de la lista se descartan.
- Finnhub: ≤ 55 llamadas/min. Barrido reanudable por `universe_scan`.
- Commit por task, mensajes en español, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. TDD.

## File Structure

- `config/taxonomia.json`, `config/etfs.json`, `config/radar-policy.json` — configuración editable.
- `packages/core/src/radar/types.ts` — tipos: `AssetClass`, `Sector`, `TaxonomyConfig`, `EtfConfig`, `RadarPolicy`, `Fundamentals`, `RankedStock`, `Candidate`, `ContributionPlan`, puertos `AssetList`, `BatchQuotes`, `FundamentalsSource`, `CandidateContext`, `CardWriter`.
- `packages/core/src/radar/taxonomy.ts` — `assetClassFor`, `sectorFor`, `themesFor`, `mergeThemes`, `loadTaxonomy` (Zod).
- `packages/core/src/radar/universe.ts` — `isEligibleAsset`, `passesPreFilter`, `qualityBar`, `mcapUsd`, `dollarVolumeUsd`.
- `packages/core/src/radar/ranking.ts` — `robustZ`, `axisScore`, `compositeScore`, `peerGroup`, `rankStocks`.
- `packages/core/src/radar/candidate.ts` — `technicalGate`, `decideCandidate`, `positionSize`, `riskScore`, `buildFlags`, `sma`, `return21`, `atrPct`.
- `packages/core/src/radar/etf.ts` — `relativeStrength`, `decideEtf`.
- `packages/core/src/radar/plan.ts` — `planContribution`.
- `packages/core/src/radar/measure.ts` — `summarizeRadar` (COMPRAR vs OBSERVAR).
- `packages/core/src/cartera/risk.ts` — extender con `bySector`, `byTheme`.
- `packages/adapters/src/alpaca/assets.ts` — `AlpacaAssets` (`list`, `snapshots`).
- `packages/adapters/src/finnhub/index.ts` — extender con `FinnhubFundamentals` (`metric`, `peers`, `recommendation`, `earningsSurprises`, `insiders`, `nextEarnings`) y `RateLimiter`.
- `packages/db/src/schema.ts`, `repo.ts` — tablas nuevas y métodos `RadarStore`.
- `packages/pipeline/src/store.ts` — `RadarStore` + `MemoryStore`; `packages/pipeline/src/radar.ts` — `scanUniverse`, `rankRadar`, `refreshRadar`, `measureRadar`, `buildContributionPlan`, `applyTaxonomy`.
- `packages/reasoner/src/card.ts` — `CARD_TOOL`, `CARD_SYSTEM`, `GeminiCardWriter`, `AnthropicCardWriter`, `parseCard`.
- `apps/api/src/config.ts`, `container.ts`, `routes/radar.ts`, `routes/taxonomy.ts`, `index.ts`, `radar-cli.ts`.
- `apps/web/src/api.ts`, `Radar.tsx`, `Tags.tsx`, `Cartera.tsx`, `App.tsx`, `styles.css`.

---

### Task 1: Config y taxonomía (core)

**Files:**
- Create: `config/taxonomia.json`, `config/etfs.json`, `config/radar-policy.json`, `packages/core/src/radar/types.ts`, `packages/core/src/radar/taxonomy.ts`, `packages/core/src/radar/index.ts`, `packages/core/src/radar/taxonomy.test.ts`
- Modify: `packages/core/src/index.ts` (`export * from "./radar/index.js";`), `packages/core/src/cartera/types.ts` (`SymbolProfile` suma campos opcionales)

**Interfaces:**
```ts
// types.ts
export type AssetClass = "accion_us" | "adr" | "accion_ar" | "cedear" | "etf" | "bono" | "commodity" | "cripto" | "efectivo";
export type EtfRole = "nucleo" | "satelite" | "cobertura";
export type EtfExposure = "rv_us" | "rv_internacional" | "emergentes" | "sector" | "commodity" | "bonos" | "cripto" | "argentina";
export interface EtfConfig { symbol: string; name: string; role: EtfRole; exposure: EtfExposure; ter: number; themes: string[]; coreWeight?: number }
export interface TaxonomyConfig { sectors: string[]; themes: string[]; industryToSector: Record<string, string>; industryToThemes: Record<string, string[]>; symbolToThemes: Record<string, string[]>; symbolToAssetClass: Record<string, AssetClass> }
export interface RadarPolicy { weights: { valuation: number; quality: number; growth: number; balance: number }; quality: { minMcapUsd: number; minDollarVolumeUsd: number; minPrice: number }; prefilter: { minPrice: number; minIexDollarVolume: number }; technical: { maxReturn21dPct: number; earningsWithinDays: number }; sizing: { riskPerTradePct: number; maxPositionPct: number; fallbackPortfolioUsd: number }; candidates: { top: number; preselect: number; chronicWeeks: number }; contribution: { monthlyUsd: number; coreTargetPct: number; maxPositionPct: number; maxNewPositionsPerMonth: number } }
export interface Tags { assetClass: AssetClass; sector: string; industry: string | null; themes: string[]; themesSource: "regla" | "modelo" | "manual" }
// taxonomy.ts
export const TaxonomyConfigSchema: z.ZodType<TaxonomyConfig>; export const EtfConfigSchema; export const RadarPolicySchema;
export function assetClassFor(i: { symbol: string; country: string | null; isEtf: boolean; positionMarket?: "us" | "adr" | "ar" }, t: TaxonomyConfig): AssetClass
export function sectorFor(industry: string | null, t: TaxonomyConfig): string   // "Otros" si no mapea
export function themesFor(i: { symbol: string; industry: string | null; isEtf?: EtfConfig }, t: TaxonomyConfig): string[]   // reglas, sin duplicados, solo de t.themes
export function mergeThemes(current: { themes: string[]; source: Tags["themesSource"] } | null, proposed: string[], proposedSource: "regla" | "modelo", t: TaxonomyConfig): { themes: string[]; source: Tags["themesSource"] }  // manual nunca se pisa; temas fuera de la lista se descartan
```

Contenido de `config/taxonomia.json` (inicial; se amplía cuando el log muestre industrias sin mapear):

```json
{
  "sectors": ["Tecnología", "Comunicación", "Consumo discrecional", "Consumo básico", "Salud", "Financiero", "Industriales", "Energía", "Materiales", "Servicios públicos", "Inmobiliario", "Otros"],
  "themes": ["IA", "semiconductores", "nube_software", "ciberseguridad", "defensa", "petroleo_gas", "renovables", "nuclear_uranio", "litio_baterias", "oro_mineria", "bitcoin", "fintech", "bancos", "biotech", "consumo", "infraestructura", "argentina", "china_taiwan", "dividendos", "small_caps"],
  "industryToSector": {
    "Technology": "Tecnología", "Semiconductors": "Tecnología", "Software": "Tecnología", "Electronic Equipment": "Tecnología", "Computer Hardware": "Tecnología",
    "Media": "Comunicación", "Telecommunication": "Comunicación", "Communications": "Comunicación", "Entertainment": "Comunicación",
    "Retail": "Consumo discrecional", "Automobiles": "Consumo discrecional", "Hotels, Restaurants & Leisure": "Consumo discrecional", "Textiles, Apparel & Luxury Goods": "Consumo discrecional", "Leisure Products": "Consumo discrecional",
    "Food Products": "Consumo básico", "Beverages": "Consumo básico", "Consumer products": "Consumo básico", "Tobacco": "Consumo básico", "Food & Staples Retailing": "Consumo básico",
    "Pharmaceuticals": "Salud", "Biotechnology": "Salud", "Health Care": "Salud", "Medical Devices": "Salud", "Life Sciences Tools & Services": "Salud",
    "Banking": "Financiero", "Financial Services": "Financiero", "Insurance": "Financiero", "Capital Markets": "Financiero", "Consumer Finance": "Financiero",
    "Aerospace & Defense": "Industriales", "Machinery": "Industriales", "Industrial Conglomerates": "Industriales", "Airlines": "Industriales", "Logistics & Transportation": "Industriales", "Building": "Industriales", "Construction": "Industriales", "Electrical Equipment": "Industriales", "Commercial Services & Supplies": "Industriales", "Trading Companies & Distributors": "Industriales", "Road & Rail": "Industriales", "Marine": "Industriales",
    "Energy": "Energía", "Oil & Gas": "Energía",
    "Metals & Mining": "Materiales", "Chemicals": "Materiales", "Packaging": "Materiales", "Construction Materials": "Materiales", "Paper & Forest": "Materiales",
    "Utilities": "Servicios públicos",
    "Real Estate": "Inmobiliario"
  },
  "industryToThemes": {
    "Semiconductors": ["semiconductores"], "Software": ["nube_software"], "Aerospace & Defense": ["defensa"], "Energy": ["petroleo_gas"], "Oil & Gas": ["petroleo_gas"],
    "Banking": ["bancos"], "Biotechnology": ["biotech"], "Pharmaceuticals": ["biotech"], "Metals & Mining": ["oro_mineria"], "Retail": ["consumo"], "Consumer products": ["consumo"],
    "Utilities": ["infraestructura"], "Construction": ["infraestructura"], "Building": ["infraestructura"]
  },
  "symbolToThemes": {
    "NVDA": ["IA", "semiconductores"], "AMD": ["IA", "semiconductores"], "TSM": ["semiconductores", "china_taiwan", "IA"], "MSFT": ["IA", "nube_software"], "GOOGL": ["IA", "nube_software"], "AMZN": ["IA", "nube_software", "consumo"], "META": ["IA"], "PLTR": ["IA", "defensa"],
    "MARA": ["bitcoin"], "HUT": ["bitcoin"], "RIOT": ["bitcoin"], "CLSK": ["bitcoin"], "IBIT": ["bitcoin"], "COIN": ["bitcoin", "fintech"],
    "YPF": ["argentina", "petroleo_gas"], "VIST": ["argentina", "petroleo_gas"], "GGAL": ["argentina", "bancos"], "PAM": ["argentina", "infraestructura"], "BMA": ["argentina", "bancos"], "SUPV": ["argentina", "bancos"], "TGS": ["argentina", "petroleo_gas"], "CEPU": ["argentina", "infraestructura"], "LOMA": ["argentina", "infraestructura"], "MELI": ["argentina", "consumo", "fintech"], "ARGT": ["argentina"],
    "NEM": ["oro_mineria"], "GLD": ["oro_mineria"], "GOLD": ["oro_mineria"], "CCJ": ["nuclear_uranio"], "URA": ["nuclear_uranio"], "ALB": ["litio_baterias"], "LIT": ["litio_baterias"], "SQM": ["litio_baterias"],
    "LMT": ["defensa"], "RTX": ["defensa"], "NOC": ["defensa"], "GD": ["defensa"], "ITA": ["defensa"], "CRWD": ["ciberseguridad", "nube_software"], "PANW": ["ciberseguridad"], "ZS": ["ciberseguridad"], "CIBR": ["ciberseguridad"],
    "XOM": ["petroleo_gas"], "CVX": ["petroleo_gas"], "XLE": ["petroleo_gas"], "ENPH": ["renovables"], "FSLR": ["renovables"], "ICLN": ["renovables"], "SCHD": ["dividendos"], "VYM": ["dividendos"], "IWM": ["small_caps"]
  },
  "symbolToAssetClass": { "BTC": "cripto", "ETH": "cripto", "USDC": "efectivo", "USDT": "efectivo" }
}
```

`config/etfs.json` (inicial, editable):

```json
[
  { "symbol": "VTI", "name": "Vanguard Total US Market", "role": "nucleo", "exposure": "rv_us", "ter": 0.03, "themes": [], "coreWeight": 0.6 },
  { "symbol": "VEA", "name": "Vanguard Developed Markets", "role": "nucleo", "exposure": "rv_internacional", "ter": 0.05, "themes": [], "coreWeight": 0.25 },
  { "symbol": "VWO", "name": "Vanguard Emerging Markets", "role": "nucleo", "exposure": "emergentes", "ter": 0.08, "themes": [], "coreWeight": 0.15 },
  { "symbol": "SPY", "name": "SPDR S&P 500", "role": "satelite", "exposure": "rv_us", "ter": 0.09, "themes": [] },
  { "symbol": "QQQ", "name": "Invesco Nasdaq 100", "role": "satelite", "exposure": "rv_us", "ter": 0.20, "themes": ["IA", "nube_software"] },
  { "symbol": "IWM", "name": "iShares Russell 2000", "role": "satelite", "exposure": "rv_us", "ter": 0.19, "themes": ["small_caps"] },
  { "symbol": "SCHD", "name": "Schwab US Dividend", "role": "satelite", "exposure": "rv_us", "ter": 0.06, "themes": ["dividendos"] },
  { "symbol": "XLK", "name": "Technology Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["IA", "semiconductores"] },
  { "symbol": "SMH", "name": "VanEck Semiconductor", "role": "satelite", "exposure": "sector", "ter": 0.35, "themes": ["semiconductores", "IA"] },
  { "symbol": "XLE", "name": "Energy Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["petroleo_gas"] },
  { "symbol": "XLF", "name": "Financial Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["bancos", "fintech"] },
  { "symbol": "XLV", "name": "Health Care Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["biotech"] },
  { "symbol": "XLI", "name": "Industrial Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["infraestructura", "defensa"] },
  { "symbol": "XLU", "name": "Utilities Select", "role": "satelite", "exposure": "sector", "ter": 0.09, "themes": ["infraestructura", "dividendos"] },
  { "symbol": "ITA", "name": "iShares Aerospace & Defense", "role": "satelite", "exposure": "sector", "ter": 0.40, "themes": ["defensa"] },
  { "symbol": "CIBR", "name": "First Trust Cybersecurity", "role": "satelite", "exposure": "sector", "ter": 0.59, "themes": ["ciberseguridad"] },
  { "symbol": "URA", "name": "Global X Uranium", "role": "satelite", "exposure": "sector", "ter": 0.69, "themes": ["nuclear_uranio"] },
  { "symbol": "LIT", "name": "Global X Lithium & Battery", "role": "satelite", "exposure": "sector", "ter": 0.75, "themes": ["litio_baterias"] },
  { "symbol": "ICLN", "name": "iShares Clean Energy", "role": "satelite", "exposure": "sector", "ter": 0.41, "themes": ["renovables"] },
  { "symbol": "ARGT", "name": "Global X MSCI Argentina", "role": "satelite", "exposure": "argentina", "ter": 0.59, "themes": ["argentina"] },
  { "symbol": "EWZ", "name": "iShares MSCI Brazil", "role": "satelite", "exposure": "emergentes", "ter": 0.59, "themes": [] },
  { "symbol": "ILF", "name": "iShares Latin America 40", "role": "satelite", "exposure": "emergentes", "ter": 0.47, "themes": ["argentina"] },
  { "symbol": "EWT", "name": "iShares MSCI Taiwan", "role": "satelite", "exposure": "emergentes", "ter": 0.59, "themes": ["china_taiwan", "semiconductores"] },
  { "symbol": "GLD", "name": "SPDR Gold", "role": "cobertura", "exposure": "commodity", "ter": 0.40, "themes": ["oro_mineria"] },
  { "symbol": "GDX", "name": "VanEck Gold Miners", "role": "satelite", "exposure": "sector", "ter": 0.51, "themes": ["oro_mineria"] },
  { "symbol": "USO", "name": "United States Oil", "role": "cobertura", "exposure": "commodity", "ter": 0.60, "themes": ["petroleo_gas"] },
  { "symbol": "TLT", "name": "iShares 20+ Year Treasury", "role": "cobertura", "exposure": "bonos", "ter": 0.15, "themes": [] },
  { "symbol": "BND", "name": "Vanguard Total Bond", "role": "cobertura", "exposure": "bonos", "ter": 0.03, "themes": [] },
  { "symbol": "IBIT", "name": "iShares Bitcoin Trust", "role": "satelite", "exposure": "cripto", "ter": 0.25, "themes": ["bitcoin"] }
]
```

`config/radar-policy.json`:

```json
{
  "weights": { "valuation": 0.35, "quality": 0.30, "growth": 0.25, "balance": 0.10 },
  "quality": { "minMcapUsd": 500000000, "minDollarVolumeUsd": 5000000, "minPrice": 5 },
  "prefilter": { "minPrice": 5, "minIexDollarVolume": 500000 },
  "technical": { "maxReturn21dPct": 15, "earningsWithinDays": 10 },
  "sizing": { "riskPerTradePct": 1, "maxPositionPct": 10, "fallbackPortfolioUsd": 150000 },
  "candidates": { "top": 40, "preselect": 150, "chronicWeeks": 4 },
  "contribution": { "monthlyUsd": 6500, "coreTargetPct": 40, "maxPositionPct": 15, "maxNewPositionsPerMonth": 2 }
}
```

- [ ] **Step 1: Write the failing test** `packages/core/src/radar/taxonomy.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { assetClassFor, mergeThemes, sectorFor, themesFor, type TaxonomyConfig } from "./index.js";

const t: TaxonomyConfig = {
  sectors: ["Tecnología", "Energía", "Otros"],
  themes: ["IA", "semiconductores", "petroleo_gas", "argentina", "bitcoin"],
  industryToSector: { Semiconductors: "Tecnología", Energy: "Energía" },
  industryToThemes: { Semiconductors: ["semiconductores"], Energy: ["petroleo_gas"] },
  symbolToThemes: { TSM: ["IA", "china_taiwan"], YPF: ["argentina"] },
  symbolToAssetClass: { BTC: "cripto" },
};

describe("taxonomía", () => {
  it("clase: etf > override > adr por país > accion_us", () => {
    expect(assetClassFor({ symbol: "VTI", country: "US", isEtf: true }, t)).toBe("etf");
    expect(assetClassFor({ symbol: "BTC", country: null, isEtf: false }, t)).toBe("cripto");
    expect(assetClassFor({ symbol: "TSM", country: "TW", isEtf: false }, t)).toBe("adr");
    expect(assetClassFor({ symbol: "VIST", country: "MX", isEtf: false, positionMarket: "adr" }, t)).toBe("adr");
    expect(assetClassFor({ symbol: "NEM", country: "US", isEtf: false }, t)).toBe("accion_us");
  });
  it("sector por tabla; Otros si no mapea", () => {
    expect(sectorFor("Semiconductors", t)).toBe("Tecnología");
    expect(sectorFor("Rarísima", t)).toBe("Otros");
    expect(sectorFor(null, t)).toBe("Otros");
  });
  it("temas por industria y símbolo, sin duplicados y solo de la lista", () => {
    expect(themesFor({ symbol: "TSM", industry: "Semiconductors" }, t)).toEqual(["semiconductores", "IA"]); // china_taiwan no está en t.themes
    expect(themesFor({ symbol: "YPF", industry: "Energy" }, t)).toEqual(["petroleo_gas", "argentina"]);
    expect(themesFor({ symbol: "ZZZ", industry: null }, t)).toEqual([]);
  });
  it("mergeThemes: manual nunca se pisa; modelo pisa regla; fuera de lista se descarta", () => {
    expect(mergeThemes(null, ["IA", "inventado"], "modelo", t)).toEqual({ themes: ["IA"], source: "modelo" });
    expect(mergeThemes({ themes: ["bitcoin"], source: "manual" }, ["IA"], "modelo", t)).toEqual({ themes: ["bitcoin"], source: "manual" });
    expect(mergeThemes({ themes: ["bitcoin"], source: "regla" }, ["IA"], "modelo", t)).toEqual({ themes: ["bitcoin", "IA"], source: "modelo" });
  });
});
```

- [ ] **Step 2: Run** `pnpm exec vitest run packages/core/src/radar/taxonomy.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 3: Implement** `types.ts` (tipos de arriba + Zod schemas en `taxonomy.ts`), `taxonomy.ts`:

```ts
import { z } from "zod";
import type { AssetClass, EtfConfig, RadarPolicy, Tags, TaxonomyConfig } from "./types.js";

export const AssetClassSchema = z.enum(["accion_us", "adr", "accion_ar", "cedear", "etf", "bono", "commodity", "cripto", "efectivo"]);
export const TaxonomyConfigSchema = z.object({ sectors: z.array(z.string()), themes: z.array(z.string()), industryToSector: z.record(z.string()), industryToThemes: z.record(z.array(z.string())), symbolToThemes: z.record(z.array(z.string())), symbolToAssetClass: z.record(AssetClassSchema) });
export const EtfConfigSchema = z.object({ symbol: z.string(), name: z.string(), role: z.enum(["nucleo", "satelite", "cobertura"]), exposure: z.enum(["rv_us", "rv_internacional", "emergentes", "sector", "commodity", "bonos", "cripto", "argentina"]), ter: z.number(), themes: z.array(z.string()), coreWeight: z.number().optional() });
export const RadarPolicySchema = z.object({ weights: z.object({ valuation: z.number(), quality: z.number(), growth: z.number(), balance: z.number() }), quality: z.object({ minMcapUsd: z.number(), minDollarVolumeUsd: z.number(), minPrice: z.number() }), prefilter: z.object({ minPrice: z.number(), minIexDollarVolume: z.number() }), technical: z.object({ maxReturn21dPct: z.number(), earningsWithinDays: z.number() }), sizing: z.object({ riskPerTradePct: z.number(), maxPositionPct: z.number(), fallbackPortfolioUsd: z.number() }), candidates: z.object({ top: z.number(), preselect: z.number(), chronicWeeks: z.number() }), contribution: z.object({ monthlyUsd: z.number(), coreTargetPct: z.number(), maxPositionPct: z.number(), maxNewPositionsPerMonth: z.number() }) });

export function assetClassFor(i: { symbol: string; country: string | null; isEtf: boolean; positionMarket?: "us" | "adr" | "ar" }, t: TaxonomyConfig): AssetClass {
  if (i.isEtf) return "etf";
  const o = t.symbolToAssetClass[i.symbol.toUpperCase()];
  if (o) return o;
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
  const fromIndustry = i.industry ? t.industryToThemes[i.industry] ?? [] : [];
  const fromSymbol = t.symbolToThemes[i.symbol.toUpperCase()] ?? [];
  return onlyKnown([...fromIndustry, ...fromSymbol, ...(i.etf?.themes ?? [])], t);
}
export function mergeThemes(current: { themes: string[]; source: Tags["themesSource"] } | null, proposed: string[], proposedSource: "regla" | "modelo", t: TaxonomyConfig): { themes: string[]; source: Tags["themesSource"] } {
  if (current?.source === "manual") return current;
  const merged = onlyKnown([...(current?.themes ?? []), ...proposed], t);
  return { themes: merged, source: current?.source === "modelo" && proposedSource === "regla" ? "modelo" : proposedSource };
}
```

`SymbolProfile` (cartera/types.ts) suma opcionales: `currency?: string | null; shareOutstanding?: number | null` (millones).

- [ ] **Step 4: Run** tests core → PASS; typecheck core.
- [ ] **Step 5: Commit** `git add config packages/core && git commit -m "feat(radar): configuración y taxonomía (clase, sector, temas)"`.

---

### Task 2: Filtros de universo (core)

**Files:** Create `packages/core/src/radar/universe.ts`, `universe.test.ts`; modify `radar/index.ts`.

**Interfaces:**
```ts
export interface AssetInfo { symbol: string; name: string; exchange: string; tradable: boolean }
export interface SnapshotLite { symbol: string; price: number | null; iexVolume: number | null }
export interface FinnhubMetrics { [k: string]: number | null | undefined }   // subconjunto plano de "metric"
export interface FundamentalsInput { profile: { shareOutstanding: number | null; currency: string | null; country: string | null; industry: string | null; name: string | null }; metrics: FinnhubMetrics; priceUsd: number }
export function isEligibleAsset(a: AssetInfo): { ok: boolean; reason?: string }
export function passesPreFilter(s: SnapshotLite, p: RadarPolicy["prefilter"]): { ok: boolean; reason?: string }
export function mcapUsd(shareOutstandingMillions: number | null, priceUsd: number): number | null
export function dollarVolumeUsd(avgVol3mMillions: number | null | undefined, priceUsd: number): number | null
export function qualityBar(f: FundamentalsInput, q: RadarPolicy["quality"]): { ok: boolean; reason?: string; mcapUsd: number | null; dollarVolumeUsd: number | null }
```

- [ ] **Step 1: Test** `universe.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isEligibleAsset, passesPreFilter, qualityBar } from "./index.js";
const q = { minMcapUsd: 500e6, minDollarVolumeUsd: 5e6, minPrice: 5 };
const pre = { minPrice: 5, minIexDollarVolume: 500_000 };
describe("universo", () => {
  it("excluye no tradables, símbolos raros, warrants/units/rights/preferred y exchanges fuera de lista", () => {
    expect(isEligibleAsset({ symbol: "AAPL", name: "Apple", exchange: "NASDAQ", tradable: true }).ok).toBe(true);
    expect(isEligibleAsset({ symbol: "BRK.A", name: "Berkshire", exchange: "NYSE", tradable: true }).reason).toMatch(/símbolo/);
    expect(isEligibleAsset({ symbol: "SCPQU", name: "Social Commerce Unit", exchange: "NASDAQ", tradable: true }).reason).toMatch(/unit/i);
    expect(isEligibleAsset({ symbol: "XW", name: "X Warrant", exchange: "NYSE", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "ABC", name: "ABC Preferred", exchange: "NYSE", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "OTC1", name: "Otc", exchange: "OTC", tradable: true }).ok).toBe(false);
    expect(isEligibleAsset({ symbol: "Z", name: "Z", exchange: "NYSE", tradable: false }).ok).toBe(false);
  });
  it("pre-filtro: precio y volumen IEX en USD; sin dato no pasa", () => {
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 100_000 }, pre).ok).toBe(true);
    expect(passesPreFilter({ symbol: "A", price: 4, iexVolume: 1e6 }, pre).reason).toMatch(/precio/);
    expect(passesPreFilter({ symbol: "A", price: 10, iexVolume: 10_000 }, pre).reason).toMatch(/volumen/);
    expect(passesPreFilter({ symbol: "A", price: null, iexVolume: 1e6 }, pre).ok).toBe(false);
  });
  it("quality bar con capitalización y volumen en USD desde acciones en circulación y precio Alpaca", () => {
    const f = { profile: { shareOutstanding: 1000, currency: "TWD", country: "TW", industry: "Semis", name: "TSM" }, metrics: { "3MonthAverageTradingVolume": 36.5, marketCapitalization: 61_978_364 }, priceUsd: 428 };
    const r = qualityBar(f, q);
    expect(r.ok).toBe(true);
    expect(r.mcapUsd).toBe(428_000e6);
    expect(r.dollarVolumeUsd).toBeCloseTo(36.5e6 * 428, 0);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: null } }, q).reason).toMatch(/acciones en circulación/);
    expect(qualityBar({ ...f, metrics: {} }, q).reason).toMatch(/volumen/);
    expect(qualityBar({ ...f, profile: { ...f.profile, shareOutstanding: 0.5 } }, q).reason).toMatch(/capitalización/);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`EXCHANGES = NYSE, NASDAQ, ARCA, AMEX, BATS`; nombre con `/\b(warrant|unit|units|right|rights|preferred)\b/i`; símbolo `/^[A-Z]{1,5}$/`). **Step 4: PASS + typecheck.** **Step 5: Commit** `feat(radar): filtros de universo`.

---
### Task 3: Ranking contra pares (core)

**Files:** Create `packages/core/src/radar/ranking.ts`, `ranking.test.ts`; modify `radar/index.ts`, `radar/types.ts`.

**Interfaces:**
```ts
export interface Fundamentals { symbol: string; asOf: string; metrics: FinnhubMetrics; peers: string[]; industry: string | null; mcapUsd: number; dollarVolumeUsd: number; priceUsd: number; nextEarnings: string | null; insiderBuys90d: number | null; insiderSells90d: number | null; analyst: { strongBuy: number; buy: number; hold: number; sell: number; strongSell: number; period: string } | null; earningsSurprises: Array<{ period: string; surprisePercent: number | null }> | null }
export type Axis = "valuation" | "quality" | "growth" | "balance";
export const AXIS_METRICS: Record<Axis, Array<{ key: string; invert: boolean; positiveOnly?: boolean }>>  // valuación: peTTM (invert, positiveOnly), evEbitdaTTM (invert, positiveOnly), psTTM (invert, positiveOnly); calidad: roeTTM, operatingMarginTTM, netProfitMarginTTM; crecimiento: revenueGrowthTTMYoy, revenueGrowth5Y, epsGrowthTTMYoy; balance: totalDebt/totalEquityAnnual (invert), currentRatioAnnual
export function robustZ(values: Array<number | null>): Array<number | null>   // (x − mediana)/(1.4826·MAD), winsor ±3; MAD 0 → 0 para todos; null se mantiene
export function peerGroup(symbol: string, all: Map<string, Fundamentals>, minSize?: number): { members: string[]; basis: "pares" | "industria" } | null   // pares ∩ all (máx 10, sin el propio), si < 4 → industria (todos los de la misma industria, sin el propio), si < 4 → null
export interface RankedStock { symbol: string; score: number; axes: Record<Axis, number | null>; group: string[]; basis: "pares" | "industria"; rankInGroup: number; groupSize: number; medians: Record<string, number | null> }
export function rankStocks(all: Map<string, Fundamentals>, weights: RadarPolicy["weights"]): { ranked: RankedStock[]; skipped: Array<{ symbol: string; reason: string }> }
```
Algoritmo `rankStocks`: para cada símbolo: grupo (null → `sin_pares`); para cada eje: para cada métrica, z del símbolo dentro de `[símbolo, ...grupo]` (valores `positiveOnly` ≤ 0 → null; invert → −z); eje = promedio de los z disponibles (ninguno → null). Score = Σ w·eje / Σ w de ejes disponibles; ≤ 1 eje → `ejes_insuficientes`. `rankInGroup` = posición del símbolo si se rankean todos los del grupo con el mismo método (1 = mejor); `medians` = mediana del grupo por métrica (para la ficha). Orden final por score desc.

- [ ] **Step 1: Test** `ranking.test.ts` (sintético): 
  - `robustZ([1,2,3,4,100])` → el 100 winsorizado a 3; `robustZ([5,5,5])` → ceros; nulls se conservan.
  - Grupo de 5 pares idénticos + uno "mejor en todo" (P/E mitad, ROE doble, crecimiento doble, deuda mitad): `score` positivo y `rankInGroup` 1; uno "peor en todo": score negativo.
  - Pares insuficientes (2) pero industria con 6 → `basis: "industria"`; sin nada → skipped `sin_pares`.
  - Símbolo sin métricas de valuación (P/E negativo, sin EV/EBITDA ni P/S) rankea con 3 ejes reponderados; con solo un eje → skipped `ejes_insuficientes`.
  - Métricas faltantes en un par no rompen: z se calcula con los disponibles.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (mediana y MAD propios; sin dependencias). **Step 4: PASS.** **Step 5: Commit** `feat(radar): ranking fundamental contra pares con z-scores robustos`.

---

### Task 4: Reglas de candidato y motor ETF (core)

**Files:** Create `packages/core/src/radar/candidate.ts`, `candidate.test.ts`, `packages/core/src/radar/etf.ts`, `etf.test.ts`; modify `radar/index.ts`, `radar/types.ts`.

**Interfaces:**
```ts
export function sma(candles: Candle[], n: number): number | null
export function returnPct(candles: Candle[], n: number): number | null      // cierre hoy vs cierre n velas atrás
export function atrPct(candles: Candle[], period?: number): number | null    // ATR(14)/cierre × 100
export interface TechnicalGate { status: "ok" | "observar" | "excluido"; reasons: string[]; close: number; sma200: number | null; return21dPct: number | null; atrPct: number | null }
export function technicalGate(candles: Candle[], p: RadarPolicy["technical"], nextEarnings: string | null, today: string): TechnicalGate
export function positionSize(i: { entryHigh: number; stop: number | null; portfolioUsd: number | null }, s: RadarPolicy["sizing"]): { qty: number; sizeUsd: number; riskUsd: number } | null   // null sin stop o stop ≥ entrada
export function riskScore(i: { beta: number | null; atrPct: number | null; debtToEquity: number | null; dollarVolumeUsd: number; mcapUsd: number }): number  // 1..10 según spec
export function buildFlags(f: Fundamentals, gate: TechnicalGate, nthAppearance: number, chronicWeeks: number): string[]
export interface CandidateDecision { verdict: "COMPRAR" | "OBSERVAR"; flags: string[]; entryLow: number; entryHigh: number; stop: number | null; target: number | null; size: { qty: number; sizeUsd: number } | null; riskScore: number; reasons: string[] }
export function decideCandidate(i: { f: Fundamentals; candles: Candle[]; nthAppearance: number; portfolioUsd: number | null; today: string }, p: RadarPolicy): CandidateDecision | { excluded: true; reasons: string[] }
// etf.ts
export function relativeStrength(etf: Candle[], spy: Candle[], n: number): number | null   // (1+r_etf)/(1+r_spy) − 1, en %
export interface EtfDecision { verdict: "NUCLEO" | "COMPRAR" | "OBSERVAR"; rs3m: number | null; rs6m: number | null; rs12m: number | null; distSma200Pct: number | null; atrPct: number | null; reasons: string[]; close: number; stop: number | null; target: number | null }
export function decideEtf(cfg: EtfConfig, candles: Candle[], spy: Candle[], p: RadarPolicy["technical"]): EtfDecision | { excluded: true; reasons: string[] }
```
Reglas `decideCandidate`: gate excluido → `{excluded}`; verdict COMPRAR; gate `observar` → OBSERVAR con sus razones; `nthAppearance ≥ chronicWeeks` → OBSERVAR + `residente_cronico`; entrada `[close, round2(close×1.02)]`; stop `computeTrailingStop`; objetivo `computeTarget(close, stop)`; tamaño con `entryHigh`; riesgo con `f.metrics.beta`, `gate.atrPct`, `f.metrics["totalDebt/totalEquityAnnual"]`.
Banderas: `insiders_compran` (insiderBuys90d ≥ 1), `insiders_venden` (insiderSells90d ≥ 3), `consenso_compra` ((strongBuy+buy)/total > 0.6), `consenso_venta` ((sell+strongSell)/total > 0.4), `sorpresa_positiva` (última > 5), `sorpresa_negativa` (última < −5), `dividendo` (dividendYieldIndicatedAnnual > 2), más las del gate y `residente_cronico`.

- [ ] **Step 1: Tests**: `technicalGate` (bajo SMA200 → excluido; > 15% en 21 → observar; resultados en 5 días → observar; < 200 velas → excluido; normal → ok con valores); `positionSize` (1% de 150k = 1.500 de riesgo; entrada 102, stop 92 → qty 150, sizeUsd 15.300 → tope 10% = 15.000 → qty 147; sin stop → null; portfolio null → usa fallback vía caller); `riskScore` (tabla: todo bajo → 1; todo alto → 10 con tope); `buildFlags` (cada bandera con un caso); `decideCandidate` (COMPRAR normal; residente crónico → OBSERVAR; excluido); `relativeStrength` (etf +10%, spy +5% → ≈ 4.76%); `decideEtf` (nucleo → NUCLEO siempre; satélite con rs6m > 0 y sobre SMA200 → COMPRAR; rs6m < 0 → OBSERVAR con razón; sin velas → excluido).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: PASS.** **Step 5: Commit** `feat(radar): reglas de candidato, tamaño, riesgo, banderas y motor ETF`.

---

### Task 5: Plan del aporte, medición y concentración por tema (core)

**Files:** Create `packages/core/src/radar/plan.ts`, `plan.test.ts`, `packages/core/src/radar/measure.ts`, `measure.test.ts`; modify `packages/core/src/cartera/risk.ts` (+ `bySector`, `byTheme`), `risk.test.ts`, `radar/index.ts`.

**Interfaces:**
```ts
export interface PlanInput { month: string; portfolioValueUsd: number; positions: Array<{ symbol: string; valueUsd: number; assetClass: AssetClass; role?: EtfRole }>; sumarCandidates: Array<{ symbol: string; weightPct: number }>; buyCandidates: Array<{ symbol: string; kind: "stock" | "etf"; score: number | null; sizeUsd: number | null; close: number }>; coreEtfs: EtfConfig[]; spyClose: number | null; closes: Record<string, number> }
export interface PlanLine { symbol: string; kind: "nucleo" | "sumar" | "comprar"; amountUsd: number; rationale: string; close: number | null; spyClose: number | null; alpha30dPct: number | null; alpha90dPct: number | null }
export interface ContributionPlan { month: string; totalUsd: number; lines: PlanLine[]; notes: string[] }
export function planContribution(i: PlanInput, c: RadarPolicy["contribution"]): ContributionPlan
// measure.ts
export interface RadarMeasured { verdict: string; kind: string; alpha7dPct: number | null; alpha30dPct: number | null; alpha90dPct: number | null }
export function summarizeRadar(rows: RadarMeasured[]): { byVerdict: Record<string, Record<"h7" | "h30" | "h90", { n: number; avgAlpha: number | null; hitRate: number | null }>>; comprarVsObservar: Record<"h7" | "h30" | "h90", { diff: number | null; nComprar: number; nObservar: number }>; pending: number }
```
`planContribution`: `valorNucleo` = suma de posiciones con `role === "nucleo"`; `objetivo = coreTargetPct/100 × (valor + aporte)`; `gap = max(0, objetivo − valorNucleo)`; `aNucleo = min(gap, aporte)`, repartido por `coreWeight` priorizando el ETF más lejos de su peso objetivo (línea por ETF, ≥ 100 USD, resto al primero). Restante: recorrer `sumarCandidates` (menor peso primero) y luego `buyCandidates` (score desc, ETFs satélite después de acciones): monto = `min(sizeUsd ?? restante, tope = maxPositionPct/100 × (valor + aporte) − valorActual(symbol), restante)`; nuevas (símbolo no en posiciones) ≤ `maxNewPositionsPerMonth`; montos < 100 se saltean. Sobrante → línea `nucleo` extra (o `notes` si no hay núcleo definido). `close`/`spyClose` desde `closes`/`spyClose`.

- [ ] **Step 1: Tests** plan: (a) núcleo vacío, objetivo 40% de (100k+6.5k) = 42.6k → todo el aporte al núcleo, repartido 60/25/15; (b) núcleo lleno → SUMAR primero (2.000 de tamaño), luego COMPRAR por score, máximo 2 nuevas, tope por posición, sobrante a núcleo; (c) sin candidatos → todo a núcleo con nota. Medición: `summarizeRadar` con 6 filas → diff COMPRAR−OBSERVAR a 30d correcto, n por grupo, pendientes. Riesgo: `buildRiskReport` con `tags` → `byTheme` suma el peso completo a cada tema, `bySector` por sector; aviso > 40% por tema.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (extender `RiskInput` con `tags?: Record<string, { sector: string; themes: string[] }>` y `RiskReport.concentration` con `bySector`, `byTheme`; sin tags → objetos vacíos). **Step 4: PASS** (los tests de etapa 1 siguen verdes). **Step 5: Commit** `feat(radar): plan del aporte, medición COMPRAR vs OBSERVAR y concentración por tema`.

---

### Task 6: Adaptadores Alpaca assets/snapshots y Finnhub fundamentals (adapters)

**Files:** Create `packages/adapters/src/alpaca/assets.ts`, `packages/adapters/src/ratelimit.ts`, `packages/adapters/test/radar-adapters.test.ts`; modify `packages/adapters/src/finnhub/index.ts`, `packages/adapters/src/alpaca/index.ts`, `packages/adapters/src/index.ts`.

**Interfaces:**
```ts
// ratelimit.ts
export class RateLimiter { constructor(perMinute: number, now?: () => number, sleep?: (ms: number) => Promise<void>); async acquire(): Promise<void> }   // ventana deslizante de 60 s
// alpaca/assets.ts
export class AlpacaAssets { constructor(http: HttpClient, cfg: AlpacaConfig); list(): Promise<AssetInfo[]>; snapshots(symbols: string[]): Promise<SnapshotLite[]> }   // GET paper-api /v2/assets?status=active&asset_class=us_equity ; snapshots en lotes de 100 → price = latestTrade.p ?? dailyBar.c, iexVolume = dailyBar.v ?? prevDailyBar.v
// finnhub
export class FinnhubFundamentals { constructor(http: HttpClient, token: string, limiter: RateLimiter)
  profile(symbol): Promise<SymbolProfile | null>           // ya existe en FinnhubProfiles; incluir currency y shareOutstanding
  metrics(symbol): Promise<FinnhubMetrics | null>          // stock/metric?metric=all → .metric ; {} → null
  peers(symbol): Promise<string[]>                         // stock/peers
  recommendation(symbol): Promise<Fundamentals["analyst"]> // último elemento de stock/recommendation
  earningsSurprises(symbol): Promise<Fundamentals["earningsSurprises"]>  // stock/earnings (últimos 4)
  insiders(symbol, days: number, today: string): Promise<{ buys: number; sells: number }>   // insider-transactions, códigos P/S dentro de la ventana
  nextEarnings(symbol, today: string): Promise<string | null>   // calendar/earnings?from=today&to=today+120d&symbol= → primera fecha ≥ today
}
```
- [ ] **Step 1: Tests con `fixtureHttpClient`** para cada método (fixtures mínimos con la forma real vista el 2026-09-07), lotes de 100 en snapshots (250 símbolos → 3 llamadas), y `RateLimiter` con reloj falso (56.ª llamada dentro del minuto espera).
- [ ] **Step 2–5:** RED → implementar → GREEN → commit `feat(adapters): universo Alpaca y fundamentals Finnhub con limitador`.

---
### Task 7: Tablas, migración y Repo (db)

**Files:** Modify `packages/db/src/schema.ts`, `repo.ts`, `repo.integration.test.ts`; generate migration `0002_*`.

**Interfaces (métodos de `RadarStore`, mismos nombres en Repo y MemoryStore):**
```ts
tags(symbol): Promise<Tags | null>; saveTags(symbol, t: Tags): Promise<void>; allTags(): Promise<Record<string, Tags>>
saveFundamentals(f: Fundamentals): Promise<void>; fundamentals(symbol): Promise<Fundamentals | null>; freshFundamentals(maxAgeDays: number, today: string): Promise<Fundamentals[]>
scanUpsert(rows: Array<{ scanDate: string; symbol: string; stage: ScanStage; reason: string | null }>): Promise<void>; scanPending(scanDate: string): Promise<string[]>   // stage alpaca_ok sin fundamentals frescos → lo decide pipeline: devuelve símbolos con stage alpaca_ok
scanStatus(scanDate: string): Promise<Record<ScanStage, number>>; latestScanDate(): Promise<string | null>
upsertCandidates(rows: CandidateRow[]): Promise<void>; latestCandidates(): Promise<CandidateRow[]>; candidateHistory(symbol, weeks: number): Promise<CandidateRow[]>; candidatesToMeasure(before: string, horizon: 7 | 30 | 90): Promise<CandidateRow[]>; setCandidateMeasurement(date, symbol, m): Promise<void>; allCandidates(): Promise<CandidateRow[]>
savePlan(p: ContributionPlan): Promise<void>; latestPlan(): Promise<ContributionPlan | null>; plansToMeasure(before: string): Promise<ContributionPlan[]>; updatePlanLines(month: string, lines: PlanLine[]): Promise<void>
```
`CandidateRow` (core types): `{ candidateDate, symbol, kind: "stock"|"etf", verdict: "COMPRAR"|"OBSERVAR"|"NUCLEO", score, axes, peerGroup, rankInGroup, groupSize, close, entryLow, entryHigh, stop, target, sizeUsd, sizeQty, riskScore, flags, nthAppearance, summary, whyRanks, mainRisk, moat, degradedBy, promptVersion, spyClose, close7d, spy7d, alpha7dPct, close30d, spy30d, alpha30dPct, close90d, spy90d, alpha90dPct, measuredAt }`.

Schema: `symbol_meta` + columnas `asset_class`, `sector`, `exposure`, `role`, `themes text[]` (jsonb si `text[]` complica: usar `jsonb` default `[]`), `themes_source`, `currency`, `share_outstanding numeric`; `fundamentals` (symbol pk, as_of date, metrics jsonb, peers jsonb, industry, mcap_usd numeric, dollar_volume_usd numeric, price_usd numeric, next_earnings date, insider_buys_90d int, insider_sells_90d int, analyst jsonb, earnings_surprises jsonb, updated_at); `universe_scan` (scan_date, symbol pk compuesto, stage text, reason text, updated_at); `radar_candidates` (pk candidate_date+symbol, columnas de `CandidateRow`, numeric para montos, jsonb para axes/peer_group/flags); `contribution_plans` (plan_month pk, total_usd, lines jsonb, notes jsonb, created_at).

- [ ] Test de integración (nuevo `it` en `repo.integration.test.ts`, con limpieza en `afterAll` por símbolo `R${ticker}` y fechas 2099): tags upsert/lectura; fundamentals fresh (as_of 2099 → aparece; 2000 → no); scan upsert + pending + status; candidates upsert (no pisa medición), latest por fecha máxima, history, toMeasure/setMeasurement; plan save/latest/toMeasure/updateLines.
- [ ] RED → schema + `pnpm db:generate` + `pnpm db:migrate` → Repo → GREEN → commit `feat(db): tablas del radar (fundamentals, universo, candidatos, planes, etiquetas)`.

---

### Task 8: Pipeline: barrido reanudable, ranking, refresco, plan y medición

**Files:** Modify `packages/pipeline/src/store.ts` (`RadarStore`, `MemoryStore`), `index.ts`; create `packages/pipeline/src/radar.ts`, `test/radar.test.ts`.

**Interfaces:**
```ts
export interface RadarDeps { store: CarteraStore & RadarStore; assets: { list(): Promise<AssetInfo[]>; snapshots(symbols: string[]): Promise<SnapshotLite[]> }; fundamentals: FundamentalsSource /* métodos de FinnhubFundamentals */; history: PriceHistory; cardWriter: CardWriter | null; taxonomy: TaxonomyConfig; etfs: EtfConfig[]; policy: RadarPolicy; filings: (symbol: string) => Promise<string[]>; log?: (m: string, extra?: unknown) => void; onProgress?: (s: { done: number; total: number; stage: string }) => void; shouldStop?: () => boolean }
export async function scanUniverse(deps, opts: { scanDate: string; today: string }): Promise<{ scanDate: string; listed: number; prefiltered: number; fundamentalsOk: number; excluded: number; errors: number; stopped: boolean }>
export async function rankRadar(deps, opts: { today: string; portfolioUsd: number | null }): Promise<{ candidates: CandidateRow[]; skipped: Array<{ symbol: string; reason: string }>; errors: Array<{ symbol: string; error: string }> }>
export async function refreshRadar(deps, opts: { today: string; portfolioUsd: number | null }): Promise<{ refreshed: number; errors: Array<{ symbol: string; error: string }> }>
export async function measureRadar(deps: Pick<RadarDeps, "store" | "history">, opts: { today: string }): Promise<{ candidates: Record<"7" | "30" | "90", number>; planLines: number }>
export async function buildContributionPlan(deps, opts: { month: string; portfolioUsd: number | null }): Promise<ContributionPlan>
export async function applyTaxonomy(deps, symbols: string[]): Promise<number>   // regla → saveTags (respeta manual)
```
Algoritmos:
- `scanUniverse`: (1) si `scanPending(scanDate)` está vacío **y** `scanStatus(scanDate)` es todo 0 → fase A: `assets.list()` → `isEligibleAsset` → snapshots por lotes de 100 → `passesPreFilter` → `scanUpsert` con `alpaca_ok`/`excluded`. (2) Fase B: `scanPending` → para cada símbolo (respetando `shouldStop`): si `fundamentals(symbol)` tiene < 7 días → marcar `finnhub_ok` sin llamar; si no, `profile` + `metrics` → `qualityBar` → si ok: `peers` y guardar `Fundamentals` (sin insiders/consenso/sorpresas: eso es solo para candidatos) + tags por regla (`applyTaxonomy`) → `finnhub_ok`; si no → `excluded` con motivo; error → `error` con mensaje; `onProgress` cada 25.
- `rankRadar`: `freshFundamentals(7)` → `rankStocks` → top `preselect` → velas (Promise.allSettled, lotes de 10) → `technicalGate`… → top `top` → para esos: `nextEarnings`, `insiders(90)`, `recommendation`, `earningsSurprises` (actualizar `Fundamentals`) → `decideCandidate` → `nthAppearance` = 1 + semanas consecutivas previas (`candidateHistory(symbol, chronicWeeks+1)`: fechas de ranking semanal distintas, contiguas hacia atrás) → ficha (`cardWriter`, degrade) → `upsertCandidates`; ETFs: `decideEtf` para cada uno de `deps.etfs` → filas `kind: "etf"`.
- `refreshRadar`: `latestCandidates()` → velas nuevas → recalcular gate/stop/target/entrada/verdict (conserva score, axes, flags fundamentales, ficha, nthAppearance) → `upsertCandidates` con `today`.
- `measureRadar`: como etapa 1, horizontes 7/30/90 sobre candidatos; planes: líneas con `close`/`spyClose` y `alpha30dPct === null` y mes ≤ hoy − 30 días → alpha; ídem 90.
- `buildContributionPlan`: posiciones + `latestRisk` (valor y pesos) + `latestVerdicts` (SUMAR) + `latestCandidates` (COMPRAR y ETF satélite COMPRAR) + `etfs` núcleo + tags (assetClass, role) → `planContribution` → `savePlan`.

- [ ] Tests con `MemoryStore` y fakes: barrido corta a la mitad (`shouldStop` tras N) y retoma sin repetir llamadas a Finnhub (contador); fundamentals frescos no se vuelven a pedir; ranking sintético de 12 símbolos en 2 industrias produce candidatos con verdicts, tamaños y `nthAppearance` (segunda corrida semanal → 2; cuarta → OBSERVAR); refresh conserva `score` y `summary` y actualiza `close`; medición 7/30/90 y plan; `applyTaxonomy` respeta manual.
- [ ] RED → implementar → GREEN → commit `feat(pipeline): barrido reanudable, ranking, refresco, plan del aporte y medición del radar`.

---

### Task 9: Ficha de candidato (reasoner)

**Files:** Create `packages/reasoner/src/card.ts`, `test/card.test.ts`; modify `src/index.ts`.

**Interfaces:**
```ts
export const CARD_SYSTEM: string; export const CARD_TOOL: ToolSpec; export const CARD_VERSION: string
export interface CardInput { symbol: string; name: string | null; industry: string | null; sector: string; themes: string[]; themeOptions: string[]; verdict: "COMPRAR" | "OBSERVAR"; score: number; axes: Record<Axis, number | null>; rankInGroup: number; groupSize: number; basis: "pares" | "industria"; own: Record<string, number | null>; medians: Record<string, number | null>; peers: string[]; flags: string[]; insiders: { buys: number; sells: number } | null; analyst: Fundamentals["analyst"]; surprises: Fundamentals["earningsSurprises"]; filings: string[]; close: number; stop: number | null; target: number | null; riskScore: number }
export interface Card { summary: string; whyRanks: string; mainRisk: string; moat: "debil" | "moderado" | "fuerte" | "desconocido"; themes: string[]; degrade: boolean; degradeReason?: string }
export function buildCardMessage(i: CardInput): string
export function parseCard(args: unknown, themeOptions: string[]): Card    // Zod strict; degrade exige motivo; temas fuera de la lista se descartan
export class GeminiCardWriter implements CardWriter { readonly promptVersion; constructor(opts: GeminiCallerOptions); write(i: CardInput): Promise<Card> }
export class AnthropicCardWriter implements CardWriter
```
`CARD_SYSTEM` (texto exacto):
```
Sos analista de renta variable. Recibís UNA empresa candidata con su veredicto ya decidido por reglas (COMPRAR u OBSERVAR), su score fundamental contra pares con el detalle por eje (valuación, calidad, crecimiento, balance), sus métricas y las medianas del grupo, banderas, insiders, consenso, últimas sorpresas de resultados, títulos de filings recientes y la lista de temas permitidos.

Escribí en español, breve y concreto:
- summary: qué hace la empresa, máximo dos oraciones. Si no lo sabés con lo recibido, decilo.
- whyRanks: por qué rankea donde rankea, máximo dos oraciones, citando números recibidos y su lugar entre pares.
- mainRisk: el riesgo principal, una oración, basado en datos recibidos (deuda, márgenes, sorpresas negativas, insiders vendiendo, resultados cerca).
- moat: debil, moderado, fuerte o desconocido. Solo fuerte con evidencia en los números (márgenes y ROE muy por encima del grupo de forma sostenida).
- themes: subconjunto de la lista de temas permitidos que apliquen. No inventes temas.
No propongas otro verbo. Solo podés pedir degradar (degrade = true) COMPRAR a OBSERVAR si ves deterioro concreto en un filing o dato recibido (recorte de guidance, pérdida material, litigio, dilución, default): degradeReason debe citarlo. Respondé únicamente llamando a la herramienta candidate_card.
```
- [ ] Tests: mensaje incluye verdict, ejes, medianas, banderas, temas permitidos; `parseCard` (degrade sin motivo → error; tema inventado se descarta; extras → error); `GeminiCardWriter` manda system + tool `candidate_card` forzada; `CARD_VERSION` con hash.
- [ ] RED → implementar → GREEN → commit `feat(reasoner): ficha de candidato (solo degrada, temas de la lista)`.

---

### Task 10: API: config, container, rutas `/radar` y `/taxonomy`, barrido en segundo plano, crons

**Files:** Modify `apps/api/src/config.ts` (`radarScanCron` "0 20 * * 0", `radarRefreshCron` "50 7 * * 1-5", `radarPlanCron` "0 8 1 * *"; carga de `config/taxonomia.json`, `etfs.json`, `radar-policy.json` con Zod), `container.ts` (`radarDeps`, `buildCardWriter`, `state.scan`), `routes/index.ts`, `index.ts`; create `routes/radar.ts`, `routes/taxonomy.ts`, `routes/radar.test.ts`, `radar-cli.ts` (`scan | rank | refresh | plan | measure`), scripts `radar:scan`, `radar:rank`, `radar:plan`.

Rutas: `GET /radar/candidates?kind&verdict&sector&theme&assetClass` (join con tags), `GET /radar/candidates/:symbol` (candidato + fundamentals + tags + pares con métricas), `GET /radar/etfs`, `POST /radar/scan` (si `state.scan.running` → 409; si no, lanza `scanUniverse` sin await con `onProgress` → `state.scan`, `shouldStop` → `state.scan.stopRequested`), `POST /radar/scan/stop`, `GET /radar/scan-status`, `POST /radar/rank`, `POST /radar/refresh`, `GET /radar/plan`, `POST /radar/plan`, `GET /radar/measurement`; `GET /taxonomy/options` (sectores, temas, clases), `GET /taxonomy/:symbol`, `PUT /taxonomy/:symbol` (body Zod `{ assetClass?, sector?, themes? }` → `themesSource = "manual"`).
Cartera: `GET /cartera/risk` ya devuelve `bySector`/`byTheme` porque `runCartera` pasa `tags` a `buildRiskReport` (modificar `runCartera` para leer `allTags()`).

- [ ] Tests de rutas con `MemoryStore` (taxonomy PUT/GET; candidates con filtro por tema; scan 409 cuando corre; plan GET/POST). RED → implementar → GREEN → `pnpm typecheck` → commit `feat(api): rutas /radar y /taxonomy, barrido en segundo plano, crons`.

---

### Task 11: Pestaña Radar y etiquetas (web)

**Files:** Create `apps/web/src/Radar.tsx`, `Tags.tsx` (chips + editor de temas/clase/sector); modify `api.ts`, `App.tsx` (tab "radar" segunda), `Cartera.tsx` (chips de temas por fila, concentración por sector/tema en Riesgo, botón editar etiquetas), `styles.css` (`.chip`).

Radar: (1) tarjeta *Plan del aporte* (mes, total, líneas con símbolo, tipo, monto, motivo; botón Regenerar); (2) filtros (clase, sector, tema, verdict, kind); (3) tabla candidatos: verdict (chip), score, rank/grupo, precio, entrada, stop, objetivo, tamaño (qty y USD), riesgo, banderas, temas; "Ver" → ficha: summary, whyRanks, mainRisk, moat, ejes con z, tabla de pares (símbolo, P/E, EV/EBITDA, ROE, crecimiento, margen; mediana), insiders, consenso, sorpresas, filings; (4) tabla ETFs (rol, exposición, verdict, RS 3/6/12, distancia SMA200, stop/objetivo); (5) medición (por verdict y horizonte + COMPRAR−OBSERVAR); (6) botones Refrescar, Barrer universo (muestra progreso `scan-status` cada 5 s mientras corre, con Detener).
- [ ] Implementar → `pnpm --filter @thesis/web typecheck` → prueba manual → commit `feat(web): pestaña Radar, etiquetas y concentración por tema`.

---

### Task 12: Barrido real, ranking, plan y documentación

- [ ] `pnpm db:migrate`; `DATABASE_URL=… pnpm test` verde; `pnpm typecheck` verde.
- [ ] Reiniciar API; `POST /radar/scan` y seguir `GET /radar/scan-status` hasta terminar (≈1 h); anotar industrias no mapeadas del log y agregarlas a `config/taxonomia.json`.
- [ ] `POST /radar/rank` → revisar los 40 candidatos y ETFs en la UI; `POST /radar/plan` → plan de septiembre.
- [ ] README: sección Radar (universo, ranking, ETFs, plan, taxonomía, comandos, crons). `.env.example`: crons del radar.
- [ ] Commit `docs: radar etapa 2`; merge a `master` (ff) tras suite verde.

## Self-review

- **Spec coverage:** §3 fuentes → T6; §4 universo → T2, T6, T8; §5 taxonomía → T1, T8 (`applyTaxonomy`), T10 (`/taxonomy`), T11; §6 ranking y candidatos → T3, T4, T8; §7 ETFs → T4, T8; §8 plan → T5, T8, T10; §9 ficha → T9, T8; §10 refresco y medición → T5, T8, T10; §11 datos → T7; §12 API/UI → T10, T11; §13 tests → cada task; §14 riesgos → reanudable (T8), respaldo Yahoo (existente), USD desde acciones en circulación (T2).
- **Placeholders:** ninguno; el texto de `CARD_SYSTEM` es literal.
- **Type consistency:** `Fundamentals`, `CandidateRow`, `Tags`, `ContributionPlan`, `PlanLine` definidos en core (T1/T3/T5/T7) y usados por db, pipeline, api y web con esos nombres; `RadarStore` (T7/T8) mismos métodos en Repo y MemoryStore; `CardWriter.write(CardInput) → Card` (T9) consumido por `rankRadar` (T8).
