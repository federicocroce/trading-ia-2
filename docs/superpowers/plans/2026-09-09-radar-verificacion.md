# Radar — verificación de candidatos: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el Radar limpie one-offs con los estados de la SEC, lea noticias de 90 días y degrade por eventos graves, extraiga objetivos de analistas de titulares y nunca tome una sesión abierta como cerrada.

**Architecture:** funciones puras en `@thesis/core` (trimestres XBRL → ganancia núcleo; prefiltro de titulares; regex de analistas; velas de sesiones cerradas; reglas de veredicto), adapters nuevos en `@thesis/adapters` (SEC `companyfacts`, decorador de sesiones), un clasificador de titulares en `@thesis/reasoner` (tool estricta, mismo transporte que la ficha), persistencia en `@thesis/db` y `MemoryStore`, y la integración en `rankRadar`/`refreshRadar` de `@thesis/pipeline`. La API y la web solo muestran lo nuevo.

**Tech Stack:** TypeScript (NodeNext, ESM), pnpm workspaces, vitest, drizzle-orm/Postgres, zod, Gemini REST (`GeminiToolCaller`), Intl.DateTimeFormat (sin librerías de fechas).

**Spec:** `docs/superpowers/specs/2026-09-09-radar-verificacion-design.md`

## Global Constraints

- Ejecutar en un **worktree aparte** (`superpowers:using-git-worktrees`, rama `feat/radar-verificacion` desde `master`): otra sesión tiene cambios sin commitear en `packages/pipeline/src/radar.ts`, `packages/core/src/radar/conviction.ts`, `plan.ts` y otros. Nunca `git add -A` ni `git add .`: siempre rutas explícitas. Al terminar, rebase sobre `master`.
- Los fixtures reales ya existen en el repo: `test/fixtures/zvra-companyfacts.json` (SEC, 17 tags, 2024-06 en adelante) y `test/fixtures/zvra-news-2026-07.json` (16 noticias de Finnhub del 15 al 31 de julio de 2026). Se leen con `readFileSync` desde la raíz del repo (vitest corre desde la raíz).
- Comandos: tests `pnpm test` (o `pnpm exec vitest run <ruta>`), tipos `pnpm typecheck`, migraciones `pnpm db:generate` y `pnpm db:migrate` (con `pnpm db:up` antes; la base de desarrollo es compartida con la API que corre en launchd: los cambios son aditivos).
- Principios del spec: reglas deciden, el modelo clasifica y explica; fail-closed; toda regla que cambia un veredicto deja bandera y texto en la app. Mensajes de commit en español, formato `feat|fix|docs(...)`, y terminan con `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Ventana de eventos: **90 días**. Umbral de desvío por extraordinarios: **0,25**. Cierre US **16:10 America/New_York**; BYMA **17:10 America/Argentina/Buenos_Aires**. Frescura de estados: **7 días**. Concurrencia SEC: **4**.

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `packages/core/src/pricing/sessions.ts` (nuevo) | `completedCandles`, `marketOf`, `localDateTime`: velas solo de sesiones cerradas |
| `packages/adapters/src/history.ts` (modificar) | `CompletedSessionsHistory`: decorador de `PriceHistory` |
| `packages/core/src/radar/types.ts` (modificar) | tipos: `QuarterStatement`, `CoreEarnings`, `Statements`, `CompanyFactsJson`, eventos, analistas, `EventClassifier`; campos opcionales en `CandidateRow` y `CardInput` |
| `packages/core/src/radar/ranking.ts` (modificar) | `Fundamentals` + `metricsRaw?`, `statementsAsOf?` |
| `packages/core/src/radar/statements.ts` (nuevo) | `buildQuarters`, `coreEarnings`, `applyCoreMetrics`, listas de tags |
| `packages/adapters/src/edgar/statements.ts` (nuevo) | `CikResolver`, `SecStatements` (companyfacts) |
| `packages/core/src/radar/news.ts` (nuevo) | `materialHeadlines`, `parseAnalystAction`, `analystTargets` |
| `packages/reasoner/src/events.ts` (nuevo) | tool `material_events`, `parseMaterialEvents`, `GeminiEventClassifier`, `AnthropicEventClassifier` |
| `packages/core/src/radar/candidate.ts` (modificar) | `decideCandidate` con `core`, `events`, `eventsUnclassified`; banderas nuevas |
| `packages/core/src/radar/conviction.ts` (modificar) | salvedades por eventos y extraordinarios |
| `packages/reasoner/src/card.ts` (modificar) | secciones "Estados (SEC)" y "Eventos materiales" en el mensaje de la ficha |
| `packages/db/src/schema.ts`, `repo.ts`; `packages/pipeline/src/store.ts` | tablas `statements`, `radar_events`, `analyst_actions`, `radar_news_scans`; columnas nuevas; métodos de store |
| `packages/pipeline/src/radar-events.ts` (nuevo) | `scanEventsFor`: noticias → prefiltro → analistas por regex → clasificador → eventos guardados |
| `packages/pipeline/src/radar.ts` (modificar) | dos pasadas con estados; eventos en rank y refresco; `core`/`events` a la ficha |
| `apps/api/src/container.ts`, `routes/radar.ts`; `packages/pipeline/src/ticker.ts` | wiring y campos nuevos en la API |
| `apps/web/src/flags.ts` (nuevo), `api.ts`, `Ticker.tsx`, `Radar.tsx` | etiquetas de banderas y tres secciones nuevas |

---

### Task 1: velas de sesiones cerradas (core puro)

**Files:**
- Create: `packages/core/src/pricing/sessions.ts`
- Modify: `packages/core/src/pricing/index.ts` (agregar `export * from "./sessions.js";` al final)
- Test: `packages/core/src/pricing/sessions.test.ts`

**Interfaces:**
- Produces: `completedCandles(candles: Candle[], now: Date, market?: MarketId): Candle[]`, `marketOf(symbol: string): MarketId`, `localDateTime(now: Date, tz: string): { date: string; minutes: number }`, `type MarketId = "us" | "ar"`.

- [ ] **Step 1: escribir el test que falla**

```ts
// packages/core/src/pricing/sessions.test.ts
import { describe, expect, it } from "vitest";
import { completedCandles, localDateTime, marketOf } from "./sessions.js";

const candle = (date: string) => ({ date, open: 1, high: 1, low: 1, close: 1, volume: 1 });

describe("localDateTime", () => {
  it("convierte un instante UTC a fecha y minutos locales de Nueva York", () => {
    expect(localDateTime(new Date("2026-09-09T13:44:00Z"), "America/New_York")).toEqual({ date: "2026-09-09", minutes: 9 * 60 + 44 });
    expect(localDateTime(new Date("2026-09-10T02:30:00Z"), "America/New_York")).toEqual({ date: "2026-09-09", minutes: 22 * 60 + 30 });
  });
});

describe("completedCandles", () => {
  const series = [candle("2026-09-08"), candle("2026-09-09")];
  it("antes de las 16:10 de Nueva York descarta la vela de hoy", () => {
    expect(completedCandles(series, new Date("2026-09-09T13:44:00Z"))).toEqual([candle("2026-09-08")]);
    expect(completedCandles(series, new Date("2026-09-09T20:05:00Z"))).toEqual([candle("2026-09-08")]); // 16:05 ET
  });
  it("después del cierre la conserva", () => {
    expect(completedCandles(series, new Date("2026-09-09T20:11:00Z"))).toEqual(series); // 16:11 ET
    expect(completedCandles(series, new Date("2026-09-10T12:00:00Z"))).toEqual(series);
  });
  it("si la última vela no es de hoy no toca nada (fin de semana, feriado)", () => {
    expect(completedCandles([candle("2026-09-04")], new Date("2026-09-06T15:00:00Z"))).toEqual([candle("2026-09-04")]);
    expect(completedCandles([], new Date())).toEqual([]);
  });
  it("BYMA cierra a las 17:10 de Buenos Aires", () => {
    expect(completedCandles(series, new Date("2026-09-09T19:30:00Z"), "ar")).toEqual([candle("2026-09-08")]); // 16:30 ART
    expect(completedCandles(series, new Date("2026-09-09T20:15:00Z"), "ar")).toEqual(series); // 17:15 ART
  });
  it("marketOf: .BA es ar, el resto us", () => {
    expect(marketOf("GGAL.BA")).toBe("ar");
    expect(marketOf("ggal")).toBe("us");
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/core/src/pricing/sessions.test.ts`
Expected: FAIL, `Cannot find module './sessions.js'`.

- [ ] **Step 3: implementación mínima**

```ts
// packages/core/src/pricing/sessions.ts
import type { Candle } from "../cartera/types.js";

/**
 * Sesiones cerradas. Yahoo y Alpaca devuelven la vela en curso del día durante la rueda; tomarla como
 * cierre produce stops, objetivos y cierres falsos (caso ZVRA 2026-09-09). Sin red: solo reloj y zona horaria.
 */
export type MarketId = "us" | "ar";
const MARKETS: Record<MarketId, { tz: string; closeMinutes: number }> = {
  us: { tz: "America/New_York", closeMinutes: 16 * 60 + 10 },
  ar: { tz: "America/Argentina/Buenos_Aires", closeMinutes: 17 * 60 + 10 },
};

export function localDateTime(now: Date, tz: string): { date: string; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = Number(get("hour")) % 24; // algunos runtimes devuelven "24" a medianoche
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minutes: hour * 60 + Number(get("minute")) };
}

export const marketOf = (symbol: string): MarketId => (symbol.toUpperCase().endsWith(".BA") ? "ar" : "us");

/** Descarta la última vela si es la sesión de hoy y todavía no cerró (cierre + 10 minutos). */
export function completedCandles(candles: Candle[], now: Date, market: MarketId = "us"): Candle[] {
  const last = candles[candles.length - 1];
  if (!last) return candles;
  const m = MARKETS[market];
  const { date, minutes } = localDateTime(now, m.tz);
  return last.date === date && minutes < m.closeMinutes ? candles.slice(0, -1) : candles;
}
```

Y en `packages/core/src/pricing/index.ts`, última línea: `export * from "./sessions.js";`

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/core/src/pricing/sessions.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: commit**

```bash
git add packages/core/src/pricing/sessions.ts packages/core/src/pricing/sessions.test.ts packages/core/src/pricing/index.ts
git commit -m "feat(core): velas de sesiones cerradas (completedCandles) para US y BYMA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: decorador de sesiones en adapters y wiring en el container

**Files:**
- Modify: `packages/adapters/src/history.ts`
- Modify: `apps/api/src/container.ts:129` (la línea `const history = new FallbackPriceHistory(...)`)
- Test: `packages/adapters/test/cartera-adapters.test.ts` (agregar un `describe` al final)

**Interfaces:**
- Consumes: `completedCandles`, `marketOf` de `@thesis/core` (Task 1).
- Produces: `class CompletedSessionsHistory implements PriceHistory { constructor(inner: PriceHistory, now?: () => Date) }`.

- [ ] **Step 1: test que falla**

Agregar al final de `packages/adapters/test/cartera-adapters.test.ts`:

```ts
import { CompletedSessionsHistory } from "../src/index.js";

describe("CompletedSessionsHistory", () => {
  const inner = { candles: async (symbol: string) => [{ date: "2026-09-08", open: 1, high: 1, low: 1, close: 12.675, volume: 854_000 }, { date: "2026-09-09", open: 12.79, high: 12.79, low: 12.57, close: 12.57, volume: 95_582 }].map((c) => ({ ...c, close: symbol === "GGAL.BA" ? c.close * 100 : c.close })) };
  it("durante la rueda US descarta la vela parcial; después del cierre la deja", async () => {
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T13:44:00Z")).candles("ZVRA", 260)).map((c) => c.date)).toEqual(["2026-09-08"]);
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T21:00:00Z")).candles("ZVRA", 260)).map((c) => c.date)).toEqual(["2026-09-08", "2026-09-09"]);
  });
  it("los .BA usan el cierre de Buenos Aires", async () => {
    expect((await new CompletedSessionsHistory(inner, () => new Date("2026-09-09T19:30:00Z")).candles("GGAL.BA", 260)).map((c) => c.date)).toEqual(["2026-09-08"]);
  });
});
```

(Si el archivo ya importa `describe, expect, it` de vitest, no repetir el import; sí agregar `CompletedSessionsHistory` al import de `../src/index.js`.)

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/adapters/test/cartera-adapters.test.ts`
Expected: FAIL, `CompletedSessionsHistory` no exportado.

- [ ] **Step 3: implementación**

Agregar al final de `packages/adapters/src/history.ts`:

```ts
import { completedCandles, marketOf } from "@thesis/core";

/** Todos los consumidores de velas reciben solo sesiones cerradas (spec verificación §7). El reloj se inyecta para tests. */
export class CompletedSessionsHistory implements PriceHistory {
  constructor(
    private readonly inner: PriceHistory,
    private readonly now: () => Date = () => new Date(),
  ) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    return completedCandles(await this.inner.candles(symbol, days), this.now(), marketOf(symbol));
  }
}
```

(Mover el `import` junto a los otros imports del archivo; `Candle` y `PriceHistory` ya están importados como tipos.)

En `apps/api/src/container.ts`, reemplazar la línea 129:

```ts
  const history = new CompletedSessionsHistory(new FallbackPriceHistory(new YahooPriceHistory(yahooHttp), new AlpacaPriceHistory(http, cfg.alpaca), (m) => console.log(m)));
```

y agregar `CompletedSessionsHistory` al import de `@thesis/adapters` en la línea 2.

- [ ] **Step 4: correr tests y tipos**

Run: `pnpm exec vitest run packages/adapters/test/cartera-adapters.test.ts && pnpm typecheck`
Expected: PASS; typecheck sin errores.

- [ ] **Step 5: commit**

```bash
git add packages/adapters/src/history.ts packages/adapters/test/cartera-adapters.test.ts apps/api/src/container.ts
git commit -m "fix(radar): ninguna lectura de velas toma la sesión en curso como cerrada (decorador CompletedSessionsHistory)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: tipos de estados y armado de trimestres desde XBRL

**Files:**
- Modify: `packages/core/src/radar/types.ts` (agregar tipos al final)
- Modify: `packages/core/src/radar/ranking.ts:8-24` (`Fundamentals`: dos campos opcionales)
- Create: `packages/core/src/radar/statements.ts`
- Modify: `packages/core/src/radar/index.ts` (agregar `export * from "./statements.js";`)
- Test: `packages/core/src/radar/statements.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
/** Un trimestre de estados (SEC XBRL), en USD. null = tag ausente. */
export interface QuarterStatement {
  start: string;
  end: string;
  /** Q1..Q4 del reporte; Q4 cuando se deriva del anual. */
  fp: string;
  revenue: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  pretaxIncome: number | null;
  taxExpense: number | null;
  operatingCashFlow: number | null;
  capex: number | null;
  dilutedShares: number | null;
  equity: number | null;
  /** Ítems extraordinarios del trimestre con signo: ganancia > 0 infla, cargo < 0 deprime. */
  extraordinary: Array<{ tag: string; value: number }>;
}
export interface CoreEarnings {
  /** Fin del último trimestre usado. */
  asOf: string;
  revenueTTM: number | null;
  operatingIncomeTTM: number | null;
  coreOperatingIncomeTTM: number | null;
  netIncomeTTM: number | null;
  coreNetIncomeTTM: number | null;
  coreEpsTTM: number | null;
  operatingCashFlowTTM: number | null;
  freeCashFlowTTM: number | null;
  equity: number | null;
  taxRate: number;
  extraordinaryTTM: number;
  extraordinaryItems: Array<{ tag: string; quarterEnd: string; value: number }>;
  /** (neto − núcleo) / max(|neto|, |núcleo|, 1). > 0 ganancia inflada; < 0 deprimida. */
  deviationPct: number | null;
}
export interface Statements {
  symbol: string;
  cik: string;
  asOf: string;
  quarters: QuarterStatement[];
  core: CoreEarnings | null;
}
/** Forma mínima del JSON `companyfacts` de la SEC. */
export interface CompanyFactsJson {
  cik: number | string;
  entityName?: string;
  facts: { "us-gaap"?: Record<string, { units: Record<string, Array<{ start?: string; end: string; val: number; fp?: string; form?: string; filed?: string; frame?: string }>> }> };
}
```

- Produces (statements.ts): `buildQuarters(json: CompanyFactsJson): QuarterStatement[]` (últimos 8, ascendente por `end`), `REVENUE_TAGS`, `EXTRAORDINARY_TAGS: { gains: string[]; charges: string[] }`.
- `Fundamentals` (ranking.ts) gana `metricsRaw?: FinnhubMetrics | null; statementsAsOf?: string | null;` (opcionales; `null` en `statementsAsOf` = se intentó y no hay estados).

- [ ] **Step 1: test que falla**

```ts
// packages/core/src/radar/statements.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildQuarters, type CompanyFactsJson } from "../index.js";

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
    expect(M(q4.operatingIncome)).toBe(9.4); // -62.9 - (-72.3)
    expect(M(q4.netIncome)).toBe(12.1); // 83.2 - 71.1
    expect(M(q4.taxExpense)).toBe(0.5); // 3.4 - 2.9
  });
  it("los flujos de caja (solo acumulados) salen por diferencia", () => {
    expect(M(byEnd["2026-06-30"]!.operatingCashFlow)).toBe(17.1); // 23.2 - 6.1
    expect(M(byEnd["2026-03-31"]!.operatingCashFlow)).toBe(6.1);
  });
  it("patrimonio y acciones diluidas del trimestre; ingresos por prioridad de tags", () => {
    expect(M(byEnd["2026-06-30"]!.equity)).toBe(217.7);
    expect(Math.round(byEnd["2026-06-30"]!.dilutedShares! / 1e5) / 10).toBe(61.3);
    expect(M(byEnd["2026-06-30"]!.revenue)).toBe(39.7);
  });
  it("captura la ganancia por venta de activos del Q1 2026 como extraordinario positivo", () => {
    expect(byEnd["2026-03-31"]!.extraordinary).toEqual([{ tag: "GainLossOnDispositionOfAssets1", value: 43_314_000 }]);
    expect(byEnd["2026-06-30"]!.extraordinary).toEqual([]);
  });
  it("sin hechos → sin trimestres", () => {
    expect(buildQuarters({ cik: 1, facts: {} })).toEqual([]);
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/core/src/radar/statements.test.ts`
Expected: FAIL, `buildQuarters` no existe.

- [ ] **Step 3: implementación**

Agregar los tipos del bloque **Interfaces** al final de `packages/core/src/radar/types.ts`. En `packages/core/src/radar/ranking.ts`, dentro de `export interface Fundamentals`, después de `earningsSurprises`:

```ts
  /** Métricas de Finnhub originales cuando `metrics` fue recalculado con la ganancia núcleo (spec verificación §4). */
  metricsRaw?: FinnhubMetrics | null;
  /** Fin del último trimestre usado; null = se intentó y no hay estados (IFRS, sin CIK, sin resultado operativo). */
  statementsAsOf?: string | null;
```

Crear `packages/core/src/radar/statements.ts`:

```ts
import type { FinnhubMetrics } from "./universe.js";
import type { Fundamentals } from "./ranking.js";
import type { CompanyFactsJson, CoreEarnings, QuarterStatement } from "./types.js";

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
```

(`coreEarnings` y `applyCoreMetrics` se agregan en la Task 4; los imports de `FinnhubMetrics`, `Fundamentals` y `CoreEarnings` quedan listos para eso. Si el linter de tipos se queja por imports sin uso, agregarlos recién en la Task 4.)

En `packages/core/src/radar/index.ts` agregar `export * from "./statements.js";`.

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/core/src/radar/statements.test.ts && pnpm typecheck`
Expected: PASS (7 tests). Si "deriva el Q4" falla por el `fp`: el 10-K de ZVRA reporta el anual con `fp: "FY"` y 364 días; la regla `days > 300 → "Q4"` lo cubre. Si falla por décimas, revisar que `factsOf` esté quedándose con el `filed` más reciente (las reexpresiones del 10-K cambian centenas de miles).

- [ ] **Step 5: commit**

```bash
git add packages/core/src/radar/types.ts packages/core/src/radar/ranking.ts packages/core/src/radar/statements.ts packages/core/src/radar/statements.test.ts packages/core/src/radar/index.ts test/fixtures/zvra-companyfacts.json test/fixtures/zvra-news-2026-07.json
git commit -m "feat(radar): trimestres desde XBRL de la SEC (directos, Q4 derivado, flujos por diferencia) con fixture real de ZVRA

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: ganancia núcleo y recálculo de métricas

**Files:**
- Modify: `packages/core/src/radar/statements.ts` (agregar `coreEarnings` y `applyCoreMetrics`)
- Test: `packages/core/src/radar/statements.test.ts` (agregar dos `describe`)

**Interfaces:**
- Consumes: `buildQuarters`, tipos de Task 3.
- Produces: `coreEarnings(quarters: QuarterStatement[]): CoreEarnings | null` (null con menos de 4 trimestres con operativo y neto); `applyCoreMetrics(f: Fundamentals, core: CoreEarnings | null, priceUsd: number): Fundamentals`.

- [ ] **Step 1: test que falla**

Agregar a `packages/core/src/radar/statements.test.ts` (sumar `applyCoreMetrics, coreEarnings, type Fundamentals` al import):

```ts
describe("coreEarnings (ZVRA, TTM al Q2 2026)", () => {
  const core = coreEarnings(buildQuarters(zvra))!;
  it("suma los últimos 4 trimestres y separa los extraordinarios", () => {
    expect(core.asOf).toBe("2026-06-30");
    expect(M(core.revenueTTM)).toBe(136.1);
    expect(M(core.operatingIncomeTTM)).toBe(82.4);
    expect(M(core.extraordinaryTTM)).toBe(43.3);
    expect(M(core.coreOperatingIncomeTTM)).toBe(39.1);
    expect(core.extraordinaryItems).toEqual([{ tag: "GainLossOnDispositionOfAssets1", quarterEnd: "2026-03-31", value: 43_314_000 }]);
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
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/core/src/radar/statements.test.ts`
Expected: FAIL, `coreEarnings` no exportado.

- [ ] **Step 3: implementación**

Agregar al final de `packages/core/src/radar/statements.ts`:

```ts
const DEVIATION_FLAG = 0.25;
const DEFAULT_TAX = 0.21;
const r4 = (n: number) => Math.round(n * 10_000) / 10_000;
const sumOrNull = (xs: Array<number | null>): number | null => (xs.some((x) => x === null) ? null : xs.reduce((a, b) => a + (b as number), 0));

/** Ganancia núcleo sobre los últimos 4 trimestres (spec verificación §4). null si no hay 4 con operativo y neto. */
export function coreEarnings(quarters: QuarterStatement[]): CoreEarnings | null {
  const last4 = quarters.filter((q) => q.operatingIncome !== null && q.netIncome !== null).slice(-4);
  if (last4.length < 4) return null;
  const operatingIncomeTTM = sumOrNull(last4.map((q) => q.operatingIncome))!;
  const netIncomeTTM = sumOrNull(last4.map((q) => q.netIncome))!;
  const extraordinaryItems = last4.flatMap((q) => q.extraordinary.map((e) => ({ tag: e.tag, quarterEnd: q.end, value: e.value })));
  const extraordinaryTTM = extraordinaryItems.reduce((s, e) => s + e.value, 0);
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

/** Bandera `resultado_extraordinario` cuando el neto reportado se aparta del núcleo más del 25%. */
export const hasExtraordinary = (core: CoreEarnings | null | undefined): boolean => !!core && core.deviationPct !== null && Math.abs(core.deviationPct) > DEVIATION_FLAG;

/** Reemplaza P/E, ROE y márgenes por las cifras núcleo; Finnhub queda en `metricsRaw`. Sin núcleo o sin ingresos: nada cambia, `statementsAsOf` null. */
export function applyCoreMetrics(f: Fundamentals, core: CoreEarnings | null, priceUsd: number): Fundamentals {
  const raw = f.metricsRaw ?? f.metrics;
  if (!core || core.revenueTTM === null || core.revenueTTM <= 0 || core.coreOperatingIncomeTTM === null) return { ...f, metrics: raw, metricsRaw: raw, statementsAsOf: null };
  const metrics: FinnhubMetrics = { ...raw };
  metrics["peTTM"] = core.coreEpsTTM !== null && core.coreEpsTTM > 0 ? r4(priceUsd / core.coreEpsTTM) : null;
  metrics["operatingMarginTTM"] = r4((core.coreOperatingIncomeTTM / core.revenueTTM) * 100);
  metrics["netProfitMarginTTM"] = core.coreNetIncomeTTM === null ? raw["netProfitMarginTTM"] : r4((core.coreNetIncomeTTM / core.revenueTTM) * 100);
  metrics["roeTTM"] = core.equity && core.equity > 0 && core.coreNetIncomeTTM !== null ? r4((core.coreNetIncomeTTM / core.equity) * 100) : raw["roeTTM"];
  return { ...f, metrics, metricsRaw: raw, statementsAsOf: core.asOf };
}
```

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/core/src/radar/statements.test.ts && pnpm typecheck`
Expected: PASS (todos). Referencia con el fixture: operativo TTM 82,4M; núcleo 39,1M; neto reportado ≈ 58,3M; tasa ≈ 0,16; neto núcleo ≈ 32,9M; EPS núcleo ≈ 0,54; P/E a 12,57 ≈ 23,4x; desvío ≈ 0,43.

- [ ] **Step 5: commit**

```bash
git add packages/core/src/radar/statements.ts packages/core/src/radar/statements.test.ts
git commit -m "feat(radar): ganancia núcleo (operativo sin extraordinarios × (1 − tasa)) y recálculo de P/E, ROE y márgenes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: adapter SEC companyfacts

**Files:**
- Create: `packages/adapters/src/edgar/statements.ts`
- Modify: `packages/adapters/src/index.ts` (agregar `export * from "./edgar/statements.js";`)
- Test: `packages/adapters/test/radar-adapters.test.ts` (agregar un `describe`)

**Interfaces:**
- Consumes: `HttpClient` (`../http/index.js`), `buildQuarters`, `coreEarnings`, tipos `Statements`, `CompanyFactsJson` de `@thesis/core`.
- Produces: `class CikResolver { constructor(http: HttpClient); resolve(ticker: string): Promise<string | null> }`, `companyFactsUrl(cik: string): string`, `class SecStatements { constructor(http: HttpClient, resolver?: CikResolver); quarters(symbol: string, today: string): Promise<Statements | null> }`.

- [ ] **Step 1: test que falla**

Agregar a `packages/adapters/test/radar-adapters.test.ts` (sumar `SecStatements` al import de `../src/index.js`, y `import { readFileSync } from "node:fs";`):

```ts
describe("SecStatements", () => {
  const facts = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8"));
  const http = fixtureHttpClient({
    "https://www.sec.gov/files/company_tickers.json": { "0": { cik_str: 1434647, ticker: "ZVRA", title: "Zevra Therapeutics, Inc." } },
    "https://data.sec.gov/api/xbrl/companyfacts/CIK0001434647.json": facts,
  });
  it("resuelve el CIK, baja companyfacts y devuelve trimestres con núcleo", async () => {
    const s = await new SecStatements(http).quarters("zvra", "2026-09-09");
    expect(s?.symbol).toBe("ZVRA");
    expect(s?.cik).toBe("1434647");
    expect(s?.asOf).toBe("2026-09-09");
    expect(s?.quarters.length).toBeGreaterThanOrEqual(6);
    expect(s?.core?.asOf).toBe("2026-06-30");
  });
  it("símbolo sin CIK → null (IFRS, extranjero)", async () => {
    expect(await new SecStatements(http).quarters("VIST", "2026-09-09")).toBeNull();
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/adapters/test/radar-adapters.test.ts`
Expected: FAIL, `SecStatements` no exportado.

- [ ] **Step 3: implementación**

```ts
// packages/adapters/src/edgar/statements.ts
import { buildQuarters, coreEarnings, type CompanyFactsJson, type Statements } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

/**
 * Estados trimestrales desde la API XBRL de la SEC (spec verificación §4). Gratis; exige User-Agent con contacto
 * (el `http` del container ya lo lleva) y ≤ 10 req/s. Un JSON por empresa (0,5–3 MB): el pipeline lo pide solo
 * para la pre-selección y sus pares, con caché de 7 días.
 */
const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
export const companyFactsUrl = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik.padStart(10, "0")}.json`;

interface CompanyTickers {
  [k: string]: { cik_str: number; ticker: string; title: string };
}

export class CikResolver {
  private cache: Map<string, string> | null = null;
  constructor(private readonly http: HttpClient) {}
  async resolve(ticker: string): Promise<string | null> {
    if (!this.cache) {
      const data = await this.http.getJson<CompanyTickers>(TICKERS_URL);
      this.cache = new Map(Object.values(data).map((c) => [c.ticker.toUpperCase(), String(c.cik_str)]));
    }
    return this.cache.get(ticker.toUpperCase()) ?? null;
  }
}

export class SecStatements {
  private readonly resolver: CikResolver;
  constructor(
    private readonly http: HttpClient,
    resolver?: CikResolver,
  ) {
    this.resolver = resolver ?? new CikResolver(http);
  }
  async quarters(symbol: string, today: string): Promise<Statements | null> {
    const sym = symbol.toUpperCase();
    const cik = await this.resolver.resolve(sym);
    if (!cik) return null;
    const json = await this.http.getJson<CompanyFactsJson>(companyFactsUrl(cik));
    const quarters = buildQuarters(json);
    if (!quarters.length) return null;
    return { symbol: sym, cik, asOf: today, quarters, core: coreEarnings(quarters) };
  }
}
```

En `packages/adapters/src/index.ts` agregar `export * from "./edgar/statements.js";`.

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/adapters/test/radar-adapters.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add packages/adapters/src/edgar/statements.ts packages/adapters/src/index.ts packages/adapters/test/radar-adapters.test.ts
git commit -m "feat(adapters): estados trimestrales desde companyfacts de la SEC (CIK por company_tickers)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: persistencia de estados (tabla, Repo, MemoryStore, columnas en fundamentals)

**Files:**
- Modify: `packages/db/src/schema.ts` (tabla `statements`; columnas `metrics_raw`, `statements_as_of` en `fundamentals`)
- Modify: `packages/db/src/repo.ts` (`saveFundamentals`, `rowToFundamentals`, `statements`, `saveStatements`)
- Modify: `packages/pipeline/src/store.ts` (`RadarStore` + `MemoryStore`)
- Modify: `packages/db/src/repo.integration.test.ts` (un `it` nuevo dentro del `d("Repo (Postgres real)")`)
- Test: `packages/pipeline/test/radar.test.ts` (un `describe` para MemoryStore)

**Interfaces:**
- Produces (`RadarStore`): `statements(symbol: string): Promise<Statements | null>`, `saveStatements(s: Statements): Promise<void>`.
- `Fundamentals.metricsRaw` y `statementsAsOf` persisten en `fundamentals`.

- [ ] **Step 1: test que falla (MemoryStore)**

Agregar al final de `packages/pipeline/test/radar.test.ts`:

```ts
describe("MemoryStore: estados", () => {
  it("guarda y devuelve estados por símbolo; fundamentals conserva metricsRaw y statementsAsOf", async () => {
    const store = new MemoryStore();
    expect(await store.statements("ZVRA")).toBeNull();
    await store.saveStatements({ symbol: "zvra", cik: "1434647", asOf: "2026-09-09", quarters: [], core: null });
    expect((await store.statements("ZVRA"))?.cik).toBe("1434647");
    await store.saveFundamentals({ symbol: "ZVRA", asOf: "2026-09-09", metrics: { peTTM: 23.4 }, metricsRaw: { peTTM: 12.8 }, statementsAsOf: "2026-06-30", peers: [], industry: null, mcapUsd: null, dollarVolumeUsd: 1, priceUsd: 12.57, nextEarnings: null, insiderBuys90d: null, insiderSells90d: null, analyst: null, earningsSurprises: null });
    const f = await store.fundamentals("ZVRA");
    expect(f?.metricsRaw?.["peTTM"]).toBe(12.8);
    expect(f?.statementsAsOf).toBe("2026-06-30");
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/pipeline/test/radar.test.ts -t "MemoryStore: estados"`
Expected: FAIL, `store.statements is not a function`.

- [ ] **Step 3: implementación**

`packages/pipeline/src/store.ts`: agregar `Statements` al import de tipos de `@thesis/core`; en `RadarStore`, después de `freshFundamentals(...)`:

```ts
  /** Estados trimestrales de la SEC con la ganancia núcleo (spec verificación §4). `quarters: []` = se intentó y no hay. */
  statements(symbol: string): Promise<Statements | null>;
  saveStatements(s: Statements): Promise<void>;
```

En `MemoryStore`: campo `statementsMap = new Map<string, Statements>();` y, junto a `freshFundamentals`:

```ts
  async statements(symbol: string) {
    return this.statementsMap.get(symbol.toUpperCase()) ?? null;
  }
  async saveStatements(s: Statements) {
    this.statementsMap.set(s.symbol.toUpperCase(), { ...s, symbol: s.symbol.toUpperCase() });
  }
```

`packages/db/src/schema.ts`: en `fundamentals`, después de `earningsSurprises`:

```ts
  metricsRaw: jsonb("metrics_raw"),
  statementsAsOf: date("statements_as_of"),
```

y una tabla nueva después de `fundamentals`:

```ts
/** Estados trimestrales de la SEC y ganancia núcleo (spec verificación §4). */
export const statements = pgTable("statements", {
  symbol: text("symbol").primaryKey(),
  cik: text("cik"),
  asOf: date("as_of").notNull(),
  quarters: jsonb("quarters").notNull().default([]),
  core: jsonb("core"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/repo.ts`: agregar `Statements` al import de tipos; en `saveFundamentals`, dentro del objeto `v`, agregar `metricsRaw: f.metricsRaw ?? null, statementsAsOf: f.statementsAsOf ?? null,`; en `rowToFundamentals`, agregar `metricsRaw: (r.metricsRaw as Fundamentals["metricsRaw"]) ?? null, statementsAsOf: r.statementsAsOf ?? undefined,` (undefined = nunca intentado, para que `sin_estados` solo aparezca cuando se intentó). Métodos nuevos después de `freshFundamentals`:

```ts
  async statements(symbol: string): Promise<Statements | null> {
    const r = (await this.db.select().from(s.statements).where(eq(s.statements.symbol, symbol.toUpperCase())))[0];
    return r ? { symbol: r.symbol, cik: r.cik ?? "", asOf: r.asOf, quarters: (r.quarters as Statements["quarters"]) ?? [], core: (r.core as Statements["core"]) ?? null } : null;
  }
  async saveStatements(st: Statements): Promise<void> {
    const v = { symbol: st.symbol.toUpperCase(), cik: st.cik || null, asOf: st.asOf, quarters: st.quarters, core: st.core, updatedAt: new Date() };
    await this.db.insert(s.statements).values(v).onConflictDoUpdate({ target: s.statements.symbol, set: v });
  }
```

Migración: `pnpm db:up && pnpm db:generate && pnpm db:migrate` (genera `packages/db/drizzle/0009_*.sql` con la tabla y las dos columnas; revisar que el SQL sea aditivo antes de migrar).

Test de integración: en `packages/db/src/repo.integration.test.ts`, agregar dentro del `d(...)`, y en `afterAll` la limpieza `await db.delete(schema.statements).where(eq(schema.statements.symbol, rsym));`:

```ts
  it("statements: upsert y lectura", async () => {
    const rsym = `R${ticker}`;
    await repo.saveStatements({ symbol: rsym, cik: "1", asOf: "2026-09-09", quarters: [], core: null });
    await repo.saveStatements({ symbol: rsym, cik: "2", asOf: "2026-09-10", quarters: [], core: null });
    expect((await repo.statements(rsym))?.cik).toBe("2");
  });
```

- [ ] **Step 4: correr tests y tipos**

Run: `pnpm exec vitest run packages/pipeline/test/radar.test.ts packages/db && pnpm typecheck`
Expected: PASS; con `DATABASE_URL=postgres://thesis:thesis@localhost:5433/thesis` en el shell corre también el de integración.

- [ ] **Step 5: commit**

```bash
git add packages/db/src/schema.ts packages/db/src/repo.ts packages/db/drizzle packages/pipeline/src/store.ts packages/pipeline/test/radar.test.ts packages/db/src/repo.integration.test.ts
git commit -m "feat(db): tabla statements y columnas metrics_raw / statements_as_of en fundamentals

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: ranking en dos pasadas con estados; banderas `resultado_extraordinario` y `sin_estados`; estados en la ficha

**Files:**
- Modify: `packages/core/src/radar/candidate.ts:80-131` (`buildFlags`, `decideCandidate`)
- Modify: `packages/core/src/radar/types.ts` (`CardInput` + `core?`, `quarters?`)
- Modify: `packages/reasoner/src/card.ts` (`CARD_SYSTEM`, `buildCardMessage`)
- Modify: `packages/pipeline/src/radar.ts` (`RadarDeps`, `writeCardFor`, `rankRadar`, `refreshRadar`)
- Test: `packages/core/src/radar/candidate.test.ts`, `packages/reasoner/test/card.test.ts`, `packages/pipeline/test/radar.test.ts`

**Interfaces:**
- Consumes: `coreEarnings`, `applyCoreMetrics`, `hasExtraordinary` (Task 4), `RadarStore.statements/saveStatements` (Task 6), `SecStatements.quarters(symbol, today)` (Task 5).
- Produces:
  - `decideCandidate(i: { f; candles; nthAppearance; portfolioUsd; today; core?: CoreEarnings | null }, p)`: `core === null` → bandera `sin_estados`; `hasExtraordinary(core)` → bandera `resultado_extraordinario`; `undefined` → nada.
  - `buildFlags(f, gate, nthAppearance, chronicWeeks, extra?: { core?: CoreEarnings | null })`.
  - `CardInput.core?: CoreEarnings | null`, `CardInput.quarters?: QuarterStatement[]`.
  - `RadarDeps.statements?: { quarters(symbol: string, today: string): Promise<Statements | null> } | null`.
  - `withStatements(deps, all, symbols, today): Promise<Map<string, CoreEarnings | null>>` (interna del pipeline, exportada para tests).

- [ ] **Step 1: tests que fallan**

`packages/core/src/radar/candidate.test.ts`, agregar (sumar `coreEarnings, buildQuarters, type CompanyFactsJson` al import y `import { readFileSync } from "node:fs";`):

```ts
describe("decideCandidate con estados", () => {
  const zvra = JSON.parse(readFileSync("test/fixtures/zvra-companyfacts.json", "utf8")) as CompanyFactsJson;
  const core = coreEarnings(buildQuarters(zvra));
  const base = { candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("desvío > 25% → resultado_extraordinario; sigue COMPRAR", () => {
    const d = decideCandidate({ f: f(), ...base, core }, policy);
    expect("excluded" in d).toBe(false);
    if (!("excluded" in d)) {
      expect(d.verdict).toBe("COMPRAR");
      expect(d.flags).toContain("resultado_extraordinario");
    }
  });
  it("core null → sin_estados; undefined → ninguna de las dos", () => {
    const a = decideCandidate({ f: f(), ...base, core: null }, policy);
    const b = decideCandidate({ f: f(), ...base }, policy);
    if (!("excluded" in a)) expect(a.flags).toContain("sin_estados");
    if (!("excluded" in b)) expect(b.flags).not.toEqual(expect.arrayContaining(["sin_estados", "resultado_extraordinario"]));
  });
  it("desvío chico → sin bandera", () => {
    const d = decideCandidate({ f: f(), ...base, core: { ...core!, deviationPct: 0.1 } }, policy);
    if (!("excluded" in d)) expect(d.flags).not.toContain("resultado_extraordinario");
  });
});
```

`packages/reasoner/test/card.test.ts`, agregar dentro del `describe("ficha de candidato")`:

```ts
  it("con estados: el mensaje lleva los trimestres, el TTM núcleo y el ítem extraordinario; sin estados lo dice", () => {
    const q = { start: "2026-04-01", end: "2026-06-30", fp: "Q2", revenue: 39.7e6, operatingIncome: 16.8e6, netIncome: 8.8e6, pretaxIncome: 12.8e6, taxExpense: 4e6, operatingCashFlow: 17.1e6, capex: 0, dilutedShares: 61.3e6, equity: 217.7e6, extraordinary: [] };
    const core = { asOf: "2026-06-30", revenueTTM: 136.1e6, operatingIncomeTTM: 82.4e6, coreOperatingIncomeTTM: 39.1e6, netIncomeTTM: 58.3e6, coreNetIncomeTTM: 32.9e6, coreEpsTTM: 0.54, operatingCashFlowTTM: 32.6e6, freeCashFlowTTM: 32.6e6, equity: 217.7e6, taxRate: 0.16, extraordinaryTTM: 43.3e6, extraordinaryItems: [{ tag: "GainLossOnDispositionOfAssets1", quarterEnd: "2026-03-31", value: 43.3e6 }], deviationPct: 0.43 };
    const m = buildCardMessage({ ...input, quarters: [q], core });
    for (const s of ["Estados (SEC", "2026-06-30: ingresos 39.7M", "neto núcleo 32.9M", "desvío 43%", "GainLossOnDispositionOfAssets1 43.3M (2026-03-31)"]) expect(m).toContain(s);
    expect(buildCardMessage({ ...input, quarters: [], core: null })).toContain("sin estados");
    expect(buildCardMessage(input)).not.toContain("Estados (SEC");
    expect(CARD_SYSTEM).toContain("ganancia núcleo");
  });
```

`packages/pipeline/test/radar.test.ts`, agregar (sumar `coreEarnings, type CardInput, type QuarterStatement, type Statements` a los imports desde `@thesis/core`, y `withStatements` desde `../src/index.js`):

```ts
/** 4 trimestres sintéticos: operativo 60M con una ganancia por venta de 35M adentro → núcleo 25M; 1M de acciones → EPS núcleo alto → P/E ≈ 5. */
const syntheticQuarters = (): QuarterStatement[] => ["2025-09-30", "2025-12-31", "2026-03-31", "2026-06-30"].map((end, i) => ({ start: end, end, fp: `Q${i + 1}`, revenue: 100e6, operatingIncome: 60e6, netIncome: 60e6, pretaxIncome: 60e6, taxExpense: 12e6, operatingCashFlow: 20e6, capex: 1e6, dilutedShares: 1e6, equity: 200e6, extraordinary: [{ tag: "GainLossOnDispositionOfAssets1", value: 35e6 }] }));

describe("rankRadar con estados de la SEC", () => {
  it("segunda pasada con ganancia núcleo: bandera, metricsRaw, caché de 7 días y estados en la ficha", async () => {
    const calls: string[] = [];
    const inputs: CardInput[] = [];
    const qs = syntheticQuarters();
    const statements = { quarters: async (s: string, today: string): Promise<Statements | null> => { calls.push(s); return s === "SC" ? { symbol: s, cik: "1", asOf: today, quarters: qs, core: coreEarnings(qs) } : null; } };
    const cardWriter: CardWriter = { promptVersion: "card-test", write: async (i) => { inputs.push(i); return { summary: "x", whyRanks: "y", mainRisk: "z", moat: "moderado", themes: [], degrade: false }; } };
    const { store, d } = deps({ statements, cardWriter });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    expect(new Set(calls)).toEqual(new Set(symbols)); // pre-selección (20 > 12) más pares: todos
    const sc = r.candidates.find((c) => c.symbol === "SC")!;
    expect(sc.flags).toContain("resultado_extraordinario");
    expect(sc.flags).not.toContain("sin_estados");
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.flags).toContain("sin_estados");
    const f = (await store.fundamentals("SC"))!;
    expect(f.metricsRaw?.["peTTM"]).toBeCloseTo(20 / 1.1, 3);
    expect(f.metrics["peTTM"]!).toBeLessThan(10);
    expect(f.statementsAsOf).toBe("2026-06-30");
    expect((await store.fundamentals("SA"))!.statementsAsOf).toBeNull();
    const scInput = inputs.find((i) => i.symbol === "SC")!;
    expect(scInput.core?.deviationPct).toBeGreaterThan(0.25);
    expect(scInput.quarters).toHaveLength(4);
    calls.length = 0;
    await rankRadar(d, { today: "2026-05-20", portfolioUsd: 150_000 });
    expect(calls).toEqual([]); // frescos: no vuelve a pedir
  });
});
```

- [ ] **Step 2: correr y ver que fallan**

Run: `pnpm exec vitest run packages/core/src/radar/candidate.test.ts packages/reasoner/test/card.test.ts packages/pipeline/test/radar.test.ts`
Expected: FAIL (banderas ausentes, `withStatements` no exportado, mensaje sin "Estados").

- [ ] **Step 3: implementación**

`packages/core/src/radar/candidate.ts`: importar `hasExtraordinary` desde `./statements.js` y `CoreEarnings` desde `./types.js`. `buildFlags`:

```ts
export function buildFlags(f: Fundamentals, gate: TechnicalGate, nthAppearance: number, chronicWeeks: number, extra: { core?: CoreEarnings | null } = {}): string[] {
  const flags: string[] = [];
  // ... (cuerpo actual sin cambios hasta antes del `return flags;`)
  if (extra.core === null) flags.push("sin_estados");
  if (hasExtraordinary(extra.core)) flags.push("resultado_extraordinario");
  return flags;
}
```

`decideCandidate`: el parámetro `i` pasa a `{ f: Fundamentals; candles: Candle[]; nthAppearance: number; portfolioUsd: number | null; today: string; core?: CoreEarnings | null }` y la llamada a `buildFlags` pasa `{ core: i.core }`.

`packages/core/src/radar/types.ts`, en `CardInput` después de `filings: string[];`:

```ts
  /** Estados de la SEC (spec verificación §4): últimos 4 trimestres y ganancia núcleo. undefined = no se pidieron; [] = no hay. */
  quarters?: QuarterStatement[];
  core?: CoreEarnings | null;
```

`packages/reasoner/src/card.ts`: en `CARD_SYSTEM`, antes de "No propongas otro verbo.", agregar el párrafo:

```
Si recibís "Estados (SEC)": las métricas propias ya están recalculadas con la ganancia núcleo (operativo sin extraordinarios, neto de impuestos). Citá el P/E y los márgenes recalculados, nunca los de Finnhub, y si el desvío supera 25% decilo en mainRisk con el ítem que lo causa.
```

y en `buildCardMessage`, después del bloque `# Métricas`, insertar `...(i.quarters !== undefined ? [statementsSection(i)] : [])` en el array (el array se arma con `[...]`, así que convertir ese elemento con spread). Función nueva en el mismo archivo:

```ts
const M = (v: number | null) => (v === null ? "—" : `${(v / 1e6).toFixed(1)}M`);
function statementsSection(i: CardInput): string {
  if (!i.quarters?.length) return "# Estados (SEC)\nsin estados: las métricas son de Finnhub y pueden incluir extraordinarios";
  const rows = i.quarters.map((q) => `${q.end}: ingresos ${M(q.revenue)} · operativo ${M(q.operatingIncome)} · neto ${M(q.netIncome)} · flujo operativo ${M(q.operatingCashFlow)}`);
  const c = i.core;
  const items = c?.extraordinaryItems.length ? ` por extraordinarios: ${c.extraordinaryItems.map((e) => `${e.tag} ${M(e.value)} (${e.quarterEnd})`).join(", ")}` : "";
  const ttm = c ? `TTM: ingresos ${M(c.revenueTTM)} · operativo núcleo ${M(c.coreOperatingIncomeTTM)} · neto reportado ${M(c.netIncomeTTM)} · neto núcleo ${M(c.coreNetIncomeTTM)} · EPS núcleo ${c.coreEpsTTM ?? "—"} · desvío ${c.deviationPct === null ? "—" : `${Math.round(c.deviationPct * 100)}%`}${items}` : "TTM: sin núcleo (menos de 4 trimestres completos)";
  return `# Estados (SEC, últimos 4 trimestres)\n${rows.join("\n")}\n${ttm}`;
}
```

`packages/pipeline/src/radar.ts`:

1. Imports desde `@thesis/core`: agregar `applyCoreMetrics`, `type CoreEarnings`, `type QuarterStatement`, `type Statements`.
2. `RadarDeps`: agregar `statements?: { quarters(symbol: string, today: string): Promise<Statements | null> } | null;` con el comentario `/** Estados de la SEC (spec verificación §4). Sin él, el ranking usa solo Finnhub. */`.
3. Constante `const STATEMENTS_CONCURRENCY = 4;`.
4. Función exportada, antes de `rankRadar`:

```ts
/** Pide (o lee de caché, 7 días) los estados de `symbols`, recalcula sus métricas en `all` y las persiste. Devuelve el núcleo por símbolo (null = no hay). */
export async function withStatements(deps: RadarDeps, all: Map<string, Fundamentals>, symbols: string[], today: string): Promise<Map<string, CoreEarnings | null>> {
  const cores = new Map<string, CoreEarnings | null>();
  const src = deps.statements;
  if (!src) return cores;
  const { store } = deps;
  const pending = [...new Set(symbols)].filter((s) => all.has(s));
  for (let i = 0; i < pending.length; i += STATEMENTS_CONCURRENCY) {
    await Promise.all(pending.slice(i, i + STATEMENTS_CONCURRENCY).map(async (sym) => {
      let st = await store.statements(sym);
      if (!st || ageDays(st.asOf, today) >= FRESH_DAYS) {
        const fetched = await src.quarters(sym, today).catch((e) => { deps.log?.(`[radar] estados de ${sym} fallaron`, { error: String(e).slice(0, 120) }); return undefined; });
        if (fetched !== undefined) {
          st = fetched ?? { symbol: sym, cik: "", asOf: today, quarters: [], core: null };
          await store.saveStatements(st);
        }
      }
      const core = st?.core ?? null;
      cores.set(sym, core);
      const f = all.get(sym)!;
      const updated = applyCoreMetrics(f, core, f.priceUsd);
      all.set(sym, updated);
      await store.saveFundamentals(updated);
    }));
  }
  return cores;
}
```

5. En `rankRadar`, reemplazar las dos líneas `const { ranked, skipped } = rankStocks(all, policy.weights);` y `const pre = ranked.slice(0, policy.candidates.preselect);` por:

```ts
  // Dos pasadas (spec verificación §4): la primera con Finnhub elige a quién pedirle estados; la segunda rankea con la ganancia núcleo.
  const first = rankStocks(all, policy.weights).ranked.slice(0, policy.candidates.preselect);
  const cores = await withStatements(deps, all, first.flatMap((r) => [r.symbol, ...r.group]), opts.today);
  const { ranked, skipped } = rankStocks(all, policy.weights);
  const pre = ranked.slice(0, policy.candidates.preselect);
  const coreOf = (sym: string): CoreEarnings | null | undefined => (deps.statements ? (cores.get(sym) ?? null) : undefined);
```

   y en las dos llamadas a `decideCandidate` de `rankRadar` agregar `core: coreOf(r.symbol)` (filtro técnico) y `core: coreOf(sym)` (candidatos). En la llamada a `writeCardFor` pasar un sexto argumento `{ core: coreOf(sym), quarters: deps.statements ? ((await store.statements(sym))?.quarters.slice(-4) ?? []) : undefined }`.

6. `writeCardFor`: agregar el parámetro `extra: { core?: CoreEarnings | null; quarters?: QuarterStatement[] | undefined } = {}` y, en el objeto `input`, `...(extra.quarters !== undefined ? { quarters: extra.quarters } : {}), ...(extra.core !== undefined ? { core: extra.core } : {})`.

7. En `refreshRadar`, antes de la llamada a `decideCandidate`: `const core: CoreEarnings | null | undefined = deps.statements ? ((await store.statements(prev.symbol))?.core ?? null) : undefined;` y pasar `core` a `decideCandidate` y, en la llamada a `writeCardFor` de la ficha pendiente, `{ core, quarters: deps.statements ? ((await store.statements(prev.symbol))?.quarters.slice(-4) ?? []) : undefined }`.

- [ ] **Step 4: correr tests y tipos**

Run: `pnpm exec vitest run packages/core packages/reasoner packages/pipeline && pnpm typecheck`
Expected: PASS. Los tests previos de `rankRadar` no pasan `statements`, así que no cambian.

- [ ] **Step 5: commit**

```bash
git add packages/core/src/radar/candidate.ts packages/core/src/radar/candidate.test.ts packages/core/src/radar/types.ts packages/reasoner/src/card.ts packages/reasoner/test/card.test.ts packages/pipeline/src/radar.ts packages/pipeline/test/radar.test.ts
git commit -m "feat(radar): ranking en dos pasadas con la ganancia núcleo de la SEC; banderas resultado_extraordinario y sin_estados; estados en la ficha del modelo

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: prefiltro de titulares, analistas por regex y tipos de eventos (core puro)

**Files:**
- Modify: `packages/core/src/radar/types.ts` (tipos de eventos, analistas y clasificador; campos opcionales en `CandidateRow`)
- Create: `packages/core/src/radar/news.ts`
- Modify: `packages/core/src/radar/index.ts` (`export * from "./news.js";`)
- Test: `packages/core/src/radar/news.test.ts`

**Interfaces:**
- Produces (types.ts):

```ts
export type EventKind = "regulatorio" | "continuidad" | "contable" | "listado" | "guidance" | "dilucion" | "litigio" | "gestion" | "analista" | "otro";
export type EventSeverity = "grave" | "moderado" | "ruido";
/** Evento material guardado (spec verificación §5). */
export interface RadarEvent {
  symbol: string;
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
  url: string;
  source: string | null;
  why: string | null;
  detectedAt: string;
  promptVersion: string | null;
}
/** Lo que lleva la fila del candidato: solo lo necesario para salvedades y ficha. */
export interface CandidateEvent {
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
}
export interface AnalystAction {
  symbol: string;
  date: string;
  firm: string;
  action: "mantiene" | "sube" | "baja" | "inicia";
  rating: string | null;
  target: number | null;
  url: string;
}
export interface AnalystTargets {
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  latestDate: string | null;
}
/** Clasificador de titulares (modelo). Solo clasifica lo que el prefiltro marcó; nunca decide el veredicto. */
export interface EventClassifierInput {
  symbol: string;
  name: string | null;
  items: Array<{ date: string; source: string | null; headline: string; summary: string | null; url: string; kind: EventKind }>;
}
export interface ClassifiedEvent {
  date: string;
  kind: EventKind;
  severity: EventSeverity;
  headline: string;
  url: string;
  source: string | null;
  why: string;
}
export interface EventClassifier {
  readonly promptVersion: string;
  classify(input: EventClassifierInput): Promise<ClassifiedEvent[]>;
}
```

  y en `CandidateRow`, después de `measuredAt`: `events?: CandidateEvent[]; analystTargets?: AnalystTargets | null;` (opcionales: las filas viejas y las de Argentina no los llevan).

- Produces (news.ts): `EVENT_PATTERNS`, `materialHeadlines(items: NewsItem[]): Array<{ item: NewsItem; kind: EventKind }>`, `parseAnalystAction(item: NewsItem): AnalystAction | null`, `analystTargets(actions: AnalystAction[], today: string, days?: number): AnalystTargets | null`.

- [ ] **Step 1: test que falla**

```ts
// packages/core/src/radar/news.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { analystTargets, materialHeadlines, parseAnalystAction, type NewsItem } from "../index.js";

const news = JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[];
const item = (headline: string, date = "2026-08-01"): NewsItem => ({ symbol: "X", date, headline, source: "Benzinga", url: `https://x/${encodeURIComponent(headline)}`, summary: null });

describe("materialHeadlines (fixture ZVRA julio 2026)", () => {
  const m = materialHeadlines(news);
  it("marca el rechazo de la EMA como regulatorio (dos titulares del 24/7) y tres notas de analistas del 27/7", () => {
    expect(m.filter((x) => x.kind === "regulatorio").map((x) => x.item.date)).toEqual(["2026-07-24", "2026-07-24"]);
    expect(m.filter((x) => x.kind === "analista")).toHaveLength(3);
  });
  it("los resúmenes de mercado y la nota de resultados no pasan", () => {
    expect(m.some((x) => /Pre-Market Session|gapping|Q2 2026 Financial Results Call/.test(x.item.headline))).toBe(false);
  });
});

describe("materialHeadlines (patrones)", () => {
  const kind = (h: string) => materialHeadlines([item(h)])[0]?.kind ?? null;
  it("cubre los tipos del spec en inglés y español", () => {
    expect(kind("Company X receives Complete Response Letter from FDA")).toBe("regulatorio");
    expect(kind("Auditor raises substantial doubt about going concern")).toBe("continuidad");
    expect(kind("X to restate financial statements for 2025")).toBe("contable");
    expect(kind("X receives Nasdaq notice of non-compliance")).toBe("listado");
    expect(kind("X cuts full-year guidance on weak demand")).toBe("guidance");
    expect(kind("X prices $50 million public offering of common stock")).toBe("dilucion");
    expect(kind("Levi & Korsinsky notifies investors of class action against X")).toBe("litigio");
    expect(kind("X CEO steps down effective immediately")).toBe("gestion");
    expect(kind("X recorta la guía anual")).toBe("guidance");
    expect(kind("12 Health Care Stocks Moving In Friday's Session")).toBeNull();
  });
});

describe("parseAnalystAction", () => {
  it("Benzinga: mantiene con baja de objetivo", () => {
    const a = parseAnalystAction(item("BTIG Maintains Buy on Zevra Therapeutics, Lowers Price Target to $24", "2026-07-27"))!;
    expect(a).toMatchObject({ firm: "BTIG", action: "mantiene", rating: "Buy", target: 24, date: "2026-07-27" });
    expect(parseAnalystAction(item("Canaccord Genuity Maintains Buy on Zevra Therapeutics, Lowers Price Target to $20"))!.firm).toBe("Canaccord Genuity");
  });
  it("Benzinga: sube/baja de calificación e inicio de cobertura", () => {
    expect(parseAnalystAction(item("Piper Sandler Upgrades Zevra Therapeutics to Overweight, Raises Price Target to $30"))).toMatchObject({ firm: "Piper Sandler", action: "sube", rating: "Overweight", target: 30 });
    expect(parseAnalystAction(item("Goldman Sachs Downgrades Zevra Therapeutics to Neutral"))).toMatchObject({ action: "baja", rating: "Neutral", target: null });
    expect(parseAnalystAction(item("Leerink Partners Initiates Coverage On Zevra Therapeutics with Outperform Rating, Announces $28 Price Target"))).toMatchObject({ firm: "Leerink Partners", action: "inicia", rating: "Outperform", target: 28 });
  });
  it("TheFly: objetivo bajado/subido; formatos desconocidos → null", () => {
    expect(parseAnalystAction(item("Zevra Therapeutics price target lowered to $18 from $19 at Citizens JMP"))).toMatchObject({ firm: "Citizens JMP", action: "mantiene", rating: null, target: 18 });
    expect(parseAnalystAction(item("ZVRA Stock Sinks 23% On EU Setback — Analyst Says Risk Is 'A Headwind'"))).toBeNull();
  });
  it("con el fixture: tres acciones del 27/7 con objetivos 24, 24 y 20", () => {
    const acts = news.map(parseAnalystAction).filter((a) => a !== null);
    expect(acts.map((a) => [a!.firm, a!.target])).toEqual([["BTIG", 24], ["Guggenheim", 24], ["Canaccord Genuity", 20]]);
    expect(analystTargets(acts as never, "2026-09-09")).toEqual({ n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" });
    expect(analystTargets(acts as never, "2026-12-01")).toBeNull(); // más de 90 días
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/core/src/radar/news.test.ts`
Expected: FAIL, módulo `news.js` inexistente.

- [ ] **Step 3: implementación**

Agregar los tipos del bloque **Interfaces** a `packages/core/src/radar/types.ts` (y los dos campos opcionales en `CandidateRow`). Crear `packages/core/src/radar/news.ts`:

```ts
import type { AnalystAction, AnalystTargets, EventKind, NewsItem } from "./types.js";

/**
 * Noticias → posibles eventos materiales (spec verificación §5) y acciones de analistas (§6). Puro.
 * El prefiltro es deliberadamente amplio: el modelo separa grave / moderado / ruido; acá solo se evita mandarle todo.
 */
export const EVENT_PATTERNS: Array<{ kind: EventKind; re: RegExp }> = [
  { kind: "regulatorio", re: /negative opinion|\bCHMP\b|complete response letter|\bCRL\b|refus(?:e|es|ed|al) to (?:file|approve)|\breject(?:s|ed)?\b|declin(?:e|es|ed) to approve|clinical hold|withdr(?:aw|aws|ew|awn) (?:its |the )?(?:application|NDA|BLA|MAA)|FDA (?:rejects|declines)|opini[oó]n negativa|rechaz(?:a|o|ó)\b/i },
  { kind: "continuidad", re: /going concern|bankruptcy|chapter 11|\bdefault(?:s|ed)?\b|concurso de acreedores|quiebra/i },
  { kind: "contable", re: /\brestate(?:s|d|ment)?\b|material weakness|SEC (?:investigation|subpoena|probe)|accounting (?:irregularit|probe|investigation)|reexpres/i },
  { kind: "listado", re: /delist|non-?compliance notice|nasdaq (?:notice|deficiency)|minimum bid price/i },
  { kind: "guidance", re: /(?:cuts?|lowers?|slashes|trims|withdraws?|reduces?) (?:its |full[- ]year |fy ?\d* |annual )?(?:guidance|outlook|forecast)|guidance cut|recorta (?:la )?(?:gu[ií]a|previsiones)/i },
  { kind: "dilucion", re: /public offering|registered direct|at-the-market|convertible (?:senior )?notes|private placement|priced (?:its |an? )?(?:public |underwritten )?offering|shelf registration|ampliaci[oó]n de capital/i },
  { kind: "litigio", re: /class action|securities fraud|investigat(?:es|ion|ing) (?:claims|on behalf|potential)|shareholder alert|investor alert|lawsuit|demanda colectiva/i },
  { kind: "gestion", re: /\b(?:CEO|CFO|chief executive|chief financial)\b.*\b(?:resigns|steps down|departs|departure|to step down|exits)\b|auditor resign/i },
  { kind: "analista", re: /price target|\b(?:maintains|reiterates|downgrades?|upgrades?|initiates coverage)\b/i },
];

export function materialHeadlines(items: NewsItem[]): Array<{ item: NewsItem; kind: EventKind }> {
  const out: Array<{ item: NewsItem; kind: EventKind }> = [];
  for (const item of items) {
    const hit = EVENT_PATTERNS.find((p) => p.re.test(item.headline));
    if (hit) out.push({ item, kind: hit.kind });
  }
  return out;
}

const BENZINGA_MAINTAIN = /^(?<firm>.+?) (?<verb>Maintains|Reiterates) (?<rating>[A-Za-z][A-Za-z -]*?) on (?<company>.+?), (?:Lowers|Raises|Maintains|Announces|Sets|Adjusts) (?:\$[\d.]+ )?Price Target(?: to| of)? \$(?<target>[\d.]+)/i;
const BENZINGA_GRADE = /^(?<firm>.+?) (?<verb>Upgrades|Downgrades) (?<company>.+?) to (?<rating>[A-Za-z][A-Za-z -]*?)(?:, (?:Lowers|Raises|Maintains|Announces|Sets) (?:\$[\d.]+ )?Price Target(?: to| of)? \$(?<target>[\d.]+))?$/i;
const BENZINGA_INIT = /^(?<firm>.+?) Initiates Coverage On (?<company>.+?) with (?<rating>[A-Za-z][A-Za-z -]*?) Rating(?:, Announces \$(?<target>[\d.]+) Price Target)?/i;
const THEFLY = /price target (?<dir>lowered|raised) to \$?(?<target>[\d.]+) from \$?[\d.]+ at (?<firm>.+)$/i;
const num = (s: string | undefined): number | null => (s === undefined ? null : Number(s));

/** Reconoce los formatos de Benzinga y TheFly; cualquier otro → null (informativo, no decide). */
export function parseAnalystAction(item: NewsItem): AnalystAction | null {
  const h = item.headline.trim();
  const base = { symbol: item.symbol, date: item.date, url: item.url };
  let m = BENZINGA_MAINTAIN.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: "mantiene", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = BENZINGA_GRADE.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: /^Upgrades$/i.test(m.groups["verb"]!) ? "sube" : "baja", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = BENZINGA_INIT.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!, action: "inicia", rating: m.groups["rating"]!, target: num(m.groups["target"]) };
  m = THEFLY.exec(h);
  if (m?.groups) return { ...base, firm: m.groups["firm"]!.trim(), action: "mantiene", rating: null, target: num(m.groups["target"]) };
  return null;
}

const DAY = 86_400_000;
/** Resumen de objetivos de los últimos `days` días. null si no hay ninguno con objetivo. */
export function analystTargets(actions: AnalystAction[], today: string, days = 90): AnalystTargets | null {
  const since = new Date(Date.parse(today) - days * DAY).toISOString().slice(0, 10);
  const xs = actions.filter((a) => a.date >= since && a.target !== null).sort((a, b) => a.target! - b.target!);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  const median = xs.length % 2 ? xs[mid]!.target! : (xs[mid - 1]!.target! + xs[mid]!.target!) / 2;
  return { n: xs.length, median, min: xs[0]!.target!, max: xs[xs.length - 1]!.target!, latestDate: xs.map((a) => a.date).sort().at(-1) ?? null };
}
```

Agregar `export * from "./news.js";` en `packages/core/src/radar/index.ts`.

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/core/src/radar/news.test.ts && pnpm typecheck`
Expected: PASS. Si un patrón no matchea un titular del fixture, imprimir `news.map((n) => n.headline)` y ajustar el patrón, nunca el fixture.

- [ ] **Step 5: commit**

```bash
git add packages/core/src/radar/types.ts packages/core/src/radar/news.ts packages/core/src/radar/news.test.ts packages/core/src/radar/index.ts
git commit -m "feat(radar): prefiltro de titulares por tipo de evento, acciones de analistas por regex y tipos de eventos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: clasificador de titulares (reasoner, tool estricta)

**Files:**
- Create: `packages/reasoner/src/events.ts`
- Modify: `packages/reasoner/src/index.ts` (agregar `export * from "./events.js";`)
- Test: `packages/reasoner/test/events.test.ts`

**Interfaces:**
- Consumes: `GeminiToolCaller`, `ToolSpec`, `GeminiCallerOptions` (`./gemini/transport.js`); tipos `EventClassifier`, `EventClassifierInput`, `ClassifiedEvent` (Task 8).
- Produces: `EVENTS_SYSTEM`, `EVENTS_TOOL`, `EVENTS_VERSION`, `buildEventsMessage(input): string`, `parseMaterialEvents(args: unknown, input: EventClassifierInput): ClassifiedEvent[]`, `class GeminiEventClassifier implements EventClassifier`, `class AnthropicEventClassifier implements EventClassifier`.

- [ ] **Step 1: test que falla**

```ts
// packages/reasoner/test/events.test.ts
import { describe, expect, it } from "vitest";
import type { EventClassifierInput } from "@thesis/core";
import { EVENTS_SYSTEM, EVENTS_TOOL, GeminiEventClassifier, buildEventsMessage, parseMaterialEvents } from "../src/index.js";

const input: EventClassifierInput = {
  symbol: "ZVRA", name: "Zevra Therapeutics",
  items: [
    { date: "2026-07-24", source: "Benzinga", headline: "Zevra Therapeutics Receives Negative Opinion From EMA CHMP On Its Marketing Authorization Application For Arimoclomol", summary: null, url: "https://n/1", kind: "regulatorio" },
    { date: "2026-07-27", source: "PRNewswire", headline: "Levi & Korsinsky Notifies Investors of Pending Investigation Into Zevra Therapeutics (ZVRA)", summary: "law firm", url: "https://n/2", kind: "litigio" },
  ],
};
const good = { events: [
  { date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: input.items[0]!.headline, why: "El CHMP recomendó no autorizar arimoclomol en la UE." },
  { date: "2026-07-27", kind: "litigio", severity: "moderado", headline: input.items[1]!.headline, why: "Estudio de abogados tras la caída." },
] };

function fakeFetch(args: unknown) {
  const calls: any[] = [];
  const f = (async (_u: string, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "material_events", args } }] } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe("clasificador de titulares", () => {
  it("el mensaje lleva símbolo, nombre, fecha, fuente, tipo del prefiltro y titular de cada ítem", () => {
    const m = buildEventsMessage(input);
    for (const s of ["ZVRA", "Zevra Therapeutics", "2026-07-24", "Benzinga", "regulatorio", "EMA CHMP", "litigio", "law firm"]) expect(m).toContain(s);
  });
  it("parseMaterialEvents: toma fecha, url y fuente del ítem recibido y descarta titulares que no vinieron", () => {
    const out = parseMaterialEvents(good, input);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ date: "2026-07-24", url: "https://n/1", source: "Benzinga", severity: "grave", kind: "regulatorio" });
    const invented = { events: [{ ...good.events[0], headline: "Zevra approved everywhere" }] };
    expect(parseMaterialEvents(invented, input)).toEqual([]);
    expect(parseMaterialEvents({ events: [{ ...good.events[0], headline: good.events[0]!.headline.toLowerCase() }] }, input)).toHaveLength(1); // mayúsculas no importan
  });
  it("severidad o tipo inválidos → error; why obligatorio", () => {
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], severity: "catastrófico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], kind: "meteorológico" }] }, input)).toThrow();
    expect(() => parseMaterialEvents({ events: [{ ...good.events[0], why: "" }] }, input)).toThrow();
  });
  it("GeminiEventClassifier manda system y tool material_events forzada", async () => {
    const { f, calls } = fakeFetch(good);
    const out = await new GeminiEventClassifier({ keys: ["k"], fetch: f }).classify(input);
    expect(out.map((e) => e.severity)).toEqual(["grave", "moderado"]);
    expect(calls[0].systemInstruction.parts[0].text).toBe(EVENTS_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(EVENTS_TOOL.name);
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/reasoner/test/events.test.ts`
Expected: FAIL, exports inexistentes.

- [ ] **Step 3: implementación**

```ts
// packages/reasoner/src/events.ts
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ClassifiedEvent, EventClassifier, EventClassifierInput } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

/**
 * Clasificación de titulares (spec verificación §5). El prefiltro por reglas ya eligió qué mandar; el modelo
 * separa grave / moderado / ruido citando el titular. La regla severidad → veredicto vive en core (decideCandidate).
 */
const KINDS = ["regulatorio", "continuidad", "contable", "listado", "guidance", "dilucion", "litigio", "gestion", "analista", "otro"] as const;
const SEVERITIES = ["grave", "moderado", "ruido"] as const;

export const EVENTS_SYSTEM = `Sos analista de renta variable. Recibís UNA empresa y titulares recientes que un prefiltro por palabras clave marcó como posibles eventos materiales negativos. Clasificá cada titular relevante como un evento con severidad:
- grave: la propia empresa recibió un rechazo regulatorio, una complete response letter o un clinical hold sobre un producto principal; duda de continuidad (going concern, quiebra, default); reexpresión de estados, fraude o investigación de la SEC a la empresa; aviso de delisting.
- moderado: recorte de guidance; oferta de acciones o convertibles que diluye; demanda colectiva presentada o investigaciones de estudios de abogados tras una caída; salida del CEO o del CFO; rebaja de calificación de un analista.
- ruido: resúmenes de mercado con varias empresas, notas promocionales, menciones de terceros, noticias que no son sobre esta empresa o que no son negativas.
Reglas: usá solo lo recibido, nunca inferencias ni conocimiento externo; headline se copia idéntico al recibido; kind es el tipo del prefiltro salvo que sea claramente otro; why tiene como máximo 200 caracteres, en español, y cita el titular. Un mismo hecho en varios titulares: un evento por titular. Respondé únicamente llamando a la herramienta material_events.`;

export const EVENTS_TOOL: ToolSpec = {
  name: "material_events",
  description: "Eventos materiales negativos detectados en titulares de una empresa, con severidad y explicación breve.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["events"],
    properties: {
      events: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["date", "kind", "severity", "headline", "why"],
          properties: {
            date: { type: "string" },
            kind: { type: "string", enum: [...KINDS] },
            severity: { type: "string", enum: [...SEVERITIES] },
            headline: { type: "string" },
            why: { type: "string", maxLength: 200 },
          },
        },
      },
    },
  },
};
export const EVENTS_VERSION = `e1-${createHash("sha256").update(EVENTS_SYSTEM).update(JSON.stringify(EVENTS_TOOL)).digest("hex").slice(0, 12)}`;

const EventsSchema = z.object({
  events: z.array(z.object({ date: z.string(), kind: z.enum(KINDS), severity: z.enum(SEVERITIES), headline: z.string().min(1), why: z.string().min(1).max(200) }).strict()),
}).strict();

const norm = (s: string) => s.trim().toLowerCase();

/** Fail-closed: un evento cuyo titular no vino en la entrada se descarta; fecha, URL y fuente salen del ítem recibido, no del modelo. */
export function parseMaterialEvents(args: unknown, input: EventClassifierInput): ClassifiedEvent[] {
  const parsed = EventsSchema.parse(args);
  const out: ClassifiedEvent[] = [];
  for (const e of parsed.events) {
    const item = input.items.find((i) => norm(i.headline) === norm(e.headline));
    if (!item) continue;
    out.push({ date: item.date, kind: e.kind, severity: e.severity, headline: item.headline, url: item.url, source: item.source, why: e.why });
  }
  return out;
}

export function buildEventsMessage(i: EventClassifierInput): string {
  const items = i.items.map((x) => `- ${x.date} · ${x.source ?? "sin fuente"} · prefiltro: ${x.kind}\n  titular: ${x.headline}${x.summary ? `\n  resumen: ${x.summary.slice(0, 300)}` : ""}`);
  return [`# Empresa\n${i.symbol}${i.name ? ` — ${i.name}` : ""}`, `# Titulares (${i.items.length})\n${items.join("\n")}`, "Llamá a material_events."].join("\n\n");
}

export class GeminiEventClassifier implements EventClassifier {
  readonly promptVersion = `${EVENTS_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  constructor(opts: GeminiCallerOptions) {
    this.caller = new GeminiToolCaller({ maxOutputTokens: 3000, ...opts });
  }
  async classify(input: EventClassifierInput): Promise<ClassifiedEvent[]> {
    const { args } = await this.caller.call(EVENTS_SYSTEM, buildEventsMessage(input), EVENTS_TOOL);
    return parseMaterialEvents(args, input);
  }
}

export class AnthropicEventClassifier implements EventClassifier {
  readonly promptVersion = EVENTS_VERSION;
  private readonly client: Anthropic;
  private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) {
    this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {});
    this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5";
  }
  async classify(input: EventClassifierInput): Promise<ClassifiedEvent[]> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 1500,
      system: EVENTS_SYSTEM,
      tools: [{ name: EVENTS_TOOL.name, description: EVENTS_TOOL.description, input_schema: EVENTS_TOOL.inputSchema as never }],
      tool_choice: { type: "tool", name: EVENTS_TOOL.name },
      messages: [{ role: "user", content: buildEventsMessage(input) }],
    });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("events: sin tool_use");
    return parseMaterialEvents(call.input, input);
  }
}
```

Agregar `export * from "./events.js";` al final de `packages/reasoner/src/index.ts`.

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/reasoner && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add packages/reasoner/src/events.ts packages/reasoner/src/index.ts packages/reasoner/test/events.test.ts
git commit -m "feat(reasoner): clasificador de titulares material_events (grave / moderado / ruido) con validación fail-closed

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: persistencia de eventos, analistas y barridos de noticias

**Files:**
- Modify: `packages/db/src/schema.ts` (tablas `radar_events`, `analyst_actions`, `radar_news_scans`; columnas `events`, `analyst_targets` en `radar_candidates`)
- Modify: `packages/db/src/repo.ts` (métodos nuevos; `candidateToRow` / `rowToCandidate`)
- Modify: `packages/pipeline/src/store.ts` (`RadarStore` + `MemoryStore`)
- Modify: `packages/db/src/repo.integration.test.ts` (un `it` y limpieza en `afterAll`)
- Test: `packages/pipeline/test/radar.test.ts`

**Interfaces:**
- Produces (`RadarStore`):

```ts
  upsertEvents(events: RadarEvent[]): Promise<number>;
  eventsFor(symbol: string, since: string): Promise<RadarEvent[]>;
  upsertAnalystActions(actions: AnalystAction[]): Promise<number>;
  analystActions(symbol: string, since: string): Promise<AnalystAction[]>;
  newsScannedTo(symbol: string): Promise<string | null>;
  setNewsScannedTo(symbol: string, date: string): Promise<void>;
```

- `CandidateRow.events` y `analystTargets` persisten en `radar_candidates`.

- [ ] **Step 1: test que falla (MemoryStore)**

Agregar al final de `packages/pipeline/test/radar.test.ts`:

```ts
describe("MemoryStore: eventos, analistas y barridos", () => {
  it("dedupe por url, filtro por fecha, fecha del último barrido, y la fila del candidato conserva events/analystTargets", async () => {
    const store = new MemoryStore();
    const ev = { symbol: "zvra", date: "2026-07-24", kind: "regulatorio" as const, severity: "grave" as const, headline: "EMA", url: "https://n/1", source: "Benzinga", why: "x", detectedAt: "2026-09-09T00:00:00Z", promptVersion: "e1" };
    expect(await store.upsertEvents([ev, { ...ev, headline: "otra vez" }])).toBe(1);
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.headline)).toEqual(["EMA"]);
    expect(await store.eventsFor("ZVRA", "2026-08-01")).toEqual([]);
    const act = { symbol: "ZVRA", date: "2026-07-27", firm: "BTIG", action: "mantiene" as const, rating: "Buy", target: 24, url: "https://n/2" };
    expect(await store.upsertAnalystActions([act, act])).toBe(1);
    expect(await store.analystActions("zvra", "2026-06-11")).toEqual([act]);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    await store.setNewsScannedTo("zvra", "2026-09-09");
    expect(await store.newsScannedTo("ZVRA")).toBe("2026-09-09");
    const row = { candidateDate: "2026-09-09", symbol: "ZVRA", kind: "stock" as const, verdict: "OBSERVAR" as const, score: 1, axes: {}, peerGroup: [], rankInGroup: 1, groupSize: 5, close: 12.57, entryLow: null, entryHigh: null, stop: null, target: null, sizeUsd: null, sizeQty: null, riskScore: null, flags: ["evento_grave"], nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null, events: [{ date: "2026-07-24", kind: "regulatorio" as const, severity: "grave" as const, headline: "EMA" }], analystTargets: { n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" } };
    await store.upsertCandidates([row]);
    const back = (await store.latestCandidates())[0]!;
    expect(back.events).toEqual(row.events);
    expect(back.analystTargets?.median).toBe(24);
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/pipeline/test/radar.test.ts -t "eventos, analistas"`
Expected: FAIL, `upsertEvents is not a function`.

- [ ] **Step 3: implementación**

`packages/pipeline/src/store.ts`: agregar `AnalystAction, RadarEvent` al import de tipos; los seis métodos del bloque **Interfaces** en `RadarStore` (después de `saveStatements`), con el comentario `/** Eventos materiales y analistas desde noticias (spec verificación §5 y §6); `radar_news_scans` guarda hasta qué fecha se leyó cada símbolo. */`. En `MemoryStore`, campos `radarEvents = new Map<string, RadarEvent>(); analystActs = new Map<string, AnalystAction>(); newsScans = new Map<string, string>();` y métodos:

```ts
  async upsertEvents(events: RadarEvent[]) {
    let n = 0;
    for (const e of events) {
      const k = `${e.symbol.toUpperCase()}|${e.url}`;
      if (this.radarEvents.has(k)) continue;
      this.radarEvents.set(k, { ...e, symbol: e.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async eventsFor(symbol: string, since: string) {
    return [...this.radarEvents.values()].filter((e) => e.symbol === symbol.toUpperCase() && e.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  }
  async upsertAnalystActions(actions: AnalystAction[]) {
    let n = 0;
    for (const a of actions) {
      const k = `${a.symbol.toUpperCase()}|${a.url}`;
      if (this.analystActs.has(k)) continue;
      this.analystActs.set(k, { ...a, symbol: a.symbol.toUpperCase() });
      n++;
    }
    return n;
  }
  async analystActions(symbol: string, since: string) {
    return [...this.analystActs.values()].filter((a) => a.symbol === symbol.toUpperCase() && a.date >= since).sort((a, b) => b.date.localeCompare(a.date));
  }
  async newsScannedTo(symbol: string) {
    return this.newsScans.get(symbol.toUpperCase()) ?? null;
  }
  async setNewsScannedTo(symbol: string, date: string) {
    this.newsScans.set(symbol.toUpperCase(), date);
  }
```

(`upsertCandidates` de `MemoryStore` ya copia la fila entera, así que `events`/`analystTargets` viajan solos.)

`packages/db/src/schema.ts`: en `radarCandidates`, después de `spyClose`:

```ts
    events: jsonb("events").notNull().default([]),
    analystTargets: jsonb("analyst_targets"),
```

y tres tablas nuevas después de `contributionPlans`:

```ts
/** Eventos materiales detectados en noticias (spec verificación §5). Único por símbolo + URL; los `ruido` también se guardan. */
export const radarEvents = pgTable(
  "radar_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    kind: text("kind").notNull(),
    severity: text("severity").notNull(),
    headline: text("headline").notNull(),
    url: text("url").notNull(),
    source: text("source"),
    why: text("why"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    promptVersion: text("prompt_version"),
  },
  (t) => [uniqueIndex("radar_events_symbol_url").on(t.symbol, t.url), index("radar_events_symbol_date").on(t.symbol, t.date)],
);
/** Acciones de analistas extraídas de titulares (spec verificación §6). */
export const analystActions = pgTable(
  "analyst_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    date: date("date").notNull(),
    firm: text("firm").notNull(),
    action: text("action").notNull(),
    rating: text("rating"),
    target: numeric("target", { precision: 14, scale: 2 }),
    url: text("url").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("analyst_actions_symbol_url").on(t.symbol, t.url), index("analyst_actions_symbol_date").on(t.symbol, t.date)],
);
/** Hasta qué fecha se leyeron las noticias de cada símbolo. */
export const radarNewsScans = pgTable("radar_news_scans", {
  symbol: text("symbol").primaryKey(),
  scannedTo: date("scanned_to").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
```

`packages/db/src/repo.ts`: agregar `AnalystAction, RadarEvent` al import de tipos y `gte` al import de `drizzle-orm`. En `candidateToRow` agregar `events: c.events ?? [], analystTargets: c.analystTargets ?? null,`; en `rowToCandidate` agregar `events: (r.events as CandidateRow["events"]) ?? [], analystTargets: (r.analystTargets as CandidateRow["analystTargets"]) ?? null,`. Métodos nuevos después de `saveStatements`:

```ts
  async upsertEvents(events: RadarEvent[]): Promise<number> {
    let n = 0;
    for (const e of events) {
      const rows = await this.db.insert(s.radarEvents).values({ symbol: e.symbol.toUpperCase(), date: e.date, kind: e.kind, severity: e.severity, headline: e.headline, url: e.url, source: e.source, why: e.why, detectedAt: new Date(e.detectedAt), promptVersion: e.promptVersion }).onConflictDoNothing().returning({ id: s.radarEvents.id });
      n += rows.length;
    }
    return n;
  }
  async eventsFor(symbol: string, since: string): Promise<RadarEvent[]> {
    const rows = await this.db.select().from(s.radarEvents).where(and(eq(s.radarEvents.symbol, symbol.toUpperCase()), gte(s.radarEvents.date, since))).orderBy(desc(s.radarEvents.date));
    return rows.map((r) => ({ symbol: r.symbol, date: r.date, kind: r.kind as RadarEvent["kind"], severity: r.severity as RadarEvent["severity"], headline: r.headline, url: r.url, source: r.source, why: r.why, detectedAt: r.detectedAt.toISOString(), promptVersion: r.promptVersion }));
  }
  async upsertAnalystActions(actions: AnalystAction[]): Promise<number> {
    let n = 0;
    for (const a of actions) {
      const rows = await this.db.insert(s.analystActions).values({ symbol: a.symbol.toUpperCase(), date: a.date, firm: a.firm, action: a.action, rating: a.rating, target: a.target === null ? null : str(a.target), url: a.url }).onConflictDoNothing().returning({ id: s.analystActions.id });
      n += rows.length;
    }
    return n;
  }
  async analystActions(symbol: string, since: string): Promise<AnalystAction[]> {
    const rows = await this.db.select().from(s.analystActions).where(and(eq(s.analystActions.symbol, symbol.toUpperCase()), gte(s.analystActions.date, since))).orderBy(desc(s.analystActions.date));
    return rows.map((r) => ({ symbol: r.symbol, date: r.date, firm: r.firm, action: r.action as AnalystAction["action"], rating: r.rating, target: r.target === null ? null : num(r.target), url: r.url }));
  }
  async newsScannedTo(symbol: string): Promise<string | null> {
    return (await this.db.select().from(s.radarNewsScans).where(eq(s.radarNewsScans.symbol, symbol.toUpperCase())))[0]?.scannedTo ?? null;
  }
  async setNewsScannedTo(symbol: string, date: string): Promise<void> {
    const v = { symbol: symbol.toUpperCase(), scannedTo: date, updatedAt: new Date() };
    await this.db.insert(s.radarNewsScans).values(v).onConflictDoUpdate({ target: s.radarNewsScans.symbol, set: v });
  }
```

Migración: `pnpm db:generate && pnpm db:migrate` (nuevo `0010_*.sql`; revisar que sea aditivo).

Test de integración: en `repo.integration.test.ts`, dentro del `d(...)`, y en `afterAll` agregar `await db.delete(schema.radarEvents).where(eq(schema.radarEvents.symbol, rsym)); await db.delete(schema.analystActions).where(eq(schema.analystActions.symbol, rsym)); await db.delete(schema.radarNewsScans).where(eq(schema.radarNewsScans.symbol, rsym));`:

```ts
  it("eventos y analistas: dedupe por url y filtro por fecha; barrido de noticias", async () => {
    const rsym = `R${ticker}`;
    const ev = { symbol: rsym, date: "2026-07-24", kind: "regulatorio" as const, severity: "grave" as const, headline: "EMA", url: `https://t/${rsym}/1`, source: null, why: null, detectedAt: new Date().toISOString(), promptVersion: null };
    expect(await repo.upsertEvents([ev, ev])).toBe(1);
    expect(await repo.eventsFor(rsym, "2026-07-01")).toHaveLength(1);
    expect(await repo.eventsFor(rsym, "2026-08-01")).toHaveLength(0);
    expect(await repo.upsertAnalystActions([{ symbol: rsym, date: "2026-07-27", firm: "BTIG", action: "mantiene", rating: "Buy", target: 24, url: `https://t/${rsym}/2` }])).toBe(1);
    expect((await repo.analystActions(rsym, "2026-07-01"))[0]?.target).toBe(24);
    await repo.setNewsScannedTo(rsym, "2026-09-09");
    expect(await repo.newsScannedTo(rsym)).toBe("2026-09-09");
  });
```

- [ ] **Step 4: correr tests y tipos**

Run: `pnpm exec vitest run packages/pipeline/test/radar.test.ts packages/db && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: commit**

```bash
git add packages/db/src/schema.ts packages/db/src/repo.ts packages/db/drizzle packages/pipeline/src/store.ts packages/pipeline/test/radar.test.ts packages/db/src/repo.integration.test.ts
git commit -m "feat(db): radar_events, analyst_actions, radar_news_scans y eventos en radar_candidates

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: reglas de veredicto por eventos y salvedades de convicción (core puro)

**Files:**
- Modify: `packages/core/src/radar/candidate.ts` (`buildFlags`, `decideCandidate`)
- Modify: `packages/core/src/radar/conviction.ts` (`NEGATIVE`, salvedades nuevas)
- Test: `packages/core/src/radar/candidate.test.ts`, `packages/core/src/radar/conviction.test.ts`

**Interfaces:**
- Consumes: `CandidateEvent` (Task 8), `decideCandidate` con `core` (Task 7).
- Produces: `decideCandidate(i: { …; core?; events?: CandidateEvent[]; eventsUnclassified?: boolean }, p)`: grave en ≤ 90 días → OBSERVAR con motivo y bandera `evento_grave`; moderado → bandera `evento_moderado`; `eventsUnclassified` → bandera `eventos_sin_clasificar`. `buildFlags(f, gate, nth, chronic, extra?: { core?; events?; eventsUnclassified?; today?: string })`.
- Convicción: `evento_moderado` −0,3 con texto "evento moderado <fecha>: <titular>"; `eventos_sin_clasificar` −0,3; `resultado_extraordinario` y `sin_estados` salvedad sin penalización.

- [ ] **Step 1: tests que fallan**

`packages/core/src/radar/candidate.test.ts`, agregar:

```ts
describe("decideCandidate con eventos", () => {
  const base = { f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today };
  const policy = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  const ev = (date: string, severity: "grave" | "moderado" | "ruido") => ({ date, kind: "regulatorio" as const, severity, headline: `evento ${severity}` });
  it("grave en 90 días → OBSERVAR con motivo evento_grave", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-04-01", "grave")] }, policy);
    expect(d).toMatchObject({ verdict: "OBSERVAR", reasons: ["evento_grave"] });
    if (!("excluded" in d)) expect(d.flags).toContain("evento_grave");
  });
  it("grave de hace 91 días ya no cuenta", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-02-17", "grave")] }, policy); // today 2026-05-19
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).not.toContain("evento_grave");
  });
  it("moderado → sigue COMPRAR con bandera; ruido no deja bandera", () => {
    const d = decideCandidate({ ...base, events: [ev("2026-05-01", "moderado"), ev("2026-05-02", "ruido")] }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) {
      expect(d.flags).toContain("evento_moderado");
      expect(d.flags).not.toContain("evento_grave");
    }
  });
  it("sin clasificar → bandera eventos_sin_clasificar, sigue COMPRAR", () => {
    const d = decideCandidate({ ...base, eventsUnclassified: true }, policy);
    expect(d).toMatchObject({ verdict: "COMPRAR" });
    if (!("excluded" in d)) expect(d.flags).toContain("eventos_sin_clasificar");
  });
});
```

`packages/core/src/radar/conviction.test.ts`: mirar cómo el archivo arma una fila (`row(...)` o similar) y agregar, con la misma fábrica:

```ts
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
```

- [ ] **Step 2: correr y ver que fallan**

Run: `pnpm exec vitest run packages/core/src/radar/candidate.test.ts packages/core/src/radar/conviction.test.ts`
Expected: FAIL.

- [ ] **Step 3: implementación**

`packages/core/src/radar/candidate.ts`: importar `CandidateEvent` desde `./types.js`. Constante `const EVENT_WINDOW_DAYS = 90;`. `buildFlags`:

```ts
export function buildFlags(f: Fundamentals, gate: TechnicalGate, nthAppearance: number, chronicWeeks: number, extra: { core?: CoreEarnings | null; events?: CandidateEvent[]; eventsUnclassified?: boolean; today?: string } = {}): string[] {
  const flags: string[] = [];
  // ... (cuerpo actual)
  if (extra.core === null) flags.push("sin_estados");
  if (hasExtraordinary(extra.core)) flags.push("resultado_extraordinario");
  const since = extra.today ? Date.parse(extra.today) - EVENT_WINDOW_DAYS * DAY : Number.NEGATIVE_INFINITY;
  const recent = (extra.events ?? []).filter((e) => Date.parse(e.date) >= since);
  if (recent.some((e) => e.severity === "grave")) flags.push("evento_grave");
  else if (recent.some((e) => e.severity === "moderado")) flags.push("evento_moderado");
  if (extra.eventsUnclassified) flags.push("eventos_sin_clasificar");
  return flags;
}
```

`decideCandidate`: el tipo de `i` suma `events?: CandidateEvent[]; eventsUnclassified?: boolean`; la llamada pasa `{ core: i.core, events: i.events, eventsUnclassified: i.eventsUnclassified, today: i.today }`, y `reasons` se arma así:

```ts
  const reasons = [...gate.reasons, ...(flags.includes("residente_cronico") ? ["residente_cronico"] : []), ...(flags.includes("evento_grave") ? ["evento_grave"] : [])];
```

`packages/core/src/radar/conviction.ts`: en `NEGATIVE` agregar `evento_moderado: { text: "evento moderado reciente", penalty: 0.3 }` y `eventos_sin_clasificar: { text: "hay titulares materiales sin clasificar (cuota del modelo): revisá la ficha", penalty: 0.3 }`; nuevo mapa `const INFO: Record<string, string> = { resultado_extraordinario: "la ganancia reportada está inflada por extraordinarios: el ranking usa la ganancia núcleo", sin_estados: "sin estados de la SEC: las métricas son de Finnhub y pueden incluir extraordinarios" };`. En el bucle `for (const f of row.flags)`:

```ts
    } else if (NEGATIVE[f]) {
      conviction -= NEGATIVE[f].penalty;
      const ev = f === "evento_moderado" ? [...(row.events ?? [])].filter((e) => e.severity === "moderado").sort((a, b) => b.date.localeCompare(a.date))[0] : undefined;
      cautions.push(ev ? `evento moderado ${ev.date}: ${ev.headline}` : NEGATIVE[f].text);
    } else if (INFO[f]) {
      cautions.push(INFO[f]);
    }
```

Actualizar el comentario de cabecera de `conviction.ts` con las dos penalizaciones nuevas y las dos salvedades informativas.

- [ ] **Step 4: correr y ver que pasa**

Run: `pnpm exec vitest run packages/core && pnpm typecheck`
Expected: PASS (incluido `plan.test.ts`, que no cambia).

- [ ] **Step 5: commit**

```bash
git add packages/core/src/radar/candidate.ts packages/core/src/radar/candidate.test.ts packages/core/src/radar/conviction.ts packages/core/src/radar/conviction.test.ts
git commit -m "feat(radar): evento grave en 90 días → OBSERVAR; moderado y sin clasificar penalizan convicción con el titular citado

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 12: barrido de noticias en el pipeline (rank y refresco) y eventos en la ficha

**Files:**
- Create: `packages/pipeline/src/radar-events.ts`
- Modify: `packages/pipeline/src/index.ts` (`export * from "./radar-events.js";`)
- Modify: `packages/pipeline/src/radar.ts` (`RadarDeps`, `rankRadar`, `refreshRadar`, `writeCardFor`)
- Modify: `packages/core/src/radar/types.ts` (`CardInput.events?`)
- Modify: `packages/reasoner/src/card.ts` (sección "Eventos materiales", `CARD_SYSTEM`)
- Test: `packages/pipeline/test/radar-events.test.ts`, `packages/pipeline/test/radar.test.ts`, `packages/reasoner/test/card.test.ts`

**Interfaces:**
- Consumes: `materialHeadlines`, `parseAnalystAction`, `analystTargets` (Task 8); `EventClassifier` (Task 9); store de Task 10; `decideCandidate` con eventos (Task 11).
- Produces:

```ts
export interface EventsDeps {
  store: RadarStore & Pick<TickerStore, "upsertNews">;
  news: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> };
  classifier: EventClassifier | null;
  log?: (msg: string, extra?: unknown) => void;
}
export interface EventScan { events: CandidateEvent[]; analystTargets: AnalystTargets | null; unclassified: boolean }
export const EVENT_WINDOW_DAYS = 90;
export function scanEventsFor(deps: EventsDeps, symbol: string, opts: { today: string; name: string | null; full?: boolean }): Promise<EventScan>;
```

  `RadarDeps` suma `news?: EventsDeps["news"] | null; eventClassifier?: EventClassifier | null;` y su `store` pasa a `CarteraStore & RadarStore & Pick<TickerStore, "upsertNews">`. `CardInput.events?: CandidateEvent[]`.

- [ ] **Step 1: tests que fallan**

```ts
// packages/pipeline/test/radar-events.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClassifiedEvent, EventClassifier, EventClassifierInput, NewsItem } from "@thesis/core";
import { MemoryStore, scanEventsFor } from "../src/index.js";

const fixture = (JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[]);
const T = "2026-09-09";
const graveIf = (re: RegExp): EventClassifier => ({
  promptVersion: "e-test",
  classify: async (i: EventClassifierInput): Promise<ClassifiedEvent[]> => i.items.map((x) => ({ date: x.date, kind: x.kind, severity: re.test(x.headline) ? "grave" : "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" })),
});
const failing: EventClassifier = { promptVersion: "e-test", classify: async () => { throw new Error("cuota"); } };

describe("scanEventsFor", () => {
  it("ventana completa: guarda noticias, analistas y eventos; devuelve el grave y los objetivos; avanza el barrido", async () => {
    const store = new MemoryStore();
    const calls: string[][] = [];
    const news = { companyNews: async (s: string, from: string, to: string) => { calls.push([s, from, to]); return fixture; } };
    const r = await scanEventsFor({ store, news, classifier: graveIf(/Negative Opinion From EMA CHMP/) }, "ZVRA", { today: T, name: "Zevra", full: true });
    expect(calls[0]).toEqual(["ZVRA", "2026-06-11", T]);
    expect(r.unclassified).toBe(false);
    expect(r.events).toEqual([{ date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: expect.stringContaining("Negative Opinion From EMA CHMP") }]);
    expect(r.analystTargets).toEqual({ n: 3, median: 24, min: 20, max: 24, latestDate: "2026-07-27" });
    expect((await store.news("ZVRA", 50)).length).toBe(16);
    expect((await store.eventsFor("ZVRA", "2026-06-11")).map((e) => e.severity).sort()).toEqual(["grave", "ruido"]); // el otro titular regulatorio quedó como ruido
    expect(await store.newsScannedTo("ZVRA")).toBe(T);
  });
  it("incremental: pide desde el último barrido y no reclasifica lo conocido", async () => {
    const store = new MemoryStore();
    const classified: number[] = [];
    const classifier: EventClassifier = { promptVersion: "e", classify: async (i) => { classified.push(i.items.length); return graveIf(/EMA CHMP/).classify(i); } };
    const news = { companyNews: async (_s: string, from: string) => fixture.filter((n) => n.date >= from) };
    await scanEventsFor({ store, news, classifier }, "ZVRA", { today: "2026-07-25", name: null, full: true });
    const r = await scanEventsFor({ store, news, classifier }, "ZVRA", { today: T, name: null });
    expect(classified).toEqual([2]); // la segunda vez no hay titulares nuevos para el modelo
    expect(r.events).toHaveLength(1);
  });
  it("clasificador caído → unclassified, sin avanzar el barrido; sin clasificador → igual", async () => {
    const store = new MemoryStore();
    const news = { companyNews: async () => fixture };
    const r = await scanEventsFor({ store, news, classifier: failing }, "ZVRA", { today: T, name: null, full: true });
    expect(r.unclassified).toBe(true);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
    expect((await scanEventsFor({ store, news, classifier: null }, "ZVRA", { today: T, name: null, full: true })).unclassified).toBe(true);
  });
  it("noticias caídas → no avanza el barrido pero devuelve lo guardado", async () => {
    const store = new MemoryStore();
    await store.upsertEvents([{ symbol: "ZVRA", date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: "EMA", url: "https://n/1", source: null, why: null, detectedAt: "2026-09-01T00:00:00Z", promptVersion: null }]);
    const r = await scanEventsFor({ store, news: { companyNews: async () => { throw new Error("finnhub"); } }, classifier: null }, "ZVRA", { today: T, name: null });
    expect(r.events).toHaveLength(1);
    expect(await store.newsScannedTo("ZVRA")).toBeNull();
  });
});
```

`packages/pipeline/test/radar.test.ts`, agregar (sumar `import { readFileSync } from "node:fs";` y `type ClassifiedEvent, type EventClassifier, type NewsItem` al import de `@thesis/core`; el `deps()` existente sigue igual):

```ts
describe("rankRadar y refreshRadar con noticias", () => {
  const T = "2026-09-09";
  const fixture = (JSON.parse(readFileSync("test/fixtures/zvra-news-2026-07.json", "utf8")) as NewsItem[]).map((n) => ({ ...n, symbol: "SA" }));
  const classifier: EventClassifier = { promptVersion: "e-test", classify: async (i): Promise<ClassifiedEvent[]> => i.items.map((x) => ({ date: x.date, kind: x.kind, severity: /Negative Opinion From EMA CHMP/.test(x.headline) ? "grave" : "ruido", headline: x.headline, url: x.url, source: x.source, why: "test" })) };
  it("SA con rechazo regulatorio → OBSERVAR por evento_grave, con eventos y objetivos en la fila y en la ficha; el refresco lo mantiene", async () => {
    const inputs: CardInput[] = [];
    const cardWriter: CardWriter = { promptVersion: "card-test", write: async (i) => { inputs.push(i); return { summary: "x", whyRanks: "y", mainRisk: "z", moat: "moderado", themes: [], degrade: false }; } };
    const news = { companyNews: async (s: string) => (s === "SA" ? fixture : []) };
    const { store, d } = deps({ news, eventClassifier: classifier, cardWriter });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    const r = await rankRadar(d, { today: T, portfolioUsd: 150_000 });
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("OBSERVAR");
    expect(sa.flags).toContain("evento_grave");
    expect(sa.events).toHaveLength(1);
    expect(sa.events![0]).toMatchObject({ date: "2026-07-24", severity: "grave" });
    expect(sa.analystTargets?.median).toBe(24);
    expect(inputs.find((i) => i.symbol === "SA")!.events).toHaveLength(1);
    const sb = r.candidates.find((c) => c.symbol === "SB")!;
    expect(sb.events).toEqual([]);
    expect(sb.flags).not.toContain("evento_grave");
    const rf = await refreshRadar(d, { today: "2026-09-10", portfolioUsd: 150_000 });
    expect(rf.errors).toEqual([]);
    const after = (await store.latestCandidates()).find((c) => c.symbol === "SA")!;
    expect(after.verdict).toBe("OBSERVAR");
    expect(after.events).toHaveLength(1);
  });
  it("clasificador caído → eventos_sin_clasificar y sigue COMPRAR", async () => {
    const failing: EventClassifier = { promptVersion: "e", classify: async () => { throw new Error("cuota"); } };
    const { d } = deps({ news: { companyNews: async (s: string) => (s === "SA" ? fixture : []) }, eventClassifier: failing });
    await scanUniverse(d, { scanDate: "2026-09-06", today: T });
    const sa = (await rankRadar(d, { today: T, portfolioUsd: 150_000 })).candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("COMPRAR");
    expect(sa.flags).toContain("eventos_sin_clasificar");
  });
});
```

`packages/reasoner/test/card.test.ts`, agregar dentro del `describe`:

```ts
  it("eventos materiales: los lista con severidad; sin eventos lo dice; sin campo no aparece", () => {
    const m = buildCardMessage({ ...input, events: [{ date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: "EMA CHMP negativa" }] });
    expect(m).toContain("# Eventos materiales (90 días)\n- 2026-07-24 [grave] regulatorio: EMA CHMP negativa");
    expect(buildCardMessage({ ...input, events: [] })).toContain("ninguno detectado");
    expect(buildCardMessage(input)).not.toContain("Eventos materiales");
    expect(CARD_SYSTEM).toContain("Eventos materiales");
  });
```

- [ ] **Step 2: correr y ver que fallan**

Run: `pnpm exec vitest run packages/pipeline packages/reasoner/test/card.test.ts`
Expected: FAIL (`scanEventsFor` inexistente, filas sin eventos, mensaje sin sección).

- [ ] **Step 3: implementación**

```ts
// packages/pipeline/src/radar-events.ts
import { analystTargets, materialHeadlines, parseAnalystAction, type AnalystAction, type AnalystTargets, type CandidateEvent, type EventClassifier, type NewsItem, type RadarEvent } from "@thesis/core";
import type { RadarStore, TickerStore } from "./store.js";

/**
 * Eventos materiales y analistas desde noticias (spec verificación §5 y §6).
 * Noticias de Finnhub → prefiltro por reglas → analistas por regex → clasificador (modelo, solo lo nuevo) → eventos guardados.
 * Lo que el modelo no devuelve se guarda como `ruido` para no volver a mandarlo cada día. Si el modelo o las noticias
 * fallan, el barrido no avanza y el candidato lleva la bandera `eventos_sin_clasificar` hasta el próximo intento.
 */
export interface EventsDeps {
  store: RadarStore & Pick<TickerStore, "upsertNews">;
  news: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> };
  classifier: EventClassifier | null;
  log?: (msg: string, extra?: unknown) => void;
}
export interface EventScan {
  events: CandidateEvent[];
  analystTargets: AnalystTargets | null;
  unclassified: boolean;
}
export const EVENT_WINDOW_DAYS = 90;
const MAX_ITEMS_PER_CALL = 30;
const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);

export async function scanEventsFor(deps: EventsDeps, symbol: string, opts: { today: string; name: string | null; full?: boolean }): Promise<EventScan> {
  const { store } = deps;
  const sym = symbol.toUpperCase();
  const since = addDays(opts.today, -EVENT_WINDOW_DAYS);
  const scannedTo = opts.full ? null : await store.newsScannedTo(sym);
  const from = scannedTo && scannedTo > since ? scannedTo : since;
  let fetched = true;
  let items: NewsItem[] = [];
  try {
    items = (await deps.news.companyNews(sym, from, opts.today)).map((n) => ({ ...n, symbol: sym }));
  } catch (e) {
    fetched = false;
    deps.log?.(`[radar] noticias de ${sym} fallaron`, { error: String(e).slice(0, 120) });
  }
  if (items.length) await store.upsertNews(items);
  const matched = materialHeadlines(items);
  const actions = matched.filter((m) => m.kind === "analista").map((m) => parseAnalystAction(m.item)).filter((a): a is AnalystAction => a !== null);
  if (actions.length) await store.upsertAnalystActions(actions);
  const known = new Set((await store.eventsFor(sym, since)).map((e) => e.url));
  const toClassify = matched.filter((m) => m.kind !== "analista" && !known.has(m.item.url)).slice(0, MAX_ITEMS_PER_CALL);
  let unclassified = false;
  if (toClassify.length) {
    if (!deps.classifier) unclassified = true;
    else {
      try {
        const classified = await deps.classifier.classify({ symbol: sym, name: opts.name, items: toClassify.map((m) => ({ date: m.item.date, source: m.item.source, headline: m.item.headline, summary: m.item.summary, url: m.item.url, kind: m.kind })) });
        const now = new Date().toISOString();
        const version = deps.classifier.promptVersion;
        const events: RadarEvent[] = classified.map((c) => ({ symbol: sym, date: c.date, kind: c.kind, severity: c.severity, headline: c.headline, url: c.url, source: c.source, why: c.why, detectedAt: now, promptVersion: version }));
        const returned = new Set(events.map((e) => e.url));
        for (const m of toClassify) if (!returned.has(m.item.url)) events.push({ symbol: sym, date: m.item.date, kind: m.kind, severity: "ruido", headline: m.item.headline, url: m.item.url, source: m.item.source, why: null, detectedAt: now, promptVersion: version });
        await store.upsertEvents(events);
      } catch (e) {
        unclassified = true;
        deps.log?.(`[radar] clasificador de titulares falló para ${sym}`, { error: String(e).slice(0, 120) });
      }
    }
  }
  if (fetched && !unclassified) await store.setNewsScannedTo(sym, opts.today);
  const events = (await store.eventsFor(sym, since)).filter((e) => e.severity !== "ruido").map((e) => ({ date: e.date, kind: e.kind, severity: e.severity, headline: e.headline }));
  return { events, analystTargets: analystTargets(await store.analystActions(sym, since), opts.today), unclassified };
}
```

Agregar `export * from "./radar-events.js";` a `packages/pipeline/src/index.ts`.

`packages/core/src/radar/types.ts`: en `CardInput`, después de `core?`: `/** Eventos materiales de 90 días (grave y moderado). undefined = no se buscaron. */ events?: CandidateEvent[];`.

`packages/reasoner/src/card.ts`: en `CARD_SYSTEM`, después del párrafo de estados: `Si recibís "Eventos materiales" con uno grave (rechazo regulatorio, continuidad, reexpresión, delisting), mainRisk tiene que mencionarlo con su fecha; no lo minimices.` En `buildCardMessage`, después de la sección de estados: `...(i.events !== undefined ? [eventsSection(i)] : [])` y:

```ts
function eventsSection(i: CardInput): string {
  if (!i.events?.length) return "# Eventos materiales (90 días)\n(ninguno detectado en noticias)";
  return `# Eventos materiales (90 días)\n${i.events.map((e) => `- ${e.date} [${e.severity}] ${e.kind}: ${e.headline}`).join("\n")}`;
}
```

`packages/pipeline/src/radar.ts`:

1. Imports: `type CandidateEvent, type EventClassifier` desde `@thesis/core`; `import { scanEventsFor, type EventScan } from "./radar-events.js";`; `TickerStore` al import de `./store.js`.
2. `RadarDeps`: `store: CarteraStore & RadarStore & Pick<TickerStore, "upsertNews">;` y dos campos nuevos:

```ts
  /** Noticias por símbolo (Finnhub) para eventos materiales y analistas (spec verificación §5, §6). Sin él no se buscan. */
  news?: { companyNews(symbol: string, from: string, to: string): Promise<NewsItem[]> } | null;
  /** Clasificador de titulares (modelo). null con noticias = todo lo material queda `eventos_sin_clasificar`. */
  eventClassifier?: EventClassifier | null;
```

3. Helper interno antes de `rankRadar`:

```ts
/** Barrido de noticias del símbolo (ventana completa en el ranking, incremental en el refresco). null si el Radar no tiene fuente de noticias. */
async function eventsFor(deps: RadarDeps, sym: string, today: string, full: boolean): Promise<EventScan | null> {
  if (!deps.news) return null;
  const profile = await deps.store.profile(sym);
  return scanEventsFor({ store: deps.store, news: deps.news, classifier: deps.eventClassifier ?? null, ...(deps.log ? { log: deps.log } : {}) }, sym, { today, name: profile?.profile.name ?? null, full });
}
```

4. `writeCardFor`: `extra` suma `events?: CandidateEvent[] | undefined` y el `input` agrega `...(extra.events !== undefined ? { events: extra.events } : {})`.
5. `rankRadar`, en el bucle de `kept`, antes de `decideCandidate`: `const ev = await eventsFor(deps, sym, opts.today, true);` y pasar `events: ev?.events, eventsUnclassified: ev?.unclassified` a `decideCandidate`; a `writeCardFor` el `extra` suma `events: ev?.events`; la fila suma `events: ev?.events ?? [], analystTargets: ev?.analystTargets ?? null`.
6. `refreshRadar`, para las filas `stock`, antes de `decideCandidate`: `const ev = await eventsFor(deps, prev.symbol, opts.today, false);`; pasar `events: ev?.events ?? prev.events, eventsUnclassified: ev?.unclassified` a `decideCandidate`; en las dos filas que se construyen (la de `excluded` y la normal) agregar `events: ev?.events ?? prev.events ?? [], analystTargets: ev?.analystTargets ?? prev.analystTargets ?? null`; en `writeCardFor` de la ficha pendiente, `events: ev?.events ?? prev.events`.

- [ ] **Step 4: correr tests y tipos**

Run: `pnpm exec vitest run packages/pipeline packages/reasoner packages/core && pnpm typecheck`
Expected: PASS. Si el test de `refreshRadar` falla porque la fila sale COMPRAR: revisar que `prev.events` llegue a `decideCandidate` cuando `eventsFor` devuelve null.

- [ ] **Step 5: commit**

```bash
git add packages/pipeline/src/radar-events.ts packages/pipeline/src/index.ts packages/pipeline/src/radar.ts packages/pipeline/test/radar-events.test.ts packages/pipeline/test/radar.test.ts packages/core/src/radar/types.ts packages/reasoner/src/card.ts packages/reasoner/test/card.test.ts
git commit -m "feat(radar): barrido de noticias por candidato (90 días en el ranking, incremental en el refresco): eventos materiales, analistas y ficha con eventos

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 13: wiring en el container, API y web

**Files:**
- Modify: `apps/api/src/container.ts` (`buildEventClassifier`, `radarDeps.statements/news/eventClassifier`)
- Modify: `apps/api/src/routes/radar.ts:82-94` (`GET /radar/candidates/:symbol`)
- Modify: `packages/pipeline/src/ticker.ts` (`TickerPage` + `statements`, `events`, `analystActions`)
- Create: `apps/web/src/flags.ts`, `apps/web/src/Verification.tsx`
- Modify: `apps/web/src/api.ts`, `apps/web/src/Ticker.tsx`, `apps/web/src/Radar.tsx`
- Test: `packages/pipeline/test/ticker.test.ts`

**Interfaces:**
- Consumes: `SecStatements` (Task 5), `GeminiEventClassifier`/`AnthropicEventClassifier` (Task 9), store (Tasks 6 y 10), `RadarDeps` (Task 12).
- Produces: `TickerPage.statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[]`; `GET /radar/candidates/:symbol` devuelve además `statements`, `events` (sin `ruido`), `analystActions`; `flagLabel(flag: string): string`; componente `<VerificationSections statements events analystActions close />`.

- [ ] **Step 1: test que falla (ficha por ticker)**

Agregar al final de `packages/pipeline/test/ticker.test.ts` (sumar `MemoryStore, buildTicker, type TickerDeps` al import de `../src/index.js` si faltan):

```ts
describe("buildTicker: verificación", () => {
  it("devuelve estados, eventos (sin ruido) y acciones de analistas guardados", async () => {
    const store = new MemoryStore();
    const d: TickerDeps = { store, history: { candles: async () => [] }, descriptions: { description: async () => null }, news: { companyNews: async () => [] }, quote: async () => null };
    await store.saveStatements({ symbol: "ZVRA", cik: "1434647", asOf: "2026-09-09", quarters: [], core: null });
    await store.upsertEvents([
      { symbol: "ZVRA", date: "2026-07-24", kind: "regulatorio", severity: "grave", headline: "EMA", url: "https://n/1", source: null, why: "x", detectedAt: "2026-09-09T00:00:00Z", promptVersion: null },
      { symbol: "ZVRA", date: "2026-07-24", kind: "otro", severity: "ruido", headline: "resumen", url: "https://n/2", source: null, why: null, detectedAt: "2026-09-09T00:00:00Z", promptVersion: null },
    ]);
    await store.upsertAnalystActions([{ symbol: "ZVRA", date: "2026-07-27", firm: "BTIG", action: "mantiene", rating: "Buy", target: 24, url: "https://n/3" }]);
    const page = await buildTicker(d, "zvra", { today: "2026-09-09", timeoutMs: 1000 });
    expect(page.statements?.cik).toBe("1434647");
    expect(page.events.map((e) => e.headline)).toEqual(["EMA"]);
    expect(page.analystActions[0]?.target).toBe(24);
  });
});
```

- [ ] **Step 2: correr y ver que falla**

Run: `pnpm exec vitest run packages/pipeline/test/ticker.test.ts`
Expected: FAIL (campos inexistentes).

- [ ] **Step 3: implementación**

`packages/pipeline/src/ticker.ts`: agregar `AnalystAction, RadarEvent, Statements` al import de tipos; en `TickerPage`, después de `peers`:

```ts
  /** Verificación (spec verificación): estados de la SEC, eventos materiales de 90 días sin ruido, acciones de analistas de 90 días. */
  statements: Statements | null;
  events: RadarEvent[];
  analystActions: AnalystAction[];
```

En `buildTicker`, junto a las otras lecturas del store (buscar donde se resuelve `candidate` con `store.latestCandidates()`), agregar:

```ts
  const since = addDays(opts.today, -90);
  const [statements, allEvents, analystActions] = await Promise.all([
    store.statements(symbol).catch(() => null),
    store.eventsFor(symbol, since).catch(() => []),
    store.analystActions(symbol, since).catch(() => []),
  ]);
  const events = allEvents.filter((e) => e.severity !== "ruido");
```

y sumar `statements, events, analystActions` al objeto que devuelve la función.

`apps/api/src/routes/radar.ts`, `GET /radar/candidates/:symbol`:

```ts
  app.get("/radar/candidates/:symbol", async (ctx) => {
    const symbol = ctx.req.param("symbol").toUpperCase();
    const cand = (await store.latestCandidates()).find((r) => r.symbol === symbol);
    if (!cand) return ctx.json({ error: "no es candidato vigente" }, 404);
    const since = new Date(Date.parse(today(ctx)) - 90 * 86_400_000).toISOString().slice(0, 10);
    const [fundamentals, tags, profile, statements, events, analystActions] = await Promise.all([store.fundamentals(symbol), store.tags(symbol), store.profile(symbol), store.statements(symbol), store.eventsFor(symbol, since), store.analystActions(symbol, since)]);
    const keys = AXES.flatMap((a) => AXIS_METRICS[a].map((m) => m.key));
    const peers: Array<{ symbol: string; metrics: Record<string, number | null> }> = [];
    for (const p of cand.peerGroup) {
      const f = await store.fundamentals(p);
      if (f) peers.push({ symbol: p, metrics: Object.fromEntries(keys.map((k) => [k, f.metrics[k] ?? null])) });
    }
    return ctx.json({ candidate: cand, fundamentals, tags: tags as Tags | null, profile: profile?.profile ?? null, peers, statements, events: events.filter((e) => e.severity !== "ruido"), analystActions });
  });
```

(`today(ctx)` es el helper que ya usa la ruta `/radar/watchlist/refresh` del mismo archivo.)

`apps/api/src/container.ts`:

1. Imports: `SecStatements` en el de `@thesis/adapters`; `AnthropicEventClassifier, GeminiEventClassifier` en el de `@thesis/reasoner`; `type EventClassifier` en el de `@thesis/core`.
2. Después de `buildCardWriter`:

```ts
/** Clasificador de titulares del Radar: misma regla de proveedor. Solo clasifica; el veredicto lo deciden las reglas. */
export function buildEventClassifier(r: ReasonerConfig): EventClassifier {
  if (r.kind === "gemini") {
    return new GeminiEventClassifier({ keys: r.geminiKeys, ...(r.geminiModels ? { models: r.geminiModels } : {}), log: (m) => console.log(m) });
  }
  return new AnthropicEventClassifier({ ...(r.anthropicApiKey ? { apiKey: r.anthropicApiKey } : {}), ...(r.anthropicModel ? { model: r.anthropicModel } : {}) });
}
```

3. Mover la línea `const finnhub = cfg.finnhubToken ? new FinnhubFundamentals(http, cfg.finnhubToken, new RateLimiter(55)) : null;` (hoy está debajo de `argentinaDeps`) arriba de `radarDeps`, y en `radarDeps` usar `fundamentals: finnhub ?? NO_FUNDAMENTALS,` más tres campos nuevos:

```ts
    // Verificación: estados de la SEC (mismo `http` con SEC_USER_AGENT), noticias de Finnhub y clasificador de titulares.
    statements: new SecStatements(http),
    news: finnhub ? { companyNews: (s, from, to) => finnhub.companyNews(s, from, to) } : null,
    eventClassifier: buildEventClassifier(cfg.reasoner),
```

`apps/web/src/api.ts`: tipos nuevos y campos:

```ts
export interface QuarterStatement { start: string; end: string; fp: string; revenue: number | null; operatingIncome: number | null; netIncome: number | null; pretaxIncome: number | null; taxExpense: number | null; operatingCashFlow: number | null; capex: number | null; dilutedShares: number | null; equity: number | null; extraordinary: Array<{ tag: string; value: number }> }
export interface CoreEarnings { asOf: string; revenueTTM: number | null; operatingIncomeTTM: number | null; coreOperatingIncomeTTM: number | null; netIncomeTTM: number | null; coreNetIncomeTTM: number | null; coreEpsTTM: number | null; operatingCashFlowTTM: number | null; freeCashFlowTTM: number | null; equity: number | null; taxRate: number; extraordinaryTTM: number; extraordinaryItems: Array<{ tag: string; quarterEnd: string; value: number }>; deviationPct: number | null }
export interface Statements { symbol: string; cik: string; asOf: string; quarters: QuarterStatement[]; core: CoreEarnings | null }
export interface RadarEvent { symbol: string; date: string; kind: string; severity: "grave" | "moderado" | "ruido"; headline: string; url: string; source: string | null; why: string | null }
export interface AnalystAction { symbol: string; date: string; firm: string; action: "mantiene" | "sube" | "baja" | "inicia"; rating: string | null; target: number | null; url: string }
export interface CandidateEvent { date: string; kind: string; severity: "grave" | "moderado" | "ruido"; headline: string }
export interface AnalystTargets { n: number; median: number | null; min: number | null; max: number | null; latestDate: string | null }
```

En `Candidate` agregar `events?: CandidateEvent[]; analystTargets?: AnalystTargets | null;`. En `CandidateDetail` y en `TickerPage` agregar `statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[];`. `fundamentals` en ambos suma `metricsRaw?: Record<string, number | null> | null; statementsAsOf?: string | null;`.

`apps/web/src/flags.ts`:

```ts
/** Etiquetas de las banderas del Radar. Lo que no está acá se muestra crudo. */
const FLAG_LABEL: Record<string, string> = {
  consenso_compra: "consenso de compra",
  consenso_venta: "consenso de venta",
  insiders_compran: "insiders compran",
  insiders_venden: "insiders venden",
  sorpresa_positiva: "sorpresa positiva",
  sorpresa_negativa: "sorpresa negativa",
  dividendo: "dividendo",
  no_perseguir: "no perseguir (+15% en 21 ruedas)",
  resultados_cerca: "resultados en ≤ 10 días",
  residente_cronico: "residente crónico",
  bajo_stop: "bajo el stop dinámico",
  bajo_sma200: "bajo la SMA200",
  resultado_extraordinario: "ganancia con extraordinarios (ranking con núcleo)",
  sin_estados: "sin estados de la SEC",
  evento_grave: "evento grave en 90 días",
  evento_moderado: "evento moderado en 90 días",
  eventos_sin_clasificar: "titulares sin clasificar",
};
export const flagLabel = (flag: string): string => FLAG_LABEL[flag] ?? flag;
```

`apps/web/src/Verification.tsx`:

```tsx
import type { AnalystAction, RadarEvent, Statements } from "./api";

const M = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${(v / 1e6).toFixed(1)}M`);
const f1 = (v: number | null | undefined) => (v === null || v === undefined ? "—" : v.toFixed(1));
const pctOf = (a: number | null | undefined, b: number | null | undefined) => (a === null || a === undefined || !b ? "—" : `${((a / b) * 100).toFixed(1)}%`);

/** Tres secciones de la verificación (spec verificación §9): estados con núcleo contra reportado, eventos materiales, analistas de 90 días. */
export function VerificationSections({ statements, events, analystActions, close, metricsRaw }: { statements: Statements | null; events: RadarEvent[]; analystActions: AnalystAction[]; close: number | null; metricsRaw?: Record<string, number | null> | null }) {
  const core = statements?.core ?? null;
  const last4 = statements?.quarters.slice(-4) ?? [];
  const corePe = core?.coreEpsTTM && core.coreEpsTTM > 0 && close ? (close / core.coreEpsTTM).toFixed(1) : "—";
  return (
    <>
      <div style={{ marginTop: 10 }}>
        <b>Estados (SEC)</b>
        {!statements || !last4.length ? (
          <div className="muted">sin estados: las métricas son de Finnhub y pueden incluir extraordinarios</div>
        ) : (
          <>
            <table style={{ marginTop: 4 }}>
              <thead><tr><th>trimestre</th><th>ingresos</th><th>operativo</th><th>neto</th><th>flujo operativo</th><th>extraordinarios</th></tr></thead>
              <tbody>
                {last4.map((q) => (
                  <tr key={q.end}><td className="mono">{q.end}</td><td className="mono">{M(q.revenue)}</td><td className="mono">{M(q.operatingIncome)}</td><td className="mono">{M(q.netIncome)}</td><td className="mono">{M(q.operatingCashFlow)}</td><td className="mono">{q.extraordinary.map((e) => `${e.tag} ${M(e.value)}`).join(", ") || "—"}</td></tr>
                ))}
              </tbody>
            </table>
            {core && (
              <div className="muted mono" style={{ marginTop: 4 }}>
                TTM: ingresos {M(core.revenueTTM)} · operativo núcleo {M(core.coreOperatingIncomeTTM)} ({pctOf(core.coreOperatingIncomeTTM, core.revenueTTM)}) · neto reportado {M(core.netIncomeTTM)} · neto núcleo {M(core.coreNetIncomeTTM)} · P/E núcleo {corePe}{metricsRaw?.["peTTM"] != null && ` (Finnhub ${f1(metricsRaw["peTTM"])})`} · flujo libre {M(core.freeCashFlowTTM)}
                {core.deviationPct !== null && Math.abs(core.deviationPct) > 0.25 && <span className="warn"> · desvío {(core.deviationPct * 100).toFixed(0)}% por extraordinarios</span>}
              </div>
            )}
          </>
        )}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Eventos materiales (90 días)</b>
        {events.length === 0 ? <div className="muted">ninguno detectado en noticias</div> : events.map((e) => (
          <div key={e.url}><span className={`flag ${e.severity === "grave" ? "bad" : "warn"}`}>{e.severity}</span> <span className="mono">{e.date}</span> · {e.kind} · <a href={e.url} target="_blank" rel="noreferrer">{e.headline}</a>{e.why && <span className="muted"> · {e.why}</span>}</div>
        ))}
      </div>
      <div style={{ marginTop: 10 }}>
        <b>Analistas (90 días)</b>
        {analystActions.length === 0 ? <div className="muted">sin acciones reconocidas en titulares</div> : analystActions.map((a) => (
          <div key={a.url} className="mono"><span>{a.date}</span> · {a.firm} · {a.action}{a.rating ? ` ${a.rating}` : ""}{a.target !== null ? ` · objetivo ${a.target}` : ""}{a.target !== null && close ? <span className={a.target > close ? "ok" : "bad"}> ({(((a.target - close) / close) * 100).toFixed(0)}%)</span> : null}</div>
        ))}
      </div>
    </>
  );
}
```

`apps/web/src/Ticker.tsx`: importar `flagLabel` y `VerificationSections`; en los tres lugares con `⚑ {f}` usar `⚑ {flagLabel(f)}`; dentro de la card `Radar` de `stock|etf`, después de la línea `ejes (z vs pares)…` y antes de la tabla de pares, agregar `<VerificationSections statements={t.statements} events={t.events} analystActions={t.analystActions} close={t.quote?.price ?? t.candidate.close} metricsRaw={t.fundamentals?.metricsRaw} />`.

`apps/web/src/Radar.tsx`: importar `flagLabel` y `VerificationSections`; reemplazar `⚑ {f}` por `⚑ {flagLabel(f)}` y `c.flags.join(" · ")` por `c.flags.map(flagLabel).join(" · ")` en las cuatro tablas; en el panel de detalle, dentro de `{detail && (<> … </>)}` después del bloque de `detail.fundamentals`, agregar `<VerificationSections statements={detail.statements} events={detail.events} analystActions={detail.analystActions} close={c.close} metricsRaw={detail.fundamentals?.metricsRaw} />`.

- [ ] **Step 4: correr tests, tipos y build de la web**

Run: `pnpm exec vitest run packages/pipeline/test/ticker.test.ts && pnpm typecheck && pnpm --filter @thesis/web build`
Expected: PASS y build sin errores. Si `pnpm --filter @thesis/web build` no existe, usar `pnpm --filter @thesis/web exec tsc --noEmit`.

- [ ] **Step 5: commit**

```bash
git add apps/api/src/container.ts apps/api/src/routes/radar.ts packages/pipeline/src/ticker.ts packages/pipeline/test/ticker.test.ts apps/web/src/api.ts apps/web/src/flags.ts apps/web/src/Verification.tsx apps/web/src/Ticker.tsx apps/web/src/Radar.tsx
git commit -m "feat(radar): estados, eventos materiales y analistas en la API y en la ficha; etiquetas de banderas

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 14: verificación de punta a punta con ZVRA, migración, corrida real y documentación

**Files:**
- Modify: `README.md` (sección Radar: verificación)
- Modify: `docs/superpowers/specs/2026-09-09-radar-verificacion-design.md` solo si algo quedó distinto (anotar la diferencia, no reescribir)

- [ ] **Step 1: suite completa y tipos en la rama**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: todo PASS. Si `plan.test.ts` (regla de exclusiones explicadas) falla, no tocar el plan: el fallo es una regresión de esta rama.

- [ ] **Step 2: rebase sobre master**

```bash
git fetch . master 2>/dev/null; git rebase master
```

Conflictos esperados en `packages/pipeline/src/radar.ts` y `packages/core/src/radar/conviction.ts` con el trabajo de solapamiento de ETFs de la otra sesión: conservar ambos lados (los cambios son aditivos: la otra rama agrega `overlap`; esta agrega `events`/`core`). Después: `pnpm test && pnpm typecheck` de nuevo. Si `master` todavía tiene cambios sin commitear de la otra sesión, no mergear: dejar la rama lista y avisar al dueño.

- [ ] **Step 3: migrar la base y relanzar la API**

```bash
pnpm db:up && pnpm db:migrate
launchctl kickstart -k gui/$(id -u)/com.thesis-engine.api
sleep 5 && curl -s http://localhost:3002/health
```

Expected: `{"ok":true,...}`. (Si la API corre desde el worktree de master, el merge debe estar hecho antes de este paso.)

- [ ] **Step 4: corrida real y criterio de aceptación con ZVRA**

```bash
curl -s -X POST http://localhost:3002/radar/rank | head -c 300
curl -s http://localhost:3002/radar/candidates/ZVRA | python3 -c "
import json,sys; d=json.load(sys.stdin); c=d['candidate']; f=d['fundamentals']; st=d['statements']
print('verdict', c['verdict'], '| flags', c['flags'])
print('P/E núcleo', f['metrics'].get('peTTM'), '| Finnhub', (f.get('metricsRaw') or {}).get('peTTM'), '| margen op.', f['metrics'].get('operatingMarginTTM'))
print('desvío', st and st['core'] and st['core']['deviationPct'], '| ítems', st and st['core'] and st['core']['extraordinaryItems'])
print('eventos', [(e['date'], e['severity'], e['headline'][:60]) for e in d['events']])
print('analistas', [(a['date'], a['firm'], a['target']) for a in d['analystActions']])
print('close', c['close'], '| events en fila', c.get('events'))"
curl -s http://localhost:3002/radar/top | python3 -c "import json,sys; d=json.load(sys.stdin); print('ZVRA en top:', any(p['symbol']=='ZVRA' for p in d['picks']))"
curl -s "http://localhost:3002/radar/plan?amount=6500" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ZVRA en plan:', any(l['symbol']=='ZVRA' for l in d['lines']))"
```

Expected (spec §12): `verdict OBSERVAR`; `flags` incluye `evento_grave` y `resultado_extraordinario`; P/E núcleo entre 22 y 25 y Finnhub 12,8; margen operativo 28–30; desvío 0,38–0,48 con `GainLossOnDispositionOfAssets1`; un evento grave del 2026-07-24 con el titular del rechazo de la EMA; tres acciones del 2026-07-27 (BTIG 24, Guggenheim 24, Canaccord Genuity 20); `close` igual al último cierre completo (no una vela parcial si se corre en horario de mercado); ZVRA fuera del top y del plan. Si el clasificador no tiene cuota en ese momento, el flag será `eventos_sin_clasificar` y el verdict COMPRAR: reintentar con `POST /radar/refresh` más tarde; eso es el comportamiento diseñado, no un error.

- [ ] **Step 5: README y commit final**

En `README.md`, en la sección del Radar, agregar un párrafo "Verificación de candidatos": ganancia núcleo desde la SEC (P/E, ROE y márgenes recalculados; bandera `resultado_extraordinario`), eventos materiales desde noticias (grave → OBSERVAR 90 días; moderado → salvedad), analistas desde titulares, velas solo de sesiones cerradas; comandos `pnpm radar:rank` / `radar:refresh`; y el enlace al spec.

```bash
git add README.md
git commit -m "docs(radar): verificación de candidatos (estados de la SEC, eventos materiales, analistas, sesiones cerradas)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Luego `superpowers:finishing-a-development-branch` para integrar la rama.

---

## Self-review (hecho al escribir el plan)

**Cobertura del spec:** §3 fuentes → Tasks 5, 12, 13 · §4 ganancia núcleo (adapter, trimestres, fórmula, bandera, recálculo, dos pasadas) → Tasks 3, 4, 5, 6, 7 · §5 eventos (cadencia, prefiltro, clasificación, persistencia, reglas, convicción, ficha) → Tasks 8, 9, 10, 11, 12 · §6 analistas → Tasks 8, 10, 12, 13 · §7 sesiones → Tasks 1, 2 · §8 datos → Tasks 6, 10 · §9 API y UI → Task 13 · §10 tests → cada task · §12 aceptación → Task 14.

**Consistencia de nombres:** `decideCandidate({ core?, events?, eventsUnclassified? })` (Tasks 7 y 11); `buildFlags(..., extra)` (7 y 11); `writeCardFor(..., extra: { core?, quarters?, events? })` (7 y 12); `RadarDeps.statements?/news?/eventClassifier?` (7 y 12); store: `statements/saveStatements` (6), `upsertEvents/eventsFor/upsertAnalystActions/analystActions/newsScannedTo/setNewsScannedTo` (10, 12, 13); `CandidateRow.events?/analystTargets?` (8, 10, 12, 13); `CardInput.quarters?/core?/events?` (7, 12); `scanEventsFor(deps, symbol, { today, name, full? })` (12); `CompletedSessionsHistory(inner, now?)` (2).

**Notas:** los campos nuevos de `CandidateRow`, `CardInput`, `Fundamentals` y `RadarDeps` son opcionales a propósito, para que Argentina, seguimiento y los tests existentes no cambien. El decorador de sesiones también afecta a Cartera y Argentina (es lo que pide el spec §7).
