# Cartera etapa 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Veredicto diario (VENDER / REVISAR / MANTENER / SUMAR) por posición real, panel de riesgo calculado, narrativa del modelo que solo degrada, y medición contra SPY a 7 y 30 días, todo en thesis-engine.

**Architecture:** Reglas puras en `packages/core/src/cartera` (stop chandelier, jerarquía de verbos, SUMAR, riesgo, medición) sin I/O. Adaptadores de precios (Yahoo con respaldo Alpaca) y perfil (Finnhub) en `packages/adapters`. Orquestación en `packages/pipeline/src/cartera.ts` contra un `CarteraStore` (Repo de Postgres o `MemoryStore`). Narrador Gemini/Anthropic en `packages/reasoner` con function call estricto. Rutas `/cartera/*` en `apps/api`, pestaña *Cartera* en `apps/web`, cron 07:45, CLI `import:v1`.

**Tech Stack:** TypeScript ESM, Node 22+ (`node:sqlite` para importar), Drizzle + Postgres, Hono, React + Vite, vitest, Zod. Sin dependencias nuevas.

**Spec:** `docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md`

## Global Constraints

- Node ≥ 22; pnpm workspace; imports ESM con extensión `.js`; comentarios en español.
- TDD: test rojo antes de cada implementación. Tests canónicos: `DATABASE_URL=postgres://thesis:thesis@localhost:5433/thesis pnpm test`.
- Reglas duras en código: el modelo **solo degrada** MANTENER/SUMAR → REVISAR. Nunca sube un verbo.
- Fail-closed: sin vela de hoy (última vela > 4 días calendario) → REVISAR con aviso.
- Stop chandelier: período 22, multiplicador 3. Objetivo: `close + 2 × (close − stop)`.
- SUMAR: peso < 80% del peso igualitario **y** cierre > stop **y** retorno 21 velas ≤ +15%.
- Riesgo: correlación sobre 126 velas (pares > 0.7 listados), beta sobre 63 velas, estrés = Σ peso × beta × (−20%), liquidez al 10% del volumen diario medio de 30 días, aviso de concentración > 40%.
- Medición: `alpha = (close_h / close − 1) − (spy_h / spy − 1)` a 7 y 30 días. VENDER acierta si alpha < 0; MANTENER/SUMAR si alpha > 0; REVISAR no se puntúa.
- Rutas nuevas bajo `/cartera`; `/portfolio` (paper de tesis) no cambia.
- Commit por task, mensaje en español, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File Structure

- `packages/core/src/cartera/types.ts` — tipos: `Candle`, `Position`, `Verb`, `PositionVerdict`, `RiskReport`, puertos `PriceHistory` y `PositionNarrator`.
- `packages/core/src/cartera/stop.ts` — `computeTrailingStop`, `computeTarget`, `atr`.
- `packages/core/src/cartera/verdict.ts` — `decideVerb`, `applyDegrade`, `sumarCriteria`, `isStale`.
- `packages/core/src/cartera/risk.ts` — `buildRiskReport` y helpers (`weights`, `hhi`, `correlation`, `beta`).
- `packages/core/src/cartera/measure.ts` — `alphaPct`, `verdictHit`, `summarizeMeasurement`.
- `packages/core/src/cartera/index.ts` — re-exports; `packages/core/src/index.ts` los exporta.
- `packages/adapters/src/yahoo/index.ts` — `YahooPriceHistory` (chart API v8) con parser puro.
- `packages/adapters/src/alpaca/history.ts` — `AlpacaPriceHistory` (barras diarias IEX).
- `packages/adapters/src/finnhub/index.ts` — `FinnhubProfiles` (`profile2`).
- `packages/adapters/src/history.ts` — `FallbackPriceHistory` (Yahoo, si falla Alpaca).
- `packages/db/src/schema.ts` — tablas `positions`, `transactions`, `symbol_meta`, `portfolio_verdicts`, `portfolio_risk`; migración `packages/db/drizzle/0001_*.sql`.
- `packages/db/src/repo.ts` — métodos de `CarteraStore`.
- `packages/pipeline/src/store.ts` — interfaz `CarteraStore` + `MemoryStore`.
- `packages/pipeline/src/cartera.ts` — `runCartera`, `measureVerdicts`, `buildNarratorInput`.
- `packages/reasoner/src/gemini/transport.ts` — `GeminiToolCaller` (extraído de `GeminiReasoner`).
- `packages/reasoner/src/narrator.ts` — `NOTE_TOOL`, prompt, `GeminiNarrator`, `AnthropicNarrator`, `parseNote`.
- `apps/api/src/config.ts` — `finnhubToken`, `carteraCron`; `apps/api/src/container.ts` — `history`, `profiles`, `narrator`, `carteraDeps`.
- `apps/api/src/routes/cartera.ts` — rutas; montadas desde `routes/index.ts`.
- `apps/api/src/import-v1.ts` — CLI; `apps/api/src/import-v1.test.ts`.
- `apps/api/src/index.ts` — cron 07:45.
- `apps/web/src/api.ts`, `apps/web/src/Cartera.tsx`, `apps/web/src/App.tsx` — pestaña.

---

### Task 1: Tipos, puertos y stop chandelier (core)

**Files:**
- Create: `packages/core/src/cartera/types.ts`, `packages/core/src/cartera/stop.ts`, `packages/core/src/cartera/index.ts`, `packages/core/src/cartera/stop.test.ts`
- Modify: `packages/core/src/index.ts` (agregar `export * from "./cartera/index.js";`)

**Interfaces:**
- Produces:
  ```ts
  export interface Candle { date: string; open: number; high: number; low: number; close: number; volume: number } // date YYYY-MM-DD
  export type Market = "us" | "adr" | "ar";
  export type Layer = "riesgo" | "nucleo" | "cobertura";
  export interface Position { symbol: string; quantity: number; avgCost: number; currency: string; market: Market; layer: Layer; notes: string | null }
  export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";
  export interface PriceHistory { candles(symbol: string, days: number): Promise<Candle[]> } // ascendente por fecha
  export interface SymbolProfile { symbol: string; name: string | null; country: string | null; industry: string | null; marketCap: number | null }
  export interface Profiles { profile(symbol: string): Promise<SymbolProfile | null> }
  export interface NarratorInput { position: Position; verb: Verb; reason: string; close: number; stop: number | null; target: number | null; gainPct: number; weightPct: number; last30: number[]; filings: string[]; news: string[]; riskFacts: string[] }
  export interface Note { narrative: string; degrade: boolean; degradeReason?: string }
  export interface PositionNarrator { readonly promptVersion: string; narrate(input: NarratorInput): Promise<Note> }
  export function atr(candles: Candle[], period: number): number | null
  export function computeTrailingStop(candles: Candle[], opts?: { period?: number; atrMult?: number }): number | null
  export function computeTarget(close: number, stop: number | null): number | null
  ```

- [ ] **Step 1: Write the failing test** `packages/core/src/cartera/stop.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { computeTarget, computeTrailingStop, type Candle } from "./index.js";

/** 30 velas planas en 100 con rango diario 2 (high 101, low 99): ATR = 2. */
const flat = (n: number, close = 100): Candle[] =>
  Array.from({ length: n }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 }));

describe("computeTrailingStop (chandelier 22/3)", () => {
  it("máximo de 22 velas menos 3 × ATR", () => {
    expect(computeTrailingStop(flat(30))).toBe(101 - 3 * 2); // 95
  });
  it("sube con nuevos máximos, no baja", () => {
    const c = flat(30);
    c[29] = { ...c[29]!, high: 111, close: 110 };
    // highest high 111; ATR incluye TR de la última vela: max(111-99, |111-100|, |99-100|) = 12 -> ATR = (21*2 + 12)/22
    const atr = (21 * 2 + 12) / 22;
    expect(computeTrailingStop(c)).toBeCloseTo(111 - 3 * atr, 2);
  });
  it("null con menos de 23 velas", () => {
    expect(computeTrailingStop(flat(22))).toBeNull();
  });
});

describe("computeTarget (RR 2:1)", () => {
  it("close + 2 × (close − stop)", () => expect(computeTarget(100, 95)).toBe(110));
  it("null sin stop", () => expect(computeTarget(100, null)).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/cartera/stop.test.ts`
Expected: FAIL — `Failed to load url ./index.js`

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/cartera/types.ts`:

```ts
/** Cartera real del dueño (etapa 1). Tipos y puertos; sin I/O. */
export interface Candle {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
export type Market = "us" | "adr" | "ar";
export type Layer = "riesgo" | "nucleo" | "cobertura";
export interface Position {
  symbol: string;
  quantity: number;
  avgCost: number;
  currency: string;
  market: Market;
  layer: Layer;
  notes: string | null;
}
export type Verb = "VENDER" | "REVISAR" | "MANTENER" | "SUMAR";

/** Velas diarias ascendentes por fecha. `days` es cuántas velas hacia atrás como mínimo. */
export interface PriceHistory {
  candles(symbol: string, days: number): Promise<Candle[]>;
}
export interface SymbolProfile {
  symbol: string;
  name: string | null;
  country: string | null;
  industry: string | null;
  marketCap: number | null;
}
export interface Profiles {
  profile(symbol: string): Promise<SymbolProfile | null>;
}

export interface NarratorInput {
  position: Position;
  verb: Verb;
  reason: string;
  close: number;
  stop: number | null;
  target: number | null;
  gainPct: number;
  weightPct: number;
  /** Últimos 30 cierres, ascendentes. */
  last30: number[];
  filings: string[];
  news: string[];
  riskFacts: string[];
}
export interface Note {
  narrative: string;
  degrade: boolean;
  degradeReason?: string;
}
/** El modelo escribe; solo puede pedir degradar. El código decide qué hacer con eso. */
export interface PositionNarrator {
  readonly promptVersion: string;
  narrate(input: NarratorInput): Promise<Note>;
}
```

`packages/core/src/cartera/stop.ts`:

```ts
import type { Candle } from "./types.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ATR(period): media del true range de las últimas `period` velas. null si faltan velas (necesita period+1). */
export function atr(candles: Candle[], period: number): number | null {
  if (candles.length < period + 1) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const cur = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    sum += Math.max(cur.high - cur.low, Math.abs(cur.high - prevClose), Math.abs(cur.low - prevClose));
  }
  return sum / period;
}

/**
 * Stop "chandelier": máximo de las últimas `period` velas menos `atrMult` × ATR(period).
 * Sube cuando la acción hace máximos nuevos; nunca baja. Portado de trading v1.
 */
export function computeTrailingStop(candles: Candle[], opts: { period?: number; atrMult?: number } = {}): number | null {
  const period = opts.period ?? 22;
  const mult = opts.atrMult ?? 3;
  const a = atr(candles, period);
  if (a === null) return null;
  const highest = Math.max(...candles.slice(-period).map((c) => c.high));
  return round2(highest - mult * a);
}

/** Objetivo con riesgo/beneficio 2:1 respecto del stop. */
export function computeTarget(close: number, stop: number | null): number | null {
  if (stop === null) return null;
  return round2(close + 2 * (close - stop));
}
```

`packages/core/src/cartera/index.ts`:

```ts
export * from "./types.js";
export * from "./stop.js";
```

Agregar en `packages/core/src/index.ts`: `export * from "./cartera/index.js";`

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/cartera/stop.test.ts` → PASS (5). Luego `pnpm --filter @thesis/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cartera packages/core/src/index.ts
git commit -m "feat(core): tipos de cartera y stop chandelier"
```

---

### Task 2: Jerarquía de verbos, SUMAR y degradación (core)

**Files:**
- Create: `packages/core/src/cartera/verdict.ts`, `packages/core/src/cartera/verdict.test.ts`
- Modify: `packages/core/src/cartera/index.ts` (export)

**Interfaces:**
- Consumes: `Candle`, `Layer`, `Verb`, `computeTrailingStop`, `computeTarget` (Task 1).
- Produces:
  ```ts
  export interface VerdictInput { candles: Candle[]; spot: number | null; avgCost: number; layer: Layer; weightPct: number; positionsCount: number; today: string }
  export interface PositionVerdict { verb: Verb; reason: string; warning: string | null; close: number; stop: number | null; target: number | null; gainPct: number; stale: boolean }
  export function isStale(lastCandleDate: string, today: string, maxCalendarDays?: number): boolean
  export function sumarCriteria(i: { weightPct: number; positionsCount: number; close: number; stop: number | null; return21dPct: number | null }): { ok: boolean; why: string }
  export function decideVerb(i: VerdictInput): PositionVerdict
  export function applyDegrade(v: PositionVerdict, note: { degrade: boolean; degradeReason?: string } | null): PositionVerdict
  ```

- [ ] **Step 1: Write the failing test** `packages/core/src/cartera/verdict.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { applyDegrade, decideVerb, isStale, sumarCriteria, type Candle } from "./index.js";

const mk = (closes: number[], startDay = 1): Candle[] =>
  closes.map((c, i) => {
    const d = new Date(Date.UTC(2026, 7, startDay + i)); // agosto 2026 en adelante
    return { date: d.toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume: 1_000_000 };
  });
const flat30 = mk(Array(30).fill(100)); // stop = 101 - 3*2 = 95, última vela 2026-08-30
const base = { spot: 100, avgCost: 80, layer: "riesgo" as const, weightPct: 20, positionsCount: 5, today: "2026-08-31" };

describe("isStale", () => {
  it("más de 4 días calendario es viejo", () => {
    expect(isStale("2026-08-26", "2026-08-31")).toBe(true);
    expect(isStale("2026-08-27", "2026-08-31")).toBe(false);
  });
});

describe("decideVerb", () => {
  it("precio viejo → REVISAR con aviso, aunque haya stop", () => {
    const v = decideVerb({ ...base, candles: flat30, today: "2026-09-10" });
    expect(v.verb).toBe("REVISAR");
    expect(v.stale).toBe(true);
    expect(v.warning).toMatch(/no pude cotizar/i);
  });
  it("cierre bajo el stop → VENDER", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const v = decideVerb({ ...base, candles: c });
    expect(v.verb).toBe("VENDER");
    expect(v.stop).not.toBeNull();
    expect(v.close).toBe(94);
  });
  it("capa núcleo bajo el stop → MANTENER con aviso", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const v = decideVerb({ ...base, candles: c, layer: "nucleo" });
    expect(v.verb).toBe("MANTENER");
    expect(v.warning).toMatch(/núcleo/i);
  });
  it("spot intradiario bajo el stop sin cierre abajo → MANTENER con aviso", () => {
    const v = decideVerb({ ...base, candles: flat30, spot: 94 });
    expect(v.verb).toBe("MANTENER");
    expect(v.warning).toMatch(/cierre/i);
  });
  it("sin velas suficientes → MANTENER con aviso y sin stop", () => {
    const v = decideVerb({ ...base, candles: mk(Array(10).fill(100), 21) });
    expect(v.verb).toBe("MANTENER");
    expect(v.stop).toBeNull();
    expect(v.warning).toMatch(/stop/i);
  });
  it("todo en orden → MANTENER con stop y objetivo", () => {
    const v = decideVerb({ ...base, candles: flat30 });
    expect(v.verb).toBe("MANTENER");
    expect(v.stop).toBe(95);
    expect(v.target).toBe(110);
    expect(v.gainPct).toBe(25);
  });
  it("subponderada, arriba del stop y sin perseguir → SUMAR", () => {
    const v = decideVerb({ ...base, candles: flat30, weightPct: 10 }); // igualitario 20, 80% = 16
    expect(v.verb).toBe("SUMAR");
  });
});

describe("sumarCriteria", () => {
  const ok = { weightPct: 10, positionsCount: 5, close: 100, stop: 95, return21dPct: 5 };
  it("cumple las tres", () => expect(sumarCriteria(ok).ok).toBe(true));
  it("no si pesa ≥ 80% del igualitario", () => expect(sumarCriteria({ ...ok, weightPct: 16 }).ok).toBe(false));
  it("no si está bajo el stop", () => expect(sumarCriteria({ ...ok, close: 94 }).ok).toBe(false));
  it("no si subió más de 15% en 21 velas", () => expect(sumarCriteria({ ...ok, return21dPct: 16 }).ok).toBe(false));
  it("no sin stop ni sin retorno", () => {
    expect(sumarCriteria({ ...ok, stop: null }).ok).toBe(false);
    expect(sumarCriteria({ ...ok, return21dPct: null }).ok).toBe(false);
  });
});

describe("applyDegrade", () => {
  const mantener = decideVerb({ ...base, candles: flat30 });
  it("MANTENER + degrade → REVISAR con el motivo y el stop nombrado", () => {
    const v = applyDegrade(mantener, { degrade: true, degradeReason: "guidance recortado en el 6-K" });
    expect(v.verb).toBe("REVISAR");
    expect(v.reason).toContain("guidance recortado");
    expect(v.reason).toContain("95");
  });
  it("sin degrade no cambia nada", () => expect(applyDegrade(mantener, { degrade: false })).toEqual(mantener));
  it("VENDER nunca cambia", () => {
    const c = [...flat30.slice(0, 29), { ...flat30[29]!, close: 94, low: 93 }];
    const vender = decideVerb({ ...base, candles: c });
    expect(applyDegrade(vender, { degrade: true, degradeReason: "x" }).verb).toBe("VENDER");
  });
  it("null (modelo falló) no cambia nada", () => expect(applyDegrade(mantener, null)).toEqual(mantener));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/cartera/verdict.test.ts` → FAIL (`decideVerb` no exportado).

- [ ] **Step 3: Write minimal implementation** `packages/core/src/cartera/verdict.ts`

```ts
import { computeTarget, computeTrailingStop } from "./stop.js";
import type { Candle, Layer, Verb } from "./types.js";

export interface VerdictInput {
  /** Velas diarias ascendentes; la última es el cierre de decisión. */
  candles: Candle[];
  /** Precio vivo (informa gain intradiario y el aviso de toque; no decide). */
  spot: number | null;
  avgCost: number;
  layer: Layer;
  weightPct: number;
  positionsCount: number;
  /** YYYY-MM-DD */
  today: string;
}
export interface PositionVerdict {
  verb: Verb;
  reason: string;
  warning: string | null;
  close: number;
  stop: number | null;
  target: number | null;
  gainPct: number;
  stale: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const DAY = 86_400_000;

/** Fail-closed: con una vela de hace más de `maxCalendarDays` no se puede afirmar nada sobre el stop. */
export function isStale(lastCandleDate: string, today: string, maxCalendarDays = 4): boolean {
  return (Date.parse(today) - Date.parse(lastCandleDate)) / DAY > maxCalendarDays;
}

export function sumarCriteria(i: { weightPct: number; positionsCount: number; close: number; stop: number | null; return21dPct: number | null }): { ok: boolean; why: string } {
  const equal = 100 / Math.max(1, i.positionsCount);
  if (i.stop === null) return { ok: false, why: "sin stop" };
  if (i.return21dPct === null) return { ok: false, why: "sin retorno de 21 velas" };
  if (i.weightPct >= 0.8 * equal) return { ok: false, why: `pesa ${round2(i.weightPct)}% ≥ 80% del igualitario (${round2(equal)}%)` };
  if (i.close <= i.stop) return { ok: false, why: "bajo el stop" };
  if (i.return21dPct > 15) return { ok: false, why: `subió ${round2(i.return21dPct)}% en 21 velas (no perseguir)` };
  return { ok: true, why: `pesa ${round2(i.weightPct)}% (< 80% de ${round2(equal)}%), arriba del stop, +${round2(i.return21dPct)}% en 21 velas` };
}

/** Jerarquía de decisión (spec §4). Puro. */
export function decideVerb(i: VerdictInput): PositionVerdict {
  const last = i.candles[i.candles.length - 1];
  if (!last) {
    return { verb: "REVISAR", reason: "No tengo velas para este símbolo: no puedo decidir.", warning: "Sin precio. La app NO está vigilando esta posición.", close: Number.NaN, stop: null, target: null, gainPct: Number.NaN, stale: true };
  }
  const close = last.close;
  const stop = computeTrailingStop(i.candles);
  const target = computeTarget(close, stop);
  const gainPct = round2(((close - i.avgCost) / i.avgCost) * 100);
  const base = { close, stop, target, gainPct, stale: false };

  if (isStale(last.date, i.today)) {
    const where = stop !== null ? (close <= stop ? ` Con ese cierre ($${close}) estarías BAJO el stop $${stop}.` : ` Con ese cierre ($${close}) estabas arriba del stop $${stop}.`) : "";
    return { ...base, stale: true, verb: "REVISAR", reason: `No pude cotizar hoy: la última vela es del ${last.date}. Revisá el precio real antes de decidir.`, warning: `Precio del ${last.date}, no de hoy.${where} La app NO está vigilando esta posición hasta que vuelva a cotizar.` };
  }
  if (stop !== null && close <= stop && i.layer !== "riesgo") {
    return { ...base, verb: "MANTENER", reason: `Capa ${i.layer}: no se vende por stop. Un índice diversificado se recupera; vender acá cristaliza la caída.`, warning: `Cerró ($${close}) bajo tu stop $${stop}, pero esta posición es ${i.layer} y el stop duro no aplica (medido a 7 años: +62.6% vendiendo por stop vs +166.0% sin tocar).` };
  }
  if (stop !== null && close <= stop) {
    return { ...base, verb: "VENDER", reason: `Cerró ($${close}) bajo tu stop dinámico $${stop}: el precio se dio vuelta. Salí para proteger ${gainPct >= 0 ? "la ganancia" : "capital"}.`, warning: null };
  }
  if (stop !== null && i.spot !== null && i.spot <= stop) {
    return { ...base, verb: "MANTENER", reason: `Dejá correr. Tu stop está en $${stop} y el objetivo en $${target}: salís solo si CIERRA abajo.`, warning: `Intradiario tocó tu stop $${stop} (spot $${i.spot}), pero todavía no cerró abajo. La venta se confirma con el cierre.` };
  }
  if (stop === null) {
    return { ...base, verb: "MANTENER", reason: "No pude calcular el stop: faltan velas (necesito 23). Mantené y revisá a mano.", warning: "Sin stop dinámico hasta tener 23 velas." };
  }
  const return21dPct = i.candles.length >= 22 ? round2((close / i.candles[i.candles.length - 22]!.close - 1) * 100) : null;
  const sumar = sumarCriteria({ weightPct: i.weightPct, positionsCount: i.positionsCount, close, stop, return21dPct });
  if (sumar.ok) {
    return { ...base, verb: "SUMAR", reason: `Candidata a aporte: ${sumar.why}. Stop $${stop}, objetivo $${target}.`, warning: null };
  }
  return { ...base, verb: "MANTENER", reason: `Dejá correr. Tu stop sube solo a $${stop} y el objetivo es $${target}: salís solo si cierra abajo.`, warning: null };
}

/** El modelo solo puede degradar MANTENER/SUMAR a REVISAR. Cualquier otra cosa se ignora. */
export function applyDegrade(v: PositionVerdict, note: { degrade: boolean; degradeReason?: string } | null): PositionVerdict {
  if (!note?.degrade) return v;
  if (v.verb !== "MANTENER" && v.verb !== "SUMAR") return v;
  const motivo = note.degradeReason?.trim() || "el modelo ve deterioro sin especificar";
  return { ...v, verb: "REVISAR", reason: `El modelo pide revisar: ${motivo}. Tu regla dura es el stop en $${v.stop ?? "—"}: decidí vos.` };
}
```

Agregar `export * from "./verdict.js";` en `packages/core/src/cartera/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run packages/core/src/cartera` → PASS (todos). `pnpm --filter @thesis/core typecheck`.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cartera
git commit -m "feat(core): jerarquía de verbos de cartera, SUMAR y degradación"
```

---
### Task 3: Panel de riesgo calculado (core)

**Files:**
- Create: `packages/core/src/cartera/risk.ts`, `packages/core/src/cartera/risk.test.ts`
- Modify: `packages/core/src/cartera/index.ts` (export)

**Interfaces:**
- Consumes: `Candle`, `Position`, `SymbolProfile` (Task 1).
- Produces:
  ```ts
  export interface RiskInput { positions: Position[]; candles: Record<string, Candle[]>; spy: Candle[]; profiles: Record<string, SymbolProfile | null> }
  export interface RiskReport {
    totalValue: number;
    weights: Array<{ symbol: string; value: number; weightPct: number }>;
    concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
    correlatedPairs: Array<{ a: string; b: string; corr: number }>;
    betas: Record<string, number | null>;
    portfolioBeta: number | null;
    stressSpyMinus20Pct: number | null;
    liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
    notes: string[];
  }
  export function dailyReturns(c: Candle[]): number[]
  export function correlation(a: number[], b: number[]): number | null
  export function beta(asset: number[], bench: number[]): number | null
  export function hhi(shares: Record<string, number>): number  // shares en %, HHI en 0..10000
  export function buildRiskReport(i: RiskInput): RiskReport
  ```

- [ ] **Step 1: Write the failing test** `packages/core/src/cartera/risk.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { beta, buildRiskReport, correlation, hhi, type Candle, type Position } from "./index.js";

const series = (closes: number[], volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, "0")}`, open: c, high: c, low: c, close: c, volume }));
const walk = (n: number, start: number, step: (i: number) => number) => { const out = [start]; for (let i = 1; i < n; i++) out.push(out[i - 1]! * (1 + step(i))); return out; };
const spy = series(walk(130, 100, (i) => (i % 2 ? 0.01 : -0.005)));
const doubleSpy = series(walk(130, 50, (i) => (i % 2 ? 0.02 : -0.01))); // beta ≈ 2, corr 1
const flat = series(Array(130).fill(20), 100);

const pos = (symbol: string, quantity: number, market: Position["market"] = "us"): Position => ({ symbol, quantity, avgCost: 1, currency: "USD", market, layer: "riesgo", notes: null });

describe("estadísticos", () => {
  it("correlación 1 entre series proporcionales, null con < 20 puntos", () => {
    expect(correlation([1, 2, 3, 4, 5].concat(Array(20).fill(1)), [2, 4, 6, 8, 10].concat(Array(20).fill(2)))).toBeCloseTo(1, 6);
    expect(correlation([1, 2], [2, 4])).toBeNull();
  });
  it("beta ≈ 2 de una serie que se mueve el doble", () => {
    const r = (c: Candle[]) => c.slice(1).map((x, i) => x.close / c[i]!.close - 1);
    expect(beta(r(doubleSpy), r(spy))).toBeCloseTo(2, 1);
  });
  it("HHI de dos mitades = 5000; de uno solo = 10000", () => {
    expect(hhi({ AR: 50, US: 50 })).toBe(5000);
    expect(hhi({ AR: 100 })).toBe(10000);
  });
});

describe("buildRiskReport", () => {
  const r = buildRiskReport({
    positions: [pos("AAA", 10), pos("BBB", 10), pos("ARG", 100, "adr")],
    candles: { AAA: doubleSpy, BBB: doubleSpy, ARG: flat },
    spy,
    profiles: { AAA: { symbol: "AAA", name: null, country: "US", industry: "Semis", marketCap: null }, BBB: { symbol: "BBB", name: null, country: "US", industry: "Semis", marketCap: null }, ARG: null },
  });
  it("pesos por valor de cierre", () => {
    const last = doubleSpy[129]!.close;
    const total = 10 * last * 2 + 100 * 20;
    expect(r.totalValue).toBeCloseTo(total, 2);
    expect(r.weights.find((w) => w.symbol === "ARG")!.weightPct).toBeCloseTo((2000 / total) * 100, 2);
  });
  it("país del perfil, o del mercado si no hay perfil; aviso > 40%", () => {
    expect(Object.keys(r.concentration.byCountry).sort()).toEqual(["AR", "US"]);
    expect(r.concentration.warnings.some((w) => /Semis|US|AR/.test(w))).toBe(true);
  });
  it("lista pares con correlación > 0.7", () => {
    expect(r.correlatedPairs).toEqual([{ a: "AAA", b: "BBB", corr: 1 }]);
  });
  it("beta por posición y estrés lineal", () => {
    expect(r.betas["AAA"]).toBeCloseTo(2, 1);
    expect(r.betas["ARG"]).toBeCloseTo(0, 1);
    const expected = r.weights.reduce((s, w) => s + (w.weightPct / 100) * (r.betas[w.symbol] ?? 0) * -20, 0);
    expect(r.stressSpyMinus20Pct).toBeCloseTo(expected, 4);
  });
  it("liquidez: días para liquidar al 10% del volumen medio", () => {
    const l = r.liquidity.find((x) => x.symbol === "ARG")!;
    expect(l.avgDollarVolume30d).toBe(20 * 100);
    expect(l.daysToLiquidate).toBeCloseTo(100 / (100 * 0.1), 4); // 100 acciones, 10 por día
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run packages/core/src/cartera/risk.test.ts` → FAIL (`buildRiskReport` no existe).

- [ ] **Step 3: Write minimal implementation** `packages/core/src/cartera/risk.ts`

```ts
import type { Candle, Position, SymbolProfile } from "./types.js";

export interface RiskInput {
  positions: Position[];
  candles: Record<string, Candle[]>;
  spy: Candle[];
  profiles: Record<string, SymbolProfile | null>;
}
export interface RiskReport {
  totalValue: number;
  weights: Array<{ symbol: string; value: number; weightPct: number }>;
  concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; hhiCountry: number; hhiIndustry: number; warnings: string[] };
  correlatedPairs: Array<{ a: string; b: string; corr: number }>;
  betas: Record<string, number | null>;
  portfolioBeta: number | null;
  /** Caída estimada (%) si SPY cae 20%: Σ peso × beta × (−20). Aproximación lineal. */
  stressSpyMinus20Pct: number | null;
  liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>;
  notes: string[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const MIN_POINTS = 20;

export function dailyReturns(c: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < c.length; i++) out.push(c[i]!.close / c[i - 1]!.close - 1);
  return out;
}
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pearson sobre las últimas min(len) observaciones alineadas por el final. null si < 20. */
export function correlation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < MIN_POINTS) return null;
  const x = a.slice(-n), y = b.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; syy += (y[i]! - my) ** 2; }
  if (sxx === 0 || syy === 0) return null;
  return round4(sxy / Math.sqrt(sxx * syy));
}

/** Beta = cov(asset, bench) / var(bench). null si < 20 puntos o varianza cero. */
export function beta(asset: number[], bench: number[]): number | null {
  const n = Math.min(asset.length, bench.length);
  if (n < MIN_POINTS) return null;
  const x = bench.slice(-n), y = asset.slice(-n), mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i]! - mx) * (y[i]! - my); sxx += (x[i]! - mx) ** 2; }
  if (sxx === 0) return null;
  return round4(sxy / sxx);
}

/** Herfindahl sobre participaciones en % (0..10000). */
export function hhi(shares: Record<string, number>): number {
  return Math.round(Object.values(shares).reduce((s, p) => s + p * p, 0));
}

const countryOf = (p: Position, prof: SymbolProfile | null) => prof?.country ?? (p.market === "adr" || p.market === "ar" ? "AR" : "US");

export function buildRiskReport(i: RiskInput): RiskReport {
  const notes: string[] = [];
  const lastClose = (s: string) => i.candles[s]?.[i.candles[s]!.length - 1]?.close ?? null;
  const values = i.positions.map((p) => ({ symbol: p.symbol, value: (lastClose(p.symbol) ?? 0) * p.quantity }));
  const totalValue = round2(values.reduce((s, v) => s + v.value, 0));
  const weights = values.map((v) => ({ symbol: v.symbol, value: round2(v.value), weightPct: totalValue > 0 ? round2((v.value / totalValue) * 100) : 0 }));
  for (const p of i.positions) if (lastClose(p.symbol) === null) notes.push(`${p.symbol}: sin velas, valuada en 0`);

  const byCountry: Record<string, number> = {}, byIndustry: Record<string, number> = {};
  for (const p of i.positions) {
    const w = weights.find((x) => x.symbol === p.symbol)!.weightPct;
    const c = countryOf(p, i.profiles[p.symbol] ?? null);
    byCountry[c] = round2((byCountry[c] ?? 0) + w);
    const ind = i.profiles[p.symbol]?.industry ?? "desconocida";
    byIndustry[ind] = round2((byIndustry[ind] ?? 0) + w);
  }
  const warnings: string[] = [];
  for (const [k, v] of Object.entries(byCountry)) if (v > 40) warnings.push(`País ${k}: ${v}% de la cartera (> 40%)`);
  for (const [k, v] of Object.entries(byIndustry)) if (v > 40 && k !== "desconocida") warnings.push(`Industria ${k}: ${v}% de la cartera (> 40%)`);

  const rets: Record<string, number[]> = {};
  for (const p of i.positions) rets[p.symbol] = dailyReturns((i.candles[p.symbol] ?? []).slice(-127));
  const spyRets = dailyReturns(i.spy.slice(-127));

  const correlatedPairs: RiskReport["correlatedPairs"] = [];
  const syms = i.positions.map((p) => p.symbol);
  for (let a = 0; a < syms.length; a++) for (let b = a + 1; b < syms.length; b++) {
    const c = correlation(rets[syms[a]!]!, rets[syms[b]!]!);
    if (c !== null && c > 0.7) correlatedPairs.push({ a: syms[a]!, b: syms[b]!, corr: c });
  }

  const betas: Record<string, number | null> = {};
  for (const s of syms) betas[s] = beta(rets[s]!.slice(-63), spyRets.slice(-63));
  const withBeta = weights.filter((w) => betas[w.symbol] !== null);
  const portfolioBeta = withBeta.length ? round4(withBeta.reduce((s, w) => s + (w.weightPct / 100) * betas[w.symbol]!, 0)) : null;
  const stressSpyMinus20Pct = portfolioBeta === null ? null : round2(withBeta.reduce((s, w) => s + (w.weightPct / 100) * betas[w.symbol]! * -20, 0));
  if (withBeta.length < weights.length) notes.push("Estrés calculado solo sobre posiciones con beta (faltan velas en el resto).");

  const liquidity = i.positions.map((p) => {
    const last30 = (i.candles[p.symbol] ?? []).slice(-30);
    if (!last30.length) return { symbol: p.symbol, avgDollarVolume30d: null, daysToLiquidate: null };
    const avgShares = last30.reduce((s, c) => s + c.volume, 0) / last30.length;
    const avgDollar = round2(last30.reduce((s, c) => s + c.volume * c.close, 0) / last30.length);
    return { symbol: p.symbol, avgDollarVolume30d: avgDollar, daysToLiquidate: avgShares > 0 ? round4(p.quantity / (avgShares * 0.1)) : null };
  });

  return { totalValue, weights, concentration: { byCountry, byIndustry, hhiCountry: hhi(byCountry), hhiIndustry: hhi(byIndustry), warnings }, correlatedPairs, betas, portfolioBeta, stressSpyMinus20Pct, liquidity, notes };
}
```

Agregar `export * from "./risk.js";` al index de cartera.

- [ ] **Step 4: Run test to verify it passes** → `pnpm exec vitest run packages/core/src/cartera` PASS; typecheck core.

- [ ] **Step 5: Commit** `git commit -am "feat(core): panel de riesgo de cartera calculado"` (con `git add packages/core/src/cartera`).

---

### Task 4: Medición contra SPY (core)

**Files:**
- Create: `packages/core/src/cartera/measure.ts`, `packages/core/src/cartera/measure.test.ts`
- Modify: `packages/core/src/cartera/index.ts`

**Interfaces:**
- Produces:
  ```ts
  export function alphaPct(close: number, closeLater: number, spy: number, spyLater: number): number
  export function verdictHit(verb: Verb, alpha: number): boolean | null   // null = no se puntúa (REVISAR)
  export interface MeasuredVerdict { verb: Verb; alpha7dPct: number | null; alpha30dPct: number | null }
  export interface MeasurementSummary { byVerb: Record<Verb, { h7: { n: number; hitRate: number | null; avgAlpha: number | null }; h30: { n: number; hitRate: number | null; avgAlpha: number | null } }>; pending: number }
  export function summarizeMeasurement(rows: MeasuredVerdict[]): MeasurementSummary
  ```

- [ ] **Step 1: Write the failing test** `packages/core/src/cartera/measure.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { alphaPct, summarizeMeasurement, verdictHit } from "./index.js";

describe("alphaPct", () => {
  it("retorno del papel menos retorno de SPY, en %", () => {
    expect(alphaPct(100, 110, 100, 105)).toBeCloseTo(5, 6);
    expect(alphaPct(100, 95, 100, 100)).toBeCloseTo(-5, 6);
  });
});
describe("verdictHit", () => {
  it("VENDER acierta con alpha < 0; MANTENER/SUMAR con alpha > 0; REVISAR no se puntúa", () => {
    expect(verdictHit("VENDER", -3)).toBe(true);
    expect(verdictHit("VENDER", 2)).toBe(false);
    expect(verdictHit("MANTENER", 2)).toBe(true);
    expect(verdictHit("SUMAR", -1)).toBe(false);
    expect(verdictHit("REVISAR", 5)).toBeNull();
  });
});
describe("summarizeMeasurement", () => {
  it("agrega por verbo y horizonte; cuenta pendientes", () => {
    const s = summarizeMeasurement([
      { verb: "MANTENER", alpha7dPct: 2, alpha30dPct: null },
      { verb: "MANTENER", alpha7dPct: -4, alpha30dPct: 6 },
      { verb: "VENDER", alpha7dPct: -1, alpha30dPct: -2 },
      { verb: "REVISAR", alpha7dPct: 9, alpha30dPct: 9 },
      { verb: "SUMAR", alpha7dPct: null, alpha30dPct: null },
    ]);
    expect(s.byVerb.MANTENER.h7).toEqual({ n: 2, hitRate: 0.5, avgAlpha: -1 });
    expect(s.byVerb.MANTENER.h30).toEqual({ n: 1, hitRate: 1, avgAlpha: 6 });
    expect(s.byVerb.VENDER.h7).toEqual({ n: 1, hitRate: 1, avgAlpha: -1 });
    expect(s.byVerb.REVISAR.h7).toEqual({ n: 1, hitRate: null, avgAlpha: 9 });
    expect(s.byVerb.SUMAR.h7).toEqual({ n: 0, hitRate: null, avgAlpha: null });
    expect(s.pending).toBe(2); // sin alpha7d: SUMAR; sin alpha30d: MANTENER#1 y SUMAR → pendientes = filas con algún horizonte sin medir = 2
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`alphaPct` no existe).

- [ ] **Step 3: Write minimal implementation** `packages/core/src/cartera/measure.ts`

```ts
import type { Verb } from "./types.js";

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** Alpha contra "comprar SPY y no hacer nada", en puntos porcentuales. */
export function alphaPct(close: number, closeLater: number, spy: number, spyLater: number): number {
  return round4(((closeLater / close - 1) - (spyLater / spy - 1)) * 100);
}

/** VENDER acierta si el papel rindió menos que SPY después; MANTENER/SUMAR si rindió más. REVISAR no se puntúa. */
export function verdictHit(verb: Verb, alpha: number): boolean | null {
  if (verb === "REVISAR") return null;
  if (verb === "VENDER") return alpha < 0;
  return alpha > 0;
}

export interface MeasuredVerdict { verb: Verb; alpha7dPct: number | null; alpha30dPct: number | null }
interface Bucket { n: number; hitRate: number | null; avgAlpha: number | null }
export interface MeasurementSummary { byVerb: Record<Verb, { h7: Bucket; h30: Bucket }>; pending: number }

const VERBS: Verb[] = ["VENDER", "REVISAR", "MANTENER", "SUMAR"];

function bucket(verb: Verb, alphas: number[]): Bucket {
  if (!alphas.length) return { n: 0, hitRate: null, avgAlpha: null };
  const hits = alphas.map((a) => verdictHit(verb, a)).filter((h): h is boolean => h !== null);
  return { n: alphas.length, hitRate: hits.length ? round4(hits.filter(Boolean).length / hits.length) : null, avgAlpha: round4(alphas.reduce((s, a) => s + a, 0) / alphas.length) };
}

export function summarizeMeasurement(rows: MeasuredVerdict[]): MeasurementSummary {
  const byVerb = {} as MeasurementSummary["byVerb"];
  for (const v of VERBS) {
    const mine = rows.filter((r) => r.verb === v);
    byVerb[v] = { h7: bucket(v, mine.map((r) => r.alpha7dPct).filter((a): a is number => a !== null)), h30: bucket(v, mine.map((r) => r.alpha30dPct).filter((a): a is number => a !== null)) };
  }
  return { byVerb, pending: rows.filter((r) => r.alpha7dPct === null || r.alpha30dPct === null).length };
}
```

Agregar `export * from "./measure.js";` al index.

- [ ] **Step 4: Run test to verify it passes** → PASS; typecheck core.

- [ ] **Step 5: Commit** `git add packages/core/src/cartera && git commit -m "feat(core): medición de veredictos contra SPY"`.

---
### Task 5: Adaptadores de precios y perfil (adapters)

**Files:**
- Create: `packages/adapters/src/yahoo/index.ts`, `packages/adapters/src/alpaca/history.ts`, `packages/adapters/src/finnhub/index.ts`, `packages/adapters/src/history.ts`, `packages/adapters/test/cartera-adapters.test.ts`
- Modify: `packages/adapters/src/index.ts` (exports), `packages/adapters/src/alpaca/index.ts` (export history)

**Interfaces:**
- Consumes: `HttpClient` (`createHttpClient`/`fixtureHttpClient`), `alpacaHeaders`, `ALPACA_DATA` de `alpaca/client.ts`; `Candle`, `PriceHistory`, `Profiles`, `SymbolProfile` de core.
- Produces:
  ```ts
  export function parseYahooChart(json: unknown): Candle[]                 // puro
  export class YahooPriceHistory implements PriceHistory { constructor(http: HttpClient) }
  export class AlpacaPriceHistory implements PriceHistory { constructor(http: HttpClient, cfg: AlpacaConfig) }
  export class FallbackPriceHistory implements PriceHistory { constructor(primary: PriceHistory, fallback: PriceHistory, log?: (m: string) => void) }
  export class FinnhubProfiles implements Profiles { constructor(http: HttpClient, token: string) }
  export const NO_PROFILES: Profiles   // devuelve null siempre (sin key)
  ```
- Yahoo: `GET https://query2.finance.yahoo.com/v8/finance/chart/{SYMBOL}?range={r}&interval=1d` con `r` = `3mo` si days ≤ 60, `6mo` si ≤ 120, `1y` si ≤ 250, `2y` si no. Respuesta: `chart.result[0].timestamp[]` (epoch s) y `chart.result[0].indicators.quote[0].{open,high,low,close,volume}[]`; descartar índices con `close` null. Fecha = `new Date(ts*1000).toISOString().slice(0,10)`. `chart.error` no nulo → throw.
- Alpaca: `GET {ALPACA_DATA}/v2/stocks/bars?symbols=S&timeframe=1Day&start=YYYY-MM-DD&limit=1000&feed=iex` (start = hoy − days×1.6 días). `bars[S][]` con `{t,o,h,l,c,v}`; `t` ISO → fecha `slice(0,10)`.
- Finnhub: `GET https://finnhub.io/api/v1/stock/profile2?symbol=S&token=T` → `{name, country, finnhubIndustry, marketCapitalization}` (marketCap en millones → × 1e6). Objeto vacío `{}` → null.

- [ ] **Step 1: Write the failing test** `packages/adapters/test/cartera-adapters.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { AlpacaPriceHistory, FallbackPriceHistory, FinnhubProfiles, YahooPriceHistory, fixtureHttpClient, parseYahooChart } from "../src/index.js";

const yahoo = { chart: { result: [{ timestamp: [1756684800, 1756771200, 1756857600], indicators: { quote: [{ open: [1, 2, null], high: [2, 3, null], low: [0.5, 1.5, null], close: [1.5, 2.5, null], volume: [100, 200, null] }] } }], error: null } };

describe("parseYahooChart", () => {
  it("convierte timestamps a YYYY-MM-DD y descarta velas sin cierre", () => {
    const c = parseYahooChart(yahoo);
    expect(c).toEqual([
      { date: "2025-09-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 100 },
      { date: "2025-09-02", open: 2, high: 3, low: 1.5, close: 2.5, volume: 200 },
    ]);
  });
  it("error de Yahoo lanza", () => {
    expect(() => parseYahooChart({ chart: { result: null, error: { code: "Not Found", description: "No data" } } })).toThrow(/No data/);
  });
});

describe("YahooPriceHistory", () => {
  it("pide el rango según los días y devuelve velas", async () => {
    const http = fixtureHttpClient({ "https://query2.finance.yahoo.com/v8/finance/chart/GGAL.BA?range=1y": yahoo });
    expect((await new YahooPriceHistory(http).candles("ggal.ba", 200)).length).toBe(2);
  });
});

describe("AlpacaPriceHistory", () => {
  it("mapea barras IEX a velas", async () => {
    const http = fixtureHttpClient({ "https://data.alpaca.markets/v2/stocks/bars?symbols=YPF": { bars: { YPF: [{ t: "2026-09-01T04:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 }] } } });
    const c = await new AlpacaPriceHistory(http, { keyId: "k", secretKey: "s", paper: true }).candles("YPF", 30);
    expect(c).toEqual([{ date: "2026-09-01", open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 }]);
  });
});

describe("FallbackPriceHistory", () => {
  it("usa el respaldo si el primario falla o devuelve vacío", async () => {
    const bad = { candles: async () => { throw new Error("yahoo caído"); } };
    const empty = { candles: async () => [] };
    const good = { candles: async () => [{ date: "2026-09-01", open: 1, high: 1, low: 1, close: 1, volume: 1 }] };
    expect((await new FallbackPriceHistory(bad, good).candles("X", 10)).length).toBe(1);
    expect((await new FallbackPriceHistory(empty, good).candles("X", 10)).length).toBe(1);
  });
});

describe("FinnhubProfiles", () => {
  it("mapea profile2; objeto vacío es null", async () => {
    const http = fixtureHttpClient({
      "https://finnhub.io/api/v1/stock/profile2?symbol=TSM": { name: "Taiwan Semiconductor", country: "TW", finnhubIndustry: "Semiconductors", marketCapitalization: 1000 },
      "https://finnhub.io/api/v1/stock/profile2?symbol=ZZZZ": {},
    });
    const p = new FinnhubProfiles(http, "tok");
    expect(await p.profile("TSM")).toEqual({ symbol: "TSM", name: "Taiwan Semiconductor", country: "TW", industry: "Semiconductors", marketCap: 1_000_000_000 });
    expect(await p.profile("ZZZZ")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → `pnpm exec vitest run packages/adapters/test/cartera-adapters.test.ts` FAIL (exports faltantes).

- [ ] **Step 3: Write minimal implementation**

`packages/adapters/src/yahoo/index.ts`:

```ts
import type { Candle, PriceHistory } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

interface YahooChart {
  chart: { result: Array<{ timestamp?: number[]; indicators: { quote: Array<{ open: Array<number | null>; high: Array<number | null>; low: Array<number | null>; close: Array<number | null>; volume: Array<number | null> }> } }> | null; error: { code: string; description: string } | null };
}

/** Parser puro del chart API v8 de Yahoo. */
export function parseYahooChart(json: unknown): Candle[] {
  const d = json as YahooChart;
  if (d.chart?.error) throw new Error(`yahoo: ${d.chart.error.description}`);
  const r = d.chart?.result?.[0];
  if (!r?.timestamp) return [];
  const q = r.indicators.quote[0]!;
  const out: Candle[] = [];
  r.timestamp.forEach((ts, i) => {
    const close = q.close[i];
    if (close === null || close === undefined) return;
    out.push({ date: new Date(ts * 1000).toISOString().slice(0, 10), open: q.open[i] ?? close, high: q.high[i] ?? close, low: q.low[i] ?? close, close, volume: q.volume[i] ?? 0 });
  });
  return out;
}

const rangeFor = (days: number) => (days <= 60 ? "3mo" : days <= 120 ? "6mo" : days <= 250 ? "1y" : "2y");

/** Velas diarias de Yahoo (no oficial; gratis; cubre .BA). */
export class YahooPriceHistory implements PriceHistory {
  constructor(private readonly http: HttpClient) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol.toUpperCase())}?range=${rangeFor(days)}&interval=1d`;
    return parseYahooChart(await this.http.getJson(url));
  }
}
```

`packages/adapters/src/alpaca/history.ts`:

```ts
import type { Candle, PriceHistory } from "@thesis/core";
import type { HttpClient } from "../http/index.js";
import { ALPACA_DATA, alpacaHeaders, type AlpacaConfig } from "./client.js";

interface BarsResp { bars: Record<string, Array<{ t: string; o: number; h: number; l: number; c: number; v: number }>> }

/** Barras diarias IEX de Alpaca. Respaldo de Yahoo; el volumen IEX subestima el consolidado. */
export class AlpacaPriceHistory implements PriceHistory {
  constructor(private readonly http: HttpClient, private readonly cfg: AlpacaConfig) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    const sym = symbol.toUpperCase();
    const start = new Date(Date.now() - Math.ceil(days * 1.6) * 86_400_000).toISOString().slice(0, 10);
    const r = await this.http.getJson<BarsResp>(`${ALPACA_DATA}/v2/stocks/bars?symbols=${sym}&timeframe=1Day&start=${start}&limit=1000&feed=iex`, alpacaHeaders(this.cfg));
    return (r.bars[sym] ?? []).map((b) => ({ date: b.t.slice(0, 10), open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
  }
}
```

(Verificar en `alpaca/client.ts` los nombres exportados `ALPACA_DATA`, `alpacaHeaders`, `AlpacaConfig`; si `alpacaHeaders` no está exportado, exportarlo.) Agregar `export * from "./history.js";` en `packages/adapters/src/alpaca/index.ts`.

`packages/adapters/src/history.ts`:

```ts
import type { Candle, PriceHistory } from "@thesis/core";

/** Primario (Yahoo) con respaldo (Alpaca): si el primario lanza o devuelve vacío, se usa el otro. */
export class FallbackPriceHistory implements PriceHistory {
  constructor(private readonly primary: PriceHistory, private readonly fallback: PriceHistory, private readonly log: (m: string) => void = () => {}) {}
  async candles(symbol: string, days: number): Promise<Candle[]> {
    try {
      const c = await this.primary.candles(symbol, days);
      if (c.length) return c;
      this.log(`[history] ${symbol}: primario vacío, uso respaldo`);
    } catch (e) {
      this.log(`[history] ${symbol}: primario falló (${String(e).slice(0, 80)}), uso respaldo`);
    }
    return this.fallback.candles(symbol, days);
  }
}
```

`packages/adapters/src/finnhub/index.ts`:

```ts
import type { Profiles, SymbolProfile } from "@thesis/core";
import type { HttpClient } from "../http/index.js";

interface Profile2 { name?: string; country?: string; finnhubIndustry?: string; marketCapitalization?: number }

/** Perfil de empresa (país, industria, capitalización). Free tier: 60 req/min. */
export class FinnhubProfiles implements Profiles {
  constructor(private readonly http: HttpClient, private readonly token: string) {}
  async profile(symbol: string): Promise<SymbolProfile | null> {
    const sym = symbol.toUpperCase();
    const p = await this.http.getJson<Profile2>(`https://finnhub.io/api/v1/stock/profile2?symbol=${sym}&token=${this.token}`);
    if (!p || !Object.keys(p).length) return null;
    return { symbol: sym, name: p.name ?? null, country: p.country ?? null, industry: p.finnhubIndustry ?? null, marketCap: p.marketCapitalization ? Math.round(p.marketCapitalization * 1e6) : null };
  }
}

/** Sin key de Finnhub: nunca hay perfil; el país sale del mercado de la posición. */
export const NO_PROFILES: Profiles = { profile: async () => null };
```

Exports en `packages/adapters/src/index.ts`: `export * from "./yahoo/index.js"; export * from "./finnhub/index.js"; export * from "./history.js";`

- [ ] **Step 4: Run test to verify it passes** → PASS; `pnpm --filter @thesis/adapters typecheck`.

- [ ] **Step 5: Commit** `git add packages/adapters && git commit -m "feat(adapters): velas Yahoo/Alpaca con respaldo y perfil Finnhub"`.

---

### Task 6: Tablas, migración y Repo (db)

**Files:**
- Modify: `packages/db/src/schema.ts` (5 tablas), `packages/db/src/repo.ts` (métodos), `packages/db/src/repo.integration.test.ts` (casos + limpieza)
- Create: `packages/db/drizzle/0001_cartera.sql` (generada con `pnpm db:generate`)

**Interfaces:**
- Consumes: `Position`, `Verb`, `RiskReport` de core.
- Produces (misma firma que `CarteraStore` de Task 7):
  ```ts
  export interface Transaction { id: string; symbol: string; type: "BUY" | "SELL" | "DIVIDEND" | "TRANSFER"; quantity: number; price: number; fees: number; date: string; currency: string; platform: string | null; externalId: string | null; notes: string | null }
  export interface VerdictRow { verdictDate: string; symbol: string; verb: Verb; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null; promptVersion: string | null; close7d: number | null; spy7d: number | null; alpha7dPct: number | null; close30d: number | null; spy30d: number | null; alpha30dPct: number | null; measuredAt: string | null }
  positions(): Promise<Position[]>; upsertPosition(p: Position): Promise<void>; deletePosition(symbol: string): Promise<void>
  transactions(): Promise<Transaction[]>; insertTransactions(t: Transaction[]): Promise<number>   // ignora duplicados por external_id o (date,symbol,type,quantity,price)
  profile(symbol: string): Promise<{ profile: SymbolProfile; updatedAt: string } | null>; saveProfile(p: SymbolProfile): Promise<void>
  upsertVerdicts(rows: VerdictRow[]): Promise<void>; latestVerdicts(): Promise<VerdictRow[]>; verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]>; setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void>; allVerdicts(): Promise<VerdictRow[]>
  saveRisk(date: string, report: RiskReport): Promise<void>; latestRisk(): Promise<{ date: string; report: RiskReport } | null>
  ```
- `VerdictRow` y `Transaction` viven en `packages/core/src/cartera/types.ts` (agregarlos ahí para que pipeline y db compartan el tipo).

- [ ] **Step 1: Write the failing test** — agregar a `packages/db/src/repo.integration.test.ts` dentro del `describe`:

```ts
  it("cartera: posiciones, operaciones, veredictos, riesgo y medición", async () => {
    const sym = `C${ticker}`;
    await repo.upsertPosition({ symbol: sym, quantity: 10, avgCost: 5, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await repo.upsertPosition({ symbol: sym, quantity: 12, avgCost: 5.5, currency: "USD", market: "us", layer: "riesgo", notes: "x" });
    expect((await repo.positions()).find((p) => p.symbol === sym)?.quantity).toBe(12);

    const tx = { id: randomUUID(), symbol: sym, type: "BUY" as const, quantity: 1, price: 2, fees: 0, date: "2026-01-02", currency: "USD", platform: "Nexo", externalId: `ext-${sym}`, notes: null };
    expect(await repo.insertTransactions([tx, { ...tx, id: randomUUID() }])).toBe(1);

    await repo.saveProfile({ symbol: sym, name: "N", country: "US", industry: "I", marketCap: 1 });
    expect((await repo.profile(sym))?.profile.country).toBe("US");

    const row = { verdictDate: "2026-08-01", symbol: sym, verb: "MANTENER" as const, reason: "r", narrative: null, warning: null, close: 10, spot: 10, stop: 9, target: 12, gainPct: 100, weightPct: 50, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null };
    await repo.upsertVerdicts([row]);
    await repo.upsertVerdicts([{ ...row, reason: "r2" }]);
    expect((await repo.latestVerdicts()).find((v) => v.symbol === sym)?.reason).toBe("r2");
    expect((await repo.verdictsToMeasure("2026-08-08", 7)).some((v) => v.symbol === sym)).toBe(true);
    await repo.setMeasurement("2026-08-01", sym, { close7d: 11, spy7d: 505, alpha7dPct: 9 });
    expect((await repo.verdictsToMeasure("2026-08-08", 7)).some((v) => v.symbol === sym)).toBe(false);
    expect((await repo.allVerdicts()).find((v) => v.symbol === sym)?.alpha7dPct).toBe(9);

    const report = { totalValue: 1, weights: [], concentration: { byCountry: {}, byIndustry: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] };
    await repo.saveRisk("2026-08-01", report);
    await repo.saveRisk("2026-08-01", { ...report, totalValue: 2 });
    expect((await repo.latestRisk())?.report.totalValue).toBe(2);
  });
```

Y en el `afterAll`, antes de lo existente: borrar `portfolio_verdicts`, `symbol_meta`, `transactions`, `positions` donde `symbol = C${ticker}` y `portfolio_risk` con `snapshot_date = '2026-08-01'`.

- [ ] **Step 2: Run test to verify it fails** → `DATABASE_URL=... pnpm exec vitest run packages/db` FAIL (`upsertPosition` no existe).

- [ ] **Step 3: Write minimal implementation**

Tipos en core (`packages/core/src/cartera/types.ts`, agregar):

```ts
export interface Transaction { id: string; symbol: string; type: "BUY" | "SELL" | "DIVIDEND" | "TRANSFER"; quantity: number; price: number; fees: number; date: string; currency: string; platform: string | null; externalId: string | null; notes: string | null }
export interface VerdictRow { verdictDate: string; symbol: string; verb: Verb; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null; promptVersion: string | null; close7d: number | null; spy7d: number | null; alpha7dPct: number | null; close30d: number | null; spy30d: number | null; alpha30dPct: number | null; measuredAt: string | null }
```

Schema (`packages/db/src/schema.ts`, al final):

```ts
/** Cartera real (spec etapa 1). */
export const marketEnum = pgEnum("market", ["us", "adr", "ar"]);
export const layerEnum = pgEnum("layer", ["riesgo", "nucleo", "cobertura"]);
export const verbEnum = pgEnum("verb", ["VENDER", "REVISAR", "MANTENER", "SUMAR"]);
export const txTypeEnum = pgEnum("tx_type", ["BUY", "SELL", "DIVIDEND", "TRANSFER"]);

export const positions = pgTable("positions", {
  symbol: text("symbol").primaryKey(),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  avgCost: numeric("avg_cost", { precision: 14, scale: 4 }).notNull(),
  currency: text("currency").notNull().default("USD"),
  market: marketEnum("market").notNull(),
  layer: layerEnum("layer").notNull().default("riesgo"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  type: txTypeEnum("type").notNull(),
  quantity: numeric("quantity", { precision: 18, scale: 8 }).notNull(),
  price: numeric("price", { precision: 14, scale: 4 }).notNull(),
  fees: numeric("fees", { precision: 14, scale: 4 }).notNull().default("0"),
  date: date("date").notNull(),
  currency: text("currency").notNull().default("USD"),
  platform: text("platform"),
  externalId: text("external_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("transactions_dedupe").on(t.date, t.symbol, t.type, t.quantity, t.price), uniqueIndex("transactions_external").on(t.externalId)]);
export const symbolMeta = pgTable("symbol_meta", {
  symbol: text("symbol").primaryKey(),
  name: text("name"),
  country: text("country"),
  industry: text("industry"),
  marketCap: numeric("market_cap", { precision: 20, scale: 0 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const portfolioVerdicts = pgTable("portfolio_verdicts", {
  verdictDate: date("verdict_date").notNull(),
  symbol: text("symbol").notNull(),
  verb: verbEnum("verb").notNull(),
  reason: text("reason").notNull(),
  narrative: text("narrative"),
  warning: text("warning"),
  close: numeric("close", { precision: 14, scale: 4 }).notNull(),
  spot: numeric("spot", { precision: 14, scale: 4 }),
  stop: numeric("stop", { precision: 14, scale: 4 }),
  target: numeric("target", { precision: 14, scale: 4 }),
  gainPct: numeric("gain_pct", { precision: 10, scale: 4 }).notNull(),
  weightPct: numeric("weight_pct", { precision: 8, scale: 4 }).notNull(),
  spyClose: numeric("spy_close", { precision: 14, scale: 4 }),
  degradedBy: text("degraded_by"),
  promptVersion: text("prompt_version"),
  close7d: numeric("close_7d", { precision: 14, scale: 4 }),
  spy7d: numeric("spy_7d", { precision: 14, scale: 4 }),
  alpha7dPct: numeric("alpha_7d_pct", { precision: 10, scale: 4 }),
  close30d: numeric("close_30d", { precision: 14, scale: 4 }),
  spy30d: numeric("spy_30d", { precision: 14, scale: 4 }),
  alpha30dPct: numeric("alpha_30d_pct", { precision: 10, scale: 4 }),
  measuredAt: timestamp("measured_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.verdictDate, t.symbol] })]);
export const portfolioRisk = pgTable("portfolio_risk", {
  snapshotDate: date("snapshot_date").primaryKey(),
  report: jsonb("report").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

(Importar `primaryKey` de `drizzle-orm/pg-core`.) Generar la migración: `pnpm db:generate` → renombrar el archivo a `0001_cartera.sql` **solo si** el journal lo permite (mejor dejar el nombre generado); aplicar con `pnpm db:migrate`. Actualizar `packages/db/src/schema.test.ts` si tiene test de paridad de enums (agregar `verb`, `market`, `layer` como enums propios de cartera, sin espejo en core más que los tipos).

Repo (`packages/db/src/repo.ts`, agregar al final de la clase). Conversión: `numeric` viaja como string → usar `num()`; al insertar, `str()`.

```ts
  // ---------- cartera ----------
  async positions(): Promise<Position[]> {
    const rows = await this.db.select().from(s.positions).orderBy(s.positions.symbol);
    return rows.map((r) => ({ symbol: r.symbol, quantity: num(r.quantity), avgCost: num(r.avgCost), currency: r.currency, market: r.market, layer: r.layer, notes: r.notes }));
  }
  async upsertPosition(p: Position): Promise<void> {
    const v = { symbol: p.symbol.toUpperCase(), quantity: str(p.quantity), avgCost: str(p.avgCost), currency: p.currency, market: p.market, layer: p.layer, notes: p.notes, updatedAt: new Date() };
    await this.db.insert(s.positions).values(v).onConflictDoUpdate({ target: s.positions.symbol, set: v });
  }
  async deletePosition(symbol: string): Promise<void> {
    await this.db.delete(s.positions).where(eq(s.positions.symbol, symbol.toUpperCase()));
  }
  async transactions(): Promise<Transaction[]> {
    const rows = await this.db.select().from(s.transactions).orderBy(desc(s.transactions.date));
    return rows.map((r) => ({ id: r.id, symbol: r.symbol, type: r.type, quantity: num(r.quantity), price: num(r.price), fees: num(r.fees), date: r.date, currency: r.currency, platform: r.platform, externalId: r.externalId, notes: r.notes }));
  }
  async insertTransactions(txs: Transaction[]): Promise<number> {
    if (!txs.length) return 0;
    const rows = await this.db.insert(s.transactions).values(txs.map((t) => ({ id: t.id, symbol: t.symbol.toUpperCase(), type: t.type, quantity: str(t.quantity), price: str(t.price), fees: str(t.fees), date: t.date, currency: t.currency, platform: t.platform, externalId: t.externalId, notes: t.notes }))).onConflictDoNothing().returning({ id: s.transactions.id });
    return rows.length;
  }
  async profile(symbol: string) {
    const r = (await this.db.select().from(s.symbolMeta).where(eq(s.symbolMeta.symbol, symbol.toUpperCase())))[0];
    return r ? { profile: { symbol: r.symbol, name: r.name, country: r.country, industry: r.industry, marketCap: r.marketCap === null ? null : num(r.marketCap) }, updatedAt: r.updatedAt.toISOString() } : null;
  }
  async saveProfile(p: SymbolProfile): Promise<void> {
    const v = { symbol: p.symbol.toUpperCase(), name: p.name, country: p.country, industry: p.industry, marketCap: p.marketCap === null ? null : str(p.marketCap), updatedAt: new Date() };
    await this.db.insert(s.symbolMeta).values(v).onConflictDoUpdate({ target: s.symbolMeta.symbol, set: v });
  }
  private verdictToRow(v: VerdictRow) {
    const n = (x: number | null) => (x === null ? null : str(x));
    return { verdictDate: v.verdictDate, symbol: v.symbol, verb: v.verb, reason: v.reason, narrative: v.narrative, warning: v.warning, close: str(v.close), spot: n(v.spot), stop: n(v.stop), target: n(v.target), gainPct: str(v.gainPct), weightPct: str(v.weightPct), spyClose: n(v.spyClose), degradedBy: v.degradedBy, promptVersion: v.promptVersion, close7d: n(v.close7d), spy7d: n(v.spy7d), alpha7dPct: n(v.alpha7dPct), close30d: n(v.close30d), spy30d: n(v.spy30d), alpha30dPct: n(v.alpha30dPct), measuredAt: v.measuredAt ? new Date(v.measuredAt) : null };
  }
  private rowToVerdict(r: typeof s.portfolioVerdicts.$inferSelect): VerdictRow {
    const n = (x: string | null) => (x === null ? null : num(x));
    return { verdictDate: r.verdictDate, symbol: r.symbol, verb: r.verb, reason: r.reason, narrative: r.narrative, warning: r.warning, close: num(r.close), spot: n(r.spot), stop: n(r.stop), target: n(r.target), gainPct: num(r.gainPct), weightPct: num(r.weightPct), spyClose: n(r.spyClose), degradedBy: r.degradedBy, promptVersion: r.promptVersion, close7d: n(r.close7d), spy7d: n(r.spy7d), alpha7dPct: n(r.alpha7dPct), close30d: n(r.close30d), spy30d: n(r.spy30d), alpha30dPct: n(r.alpha30dPct), measuredAt: r.measuredAt?.toISOString() ?? null };
  }
  async upsertVerdicts(rows: VerdictRow[]): Promise<void> {
    for (const v of rows) {
      const row = this.verdictToRow(v);
      const { verdictDate: _d, symbol: _s, close7d: _a, spy7d: _b, alpha7dPct: _c, close30d: _e, spy30d: _f, alpha30dPct: _g, measuredAt: _h, ...set } = row;
      await this.db.insert(s.portfolioVerdicts).values(row).onConflictDoUpdate({ target: [s.portfolioVerdicts.verdictDate, s.portfolioVerdicts.symbol], set });
    }
  }
  async latestVerdicts(): Promise<VerdictRow[]> {
    const last = (await this.db.select({ d: sql<string>`max(${s.portfolioVerdicts.verdictDate})` }).from(s.portfolioVerdicts))[0]?.d;
    if (!last) return [];
    return (await this.db.select().from(s.portfolioVerdicts).where(eq(s.portfolioVerdicts.verdictDate, last)).orderBy(s.portfolioVerdicts.symbol)).map((r) => this.rowToVerdict(r));
  }
  async verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]> {
    const col = horizon === 7 ? s.portfolioVerdicts.close7d : s.portfolioVerdicts.close30d;
    return (await this.db.select().from(s.portfolioVerdicts).where(and(sql`${s.portfolioVerdicts.verdictDate} <= ${before}`, sql`${col} is null`))).map((r) => this.rowToVerdict(r));
  }
  async setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void> {
    const set: Record<string, unknown> = { measuredAt: new Date() };
    for (const [k, v] of Object.entries(m)) set[k] = v === null || v === undefined ? null : str(v);
    await this.db.update(s.portfolioVerdicts).set(set).where(and(eq(s.portfolioVerdicts.verdictDate, verdictDate), eq(s.portfolioVerdicts.symbol, symbol)));
  }
  async allVerdicts(): Promise<VerdictRow[]> {
    return (await this.db.select().from(s.portfolioVerdicts).orderBy(desc(s.portfolioVerdicts.verdictDate))).map((r) => this.rowToVerdict(r));
  }
  async saveRisk(date: string, report: RiskReport): Promise<void> {
    await this.db.insert(s.portfolioRisk).values({ snapshotDate: date, report }).onConflictDoUpdate({ target: s.portfolioRisk.snapshotDate, set: { report } });
  }
  async latestRisk(): Promise<{ date: string; report: RiskReport } | null> {
    const r = (await this.db.select().from(s.portfolioRisk).orderBy(desc(s.portfolioRisk.snapshotDate)).limit(1))[0];
    return r ? { date: r.snapshotDate, report: r.report as RiskReport } : null;
  }
```

- [ ] **Step 4: Run test to verify it passes** → `DATABASE_URL=... pnpm exec vitest run packages/db` PASS; `pnpm --filter @thesis/db typecheck`; verificar limpieza (`select count(*) from positions` = 0).

- [ ] **Step 5: Commit** `git add packages/core/src/cartera/types.ts packages/db && git commit -m "feat(db): tablas de cartera, migración y repo"`.

---
### Task 7: Store de cartera, `runCartera` y `measureVerdicts` (pipeline)

**Files:**
- Modify: `packages/pipeline/src/store.ts` (interfaz `CarteraStore` + `MemoryStore`), `packages/pipeline/src/index.ts` (`export * from "./cartera.js"`)
- Create: `packages/pipeline/src/cartera.ts`, `packages/pipeline/test/cartera.test.ts`

**Interfaces:**
- Consumes: todo lo de core (Tasks 1–4), `Repo` implementa `CarteraStore` (Task 6).
- Produces:
  ```ts
  export interface CarteraStore { positions(); upsertPosition(p); deletePosition(symbol); transactions(); insertTransactions(t); profile(symbol); saveProfile(p); upsertVerdicts(rows); latestVerdicts(); verdictsToMeasure(before, horizon); setMeasurement(date, symbol, m); allVerdicts(); saveRisk(date, report); latestRisk(); recentFilingTitles(ticker: string, limit: number): Promise<string[]>; recentNewsTitles(query: string, limit: number): Promise<string[]> }
  export interface CarteraDeps { store: CarteraStore; history: PriceHistory; profiles: Profiles; narrator: PositionNarrator | null; spot: (symbol: string) => Promise<number | null>; log?: (m: string, extra?: unknown) => void }
  export interface CarteraSummary { date: string; verdicts: VerdictRow[]; risk: RiskReport; errors: Array<{ symbol: string; error: string }> }
  export function runCartera(deps: CarteraDeps, opts: { today: string }): Promise<CarteraSummary>
  export function measureVerdicts(deps: Pick<CarteraDeps, "store" | "history" | "log">, opts: { today: string }): Promise<{ measured7: number; measured30: number }>
  export function buildNarratorInput(...): NarratorInput   // puro, testeado indirectamente
  ```
- `recentFilingTitles` en Repo: `select title from raw_events where ticker = $1 and source = 'edgar' order by observed_at desc limit $2`. `recentNewsTitles`: `where source = 'ar_official' and title ilike '%' || $1 || '%'`. En `MemoryStore` se calculan sobre `events`.
- Algoritmo `runCartera`: (1) posiciones; vacío → summary vacío. (2) velas de SPY y de cada símbolo (`history.candles(sym, 260)`), en paralelo con `Promise.allSettled`; error → `errors` y la posición recibe REVISAR "sin velas". (3) spot por símbolo (`deps.spot`, null si falla). (4) perfiles: usar `store.profile` si tiene < 7 días; si no `profiles.profile` y guardar. (5) `buildRiskReport`. (6) por posición: `decideVerb` con `weightPct` del reporte de riesgo; `filings = store.recentFilingTitles(sym, 8)`; `news = store.recentNewsTitles(profileName ?? sym, 5)`; `riskFacts` = peso, país, pares correlacionados que la incluyan, aviso de concentración si aplica; narrador (si hay) con `try/catch` → `applyDegrade`; `degradedBy = "narrator"` si degradó. (7) `upsertVerdicts` + `saveRisk`. Fecha del veredicto = `opts.today`.
- Algoritmo `measureVerdicts`: para h en [7, 30]: `store.verdictsToMeasure(today − h días, h)`; agrupar por símbolo; para cada símbolo pedir `history.candles(sym, 60)` y SPY una vez; buscar la primera vela con `date ≥ verdictDate + h días` (calendario) para papel y SPY; si existen, `setMeasurement` con `alphaPct`. Si no hay vela todavía, saltar.

- [ ] **Step 1: Write the failing test** `packages/pipeline/test/cartera.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Candle, NarratorInput, Note, PositionNarrator, PriceHistory, Profiles } from "@thesis/core";
import { MemoryStore, measureVerdicts, runCartera } from "../src/index.js";

const mk = (closes: number[], start = "2026-06-01", volume = 1_000_000): Candle[] =>
  closes.map((c, i) => ({ date: new Date(Date.parse(start) + i * 86_400_000).toISOString().slice(0, 10), open: c, high: c + 1, low: c - 1, close: c, volume }));
const days = (n: number, v: number) => Array(n).fill(v);
const today = "2026-09-08"; // velas hasta 2026-09-07 con 99 puntos desde 2026-06-01

const history = (series: Record<string, Candle[]>): PriceHistory => ({ candles: async (s) => { const c = series[s]; if (!c) throw new Error(`sin velas ${s}`); return c; } });
const profiles: Profiles = { profile: async (s) => ({ symbol: s, name: `${s} Inc`, country: s === "YPF" ? "AR" : "US", industry: "Energy", marketCap: 1 }) };
const narrator = (note: Note | Error): PositionNarrator => ({ promptVersion: "n-test", narrate: async () => { if (note instanceof Error) throw note; return note; } });

function setup(narr: PositionNarrator | null, series?: Record<string, Candle[]>) {
  const store = new MemoryStore();
  const spy = mk(days(99, 500));
  const s = series ?? { SPY: spy, YPF: mk(days(99, 40)), TSM: mk(days(99, 400)) };
  return { store, deps: { store, history: history(s), profiles, narrator: narr, spot: async () => null } };
}

describe("runCartera", () => {
  it("emite un veredicto por posición, guarda riesgo y pesos", async () => {
    const { store, deps } = setup(narrator({ narrative: "Sin novedades en los filings recibidos.", degrade: false }));
    await store.upsertPosition({ symbol: "YPF", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null });
    await store.upsertPosition({ symbol: "TSM", quantity: 10, avgCost: 300, currency: "USD", market: "us", layer: "riesgo", notes: null });
    const s = await runCartera(deps, { today });
    expect(s.verdicts.map((v) => v.symbol).sort()).toEqual(["TSM", "YPF"]);
    expect(s.verdicts.every((v) => v.verb === "MANTENER")).toBe(true);
    expect(s.verdicts.find((v) => v.symbol === "YPF")!.weightPct).toBeCloseTo(50, 1);
    expect(s.verdicts[0]!.narrative).toContain("filings");
    expect(s.verdicts[0]!.spyClose).toBe(500);
    expect((await store.latestRisk())!.report.concentration.byCountry).toEqual({ AR: 50, US: 50 });
    expect(s.errors).toEqual([]);
  });
  it("sin velas de hoy → REVISAR; sin velas → REVISAR y error registrado", async () => {
    const { store, deps } = setup(null, { SPY: mk(days(99, 500)), OLD: mk(days(99, 10), "2026-05-01") });
    await store.upsertPosition({ symbol: "OLD", quantity: 1, avgCost: 1, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await store.upsertPosition({ symbol: "NONE", quantity: 1, avgCost: 1, currency: "USD", market: "us", layer: "riesgo", notes: null });
    const s = await runCartera(deps, { today });
    expect(s.verdicts.find((v) => v.symbol === "OLD")!.verb).toBe("REVISAR");
    expect(s.verdicts.find((v) => v.symbol === "NONE")!.verb).toBe("REVISAR");
    expect(s.errors).toEqual([{ symbol: "NONE", error: expect.stringContaining("sin velas") }]);
  });
  it("el modelo solo degrada: MANTENER → REVISAR con motivo; nunca sube", async () => {
    const { store, deps } = setup(narrator({ narrative: "n", degrade: true, degradeReason: "6-K con recorte de guidance" }));
    await store.upsertPosition({ symbol: "TSM", quantity: 10, avgCost: 300, currency: "USD", market: "us", layer: "riesgo", notes: null });
    const s = await runCartera(deps, { today });
    expect(s.verdicts[0]!.verb).toBe("REVISAR");
    expect(s.verdicts[0]!.degradedBy).toBe("narrator");
    expect(s.verdicts[0]!.reason).toContain("guidance");
  });
  it("si el narrador falla, el veredicto sale igual sin narrativa", async () => {
    const { store, deps } = setup(narrator(new Error("HTTP 503")));
    await store.upsertPosition({ symbol: "TSM", quantity: 10, avgCost: 300, currency: "USD", market: "us", layer: "riesgo", notes: null });
    const s = await runCartera(deps, { today });
    expect(s.verdicts[0]!.verb).toBe("MANTENER");
    expect(s.verdicts[0]!.narrative).toBeNull();
    expect(s.errors[0]!.error).toContain("503");
  });
  it("correr dos veces el mismo día reemplaza, no duplica", async () => {
    const { store, deps } = setup(null);
    await store.upsertPosition({ symbol: "TSM", quantity: 10, avgCost: 300, currency: "USD", market: "us", layer: "riesgo", notes: null });
    await runCartera(deps, { today });
    await runCartera(deps, { today });
    expect(await store.allVerdicts()).toHaveLength(1);
  });
});

describe("measureVerdicts", () => {
  it("completa 7d y 30d cuando hay vela posterior; no repite", async () => {
    const { store, deps } = setup(null);
    await store.upsertVerdicts([{ verdictDate: "2026-06-10", symbol: "TSM", verb: "MANTENER", reason: "r", narrative: null, warning: null, close: 400, spot: null, stop: null, target: null, gainPct: 0, weightPct: 100, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    const r = await measureVerdicts(deps, { today });
    expect(r).toEqual({ measured7: 1, measured30: 1 });
    const v = (await store.allVerdicts())[0]!;
    expect(v.close7d).toBe(400);
    expect(v.alpha7dPct).toBe(0);
    expect(v.alpha30dPct).toBe(0);
    expect(await measureVerdicts(deps, { today })).toEqual({ measured7: 0, measured30: 0 });
  });
  it("no mide si todavía no pasaron los días", async () => {
    const { store, deps } = setup(null);
    await store.upsertVerdicts([{ verdictDate: "2026-09-05", symbol: "TSM", verb: "MANTENER", reason: "r", narrative: null, warning: null, close: 400, spot: null, stop: null, target: null, gainPct: 0, weightPct: 100, spyClose: 500, degradedBy: null, promptVersion: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null }]);
    expect(await measureVerdicts(deps, { today })).toEqual({ measured7: 0, measured30: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → `pnpm exec vitest run packages/pipeline/test/cartera.test.ts` FAIL (`runCartera` no exportado).

- [ ] **Step 3: Write minimal implementation**

`packages/pipeline/src/store.ts` — agregar la interfaz y extender `MemoryStore`:

```ts
import type { Position, RiskReport, SymbolProfile, Transaction, VerdictRow } from "@thesis/core";

export interface CarteraStore {
  positions(): Promise<Position[]>;
  upsertPosition(p: Position): Promise<void>;
  deletePosition(symbol: string): Promise<void>;
  transactions(): Promise<Transaction[]>;
  insertTransactions(t: Transaction[]): Promise<number>;
  profile(symbol: string): Promise<{ profile: SymbolProfile; updatedAt: string } | null>;
  saveProfile(p: SymbolProfile): Promise<void>;
  upsertVerdicts(rows: VerdictRow[]): Promise<void>;
  latestVerdicts(): Promise<VerdictRow[]>;
  verdictsToMeasure(before: string, horizon: 7 | 30): Promise<VerdictRow[]>;
  setMeasurement(verdictDate: string, symbol: string, m: Partial<Pick<VerdictRow, "close7d" | "spy7d" | "alpha7dPct" | "close30d" | "spy30d" | "alpha30dPct">>): Promise<void>;
  allVerdicts(): Promise<VerdictRow[]>;
  saveRisk(date: string, report: RiskReport): Promise<void>;
  latestRisk(): Promise<{ date: string; report: RiskReport } | null>;
  recentFilingTitles(ticker: string, limit: number): Promise<string[]>;
  recentNewsTitles(query: string, limit: number): Promise<string[]>;
}
```

`MemoryStore implements Store, CarteraStore` con mapas `positionsMap`, `txs`, `profiles`, `verdicts` (clave `${date}|${symbol}`), `risks`; `verdictsToMeasure` filtra `verdictDate <= before && (h === 7 ? close7d : close30d) === null`; `recentFilingTitles` filtra `events` por ticker y `source === "edgar"`; `recentNewsTitles` por `source === "ar_official"` y título que incluya `query` (case-insensitive). `insertTransactions` dedupe por `externalId` o tupla.

`packages/pipeline/src/cartera.ts`:

```ts
import { alphaPct, applyDegrade, buildRiskReport, decideVerb, type Candle, type NarratorInput, type Position, type PositionNarrator, type PriceHistory, type Profiles, type RiskReport, type SymbolProfile, type VerdictRow } from "@thesis/core";
import type { CarteraStore } from "./store.js";

export interface CarteraDeps {
  store: CarteraStore;
  history: PriceHistory;
  profiles: Profiles;
  narrator: PositionNarrator | null;
  spot: (symbol: string) => Promise<number | null>;
  log?: (msg: string, extra?: unknown) => void;
}
export interface CarteraSummary { date: string; verdicts: VerdictRow[]; risk: RiskReport; errors: Array<{ symbol: string; error: string }> }

const DAY = 86_400_000;
const addDays = (iso: string, n: number) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const HISTORY_DAYS = 260;
const PROFILE_TTL_DAYS = 7;

async function profileFor(deps: CarteraDeps, p: Position, today: string): Promise<SymbolProfile | null> {
  const cached = await deps.store.profile(p.symbol);
  if (cached && (Date.parse(today) - Date.parse(cached.updatedAt)) / DAY < PROFILE_TTL_DAYS) return cached.profile;
  try {
    const fresh = await deps.profiles.profile(p.symbol);
    if (fresh) await deps.store.saveProfile(fresh);
    return fresh ?? cached?.profile ?? null;
  } catch {
    return cached?.profile ?? null;
  }
}

export function buildNarratorInput(p: Position, v: ReturnType<typeof decideVerb>, weightPct: number, candles: Candle[], filings: string[], news: string[], risk: RiskReport, profile: SymbolProfile | null): NarratorInput {
  const riskFacts = [`peso en cartera ${weightPct}%`];
  const country = profile?.country ?? (p.market === "us" ? "US" : "AR");
  const cShare = risk.concentration.byCountry[country];
  if (cShare !== undefined && cShare > 40) riskFacts.push(`el país ${country} concentra ${cShare}% de la cartera`);
  for (const pair of risk.correlatedPairs) if (pair.a === p.symbol || pair.b === p.symbol) riskFacts.push(`correlación ${pair.corr} con ${pair.a === p.symbol ? pair.b : pair.a}`);
  return { position: p, verb: v.verb, reason: v.reason, close: v.close, stop: v.stop, target: v.target, gainPct: v.gainPct, weightPct, last30: candles.slice(-30).map((c) => c.close), filings, news, riskFacts };
}

/** Veredicto diario de la cartera real: reglas → riesgo → narrativa (solo degrada) → persistencia. */
export async function runCartera(deps: CarteraDeps, opts: { today: string }): Promise<CarteraSummary> {
  const log = deps.log ?? (() => {});
  const errors: CarteraSummary["errors"] = [];
  const positions = await deps.store.positions();
  const emptyRisk: RiskReport = { totalValue: 0, weights: [], concentration: { byCountry: {}, byIndustry: {}, hhiCountry: 0, hhiIndustry: 0, warnings: [] }, correlatedPairs: [], betas: {}, portfolioBeta: null, stressSpyMinus20Pct: null, liquidity: [], notes: [] };
  if (!positions.length) return { date: opts.today, verdicts: [], risk: emptyRisk, errors };

  const candles: Record<string, Candle[]> = {};
  const fetched = await Promise.allSettled([...positions.map((p) => p.symbol), "SPY"].map(async (s) => [s, await deps.history.candles(s, HISTORY_DAYS)] as const));
  for (const r of fetched) {
    if (r.status === "fulfilled") candles[r.value[0]] = r.value[1];
    else errors.push({ symbol: String((r.reason as Error)?.message ?? r.reason).includes("SPY") ? "SPY" : "?", error: String(r.reason) });
  }
  for (const p of positions) if (!candles[p.symbol]) { errors.push({ symbol: p.symbol, error: `sin velas para ${p.symbol}` }); candles[p.symbol] = []; }
  const spy = candles["SPY"] ?? [];
  const spyClose = spy[spy.length - 1]?.close ?? null;

  const profiles: Record<string, SymbolProfile | null> = {};
  for (const p of positions) profiles[p.symbol] = await profileFor(deps, p, opts.today);
  const risk = buildRiskReport({ positions, candles, spy, profiles });

  const verdicts: VerdictRow[] = [];
  for (const p of positions) {
    const weightPct = risk.weights.find((w) => w.symbol === p.symbol)?.weightPct ?? 0;
    const spot = await deps.spot(p.symbol).catch(() => null);
    let v = decideVerb({ candles: candles[p.symbol]!, spot, avgCost: p.avgCost, layer: p.layer, weightPct, positionsCount: positions.length, today: opts.today });
    let narrative: string | null = null;
    let degradedBy: string | null = null;
    if (deps.narrator && candles[p.symbol]!.length) {
      try {
        const [filings, news] = await Promise.all([deps.store.recentFilingTitles(p.symbol, 8), deps.store.recentNewsTitles(profiles[p.symbol]?.name ?? p.symbol, 5)]);
        const note = await deps.narrator.narrate(buildNarratorInput(p, v, weightPct, candles[p.symbol]!, filings, news, risk, profiles[p.symbol] ?? null));
        narrative = note.narrative;
        const after = applyDegrade(v, note);
        if (after.verb !== v.verb) degradedBy = "narrator";
        v = after;
      } catch (e) {
        errors.push({ symbol: p.symbol, error: String(e) });
        log(`[cartera] narrador falló para ${p.symbol}`, { error: String(e) });
      }
    }
    verdicts.push({ verdictDate: opts.today, symbol: p.symbol, verb: v.verb, reason: v.reason, narrative, warning: v.warning, close: v.close, spot, stop: v.stop, target: v.target, gainPct: v.gainPct, weightPct, spyClose, degradedBy, promptVersion: deps.narrator?.promptVersion ?? null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, measuredAt: null });
    log(`[cartera] ${p.symbol} ${v.verb}`, { close: v.close, stop: v.stop });
  }
  await deps.store.upsertVerdicts(verdicts.filter((v) => Number.isFinite(v.close)).concat(verdicts.filter((v) => !Number.isFinite(v.close)).map((v) => ({ ...v, close: 0, gainPct: 0 }))));
  await deps.store.saveRisk(opts.today, risk);
  return { date: opts.today, verdicts, risk, errors };
}

/** Completa la medición a 7 y 30 días de los veredictos que ya tienen vela posterior. */
export async function measureVerdicts(deps: Pick<CarteraDeps, "store" | "history" | "log">, opts: { today: string }): Promise<{ measured7: number; measured30: number }> {
  const out = { measured7: 0, measured30: 0 };
  const cache = new Map<string, Candle[]>();
  const candlesOf = async (s: string) => { if (!cache.has(s)) cache.set(s, await deps.history.candles(s, 60).catch(() => [])); return cache.get(s)!; };
  const firstOnOrAfter = (c: Candle[], date: string) => c.find((x) => x.date >= date) ?? null;
  for (const h of [7, 30] as const) {
    const rows = await deps.store.verdictsToMeasure(addDays(opts.today, -h), h);
    for (const r of rows) {
      const target = addDays(r.verdictDate, h);
      const [own, spy] = await Promise.all([candlesOf(r.symbol), candlesOf("SPY")]);
      const a = firstOnOrAfter(own, target), b = firstOnOrAfter(spy, target);
      if (!a || !b || r.spyClose === null || r.close <= 0) continue;
      const alpha = alphaPct(r.close, a.close, r.spyClose, b.close);
      await deps.store.setMeasurement(r.verdictDate, r.symbol, h === 7 ? { close7d: a.close, spy7d: b.close, alpha7dPct: alpha } : { close30d: a.close, spy30d: b.close, alpha30dPct: alpha });
      if (h === 7) out.measured7++; else out.measured30++;
    }
  }
  return out;
}
```

Nota sobre el caso "sin velas": `decideVerb` devuelve `close: NaN`; se guarda como 0 con REVISAR para no romper `numeric`. Añadir `export * from "./cartera.js";` en `packages/pipeline/src/index.ts`. `Repo` necesita `recentFilingTitles` y `recentNewsTitles` (agregar en Task 6 si no se hizo: dos selects simples).

- [ ] **Step 4: Run test to verify it passes** → `pnpm exec vitest run packages/pipeline` PASS; typecheck pipeline y db (Repo debe satisfacer `CarteraStore`: agregar `Repo implements Store, CarteraStore`? `Repo` no declara `implements`; el container tipa `store: Store & CarteraStore` — verificar con typecheck de api en Task 9).

- [ ] **Step 5: Commit** `git add packages/pipeline packages/db && git commit -m "feat(pipeline): runCartera y medición de veredictos"`.

---

### Task 8: Narrador Gemini/Anthropic (reasoner)

**Files:**
- Create: `packages/reasoner/src/gemini/transport.ts`, `packages/reasoner/src/narrator.ts`, `packages/reasoner/test/narrator.test.ts`
- Modify: `packages/reasoner/src/gemini/index.ts` (usar el transport), `packages/reasoner/src/index.ts` (exports)

**Interfaces:**
- Produces:
  ```ts
  // transport.ts
  export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
  export class GeminiToolCaller { constructor(opts: { keys: string[]; models?: string[]; fetch?: typeof fetch; maxOutputTokens?: number; tracker?: QuotaTracker; log?: (m: string) => void; now?: () => number }); call(system: string, user: string, tool: ToolSpec): Promise<{ args: unknown; model: string; usage: string }> }
  // narrator.ts
  export const NOTE_TOOL: ToolSpec   // { narrative: string (maxLength 400), degrade: boolean, degradeReason?: string (minLength 10) }, additionalProperties false, required ["narrative","degrade"]
  export const NARRATOR_SYSTEM: string
  export const NARRATOR_VERSION: string            // `n1-<hash 12>` de system + tool
  export function buildNarratorMessage(i: NarratorInput): string
  export function parseNote(args: unknown): Note      // Zod: degrade true exige degradeReason; si no, lanza
  export class GeminiNarrator implements PositionNarrator { constructor(opts: ConstructorParameters<typeof GeminiToolCaller>[0]) }
  export class AnthropicNarrator implements PositionNarrator { constructor(opts: { apiKey?: string; model?: string }) }
  ```
- `GeminiReasoner` pasa a delegar en `GeminiToolCaller` (misma rotación; los tests de Task anterior siguen verdes).
- `NARRATOR_SYSTEM` (texto exacto):

```
Sos el analista de una cartera personal. Recibís UNA posición con el veredicto ya decidido por reglas (VENDER / REVISAR / MANTENER / SUMAR), sus números (cierre, stop, objetivo, ganancia, peso), los últimos 30 cierres, títulos de filings recientes, noticias y hechos de riesgo de la cartera.

Tu trabajo: escribir en español, en máximo dos oraciones, POR QUÉ ese veredicto tiene sentido hoy, citando los números que recibiste. No propongas otro verbo. No inventes datos: si algo no está en lo que recibiste, decí que no lo tenés. Nada de "podría", "posiblemente" sin un dato atrás.

Solo podés pedir DEGRADAR (degrade = true) si ves deterioro concreto en un filing o noticia recibidos (recorte de guidance, pérdida material, litigio nuevo, dilución, default). Entonces degradeReason debe citar ese título. Un precio que baja NO es motivo: de eso se ocupa el stop.

Respondé únicamente llamando a la herramienta position_note.
```

- [ ] **Step 1: Write the failing test** `packages/reasoner/test/narrator.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { NarratorInput } from "@thesis/core";
import { GeminiNarrator, NARRATOR_SYSTEM, NARRATOR_VERSION, NOTE_TOOL, buildNarratorMessage, parseNote } from "../src/index.js";

const input: NarratorInput = {
  position: { symbol: "YPF", quantity: 100, avgCost: 30, currency: "USD", market: "adr", layer: "riesgo", notes: null },
  verb: "MANTENER", reason: "Dejá correr.", close: 52.7, stop: 48.1, target: 61.9, gainPct: 75.6, weightPct: 22.5,
  last30: [50, 51, 52.7], filings: ["6-K — YPF S.A. dividendo"], news: ["YPF anunció inversión en Vaca Muerta"], riskFacts: ["peso en cartera 22.5%", "el país AR concentra 55% de la cartera"],
};

function fakeFetch(args: unknown) {
  const calls: any[] = [];
  const f = (async (_u: string, init?: RequestInit) => { calls.push(JSON.parse(String(init?.body))); return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "position_note", args } }] } }] }), { status: 200 }); }) as unknown as typeof fetch;
  return { f, calls };
}

describe("narrator", () => {
  it("el mensaje lleva verbo, números, filings, noticias y hechos de riesgo", () => {
    const m = buildNarratorMessage(input);
    for (const s of ["MANTENER", "52.7", "48.1", "61.9", "75.6", "22.5", "6-K", "Vaca Muerta", "concentra 55%"]) expect(m).toContain(s);
  });
  it("parseNote exige motivo cuando degrada y rechaza extras", () => {
    expect(parseNote({ narrative: "ok", degrade: false })).toEqual({ narrative: "ok", degrade: false });
    expect(() => parseNote({ narrative: "ok", degrade: true })).toThrow();
    expect(() => parseNote({ narrative: "ok", degrade: false, verb: "VENDER" })).toThrow();
  });
  it("GeminiNarrator manda system, mensaje y tool position_note forzada", async () => {
    const { f, calls } = fakeFetch({ narrative: "Sigue arriba del stop 48.1 con 75.6% de ganancia.", degrade: false });
    const note = await new GeminiNarrator({ keys: ["k"], fetch: f }).narrate(input);
    expect(note.degrade).toBe(false);
    expect(calls[0].systemInstruction.parts[0].text).toBe(NARRATOR_SYSTEM);
    expect(calls[0].tools[0].functionDeclarations[0].name).toBe(NOTE_TOOL.name);
    expect(calls[0].toolConfig.functionCallingConfig.allowedFunctionNames).toEqual(["position_note"]);
  });
  it("versión estable con hash", () => expect(NARRATOR_VERSION).toMatch(/^n1-[0-9a-f]{12}$/));
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`GeminiNarrator` no exportado).

- [ ] **Step 3: Write minimal implementation**

`packages/reasoner/src/gemini/transport.ts` — mover de `gemini/index.ts` la construcción del body y el parseo de la respuesta a una clase genérica:

```ts
import { QuotaTracker, withRotation } from "./rotation.js";

export interface ToolSpec { name: string; description: string; inputSchema: Record<string, unknown> }
export interface GeminiCallerOptions { keys: string[]; models?: string[]; fetch?: typeof fetch; maxOutputTokens?: number; tracker?: QuotaTracker; log?: (msg: string) => void; now?: () => number }
export const DEFAULT_GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-2.5-flash"];
const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

interface GenerateResponse { candidates?: Array<{ content?: { parts?: Array<{ functionCall?: { name: string; args: unknown } }> }; finishReason?: string }>; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }; error?: { status?: string; message?: string } }

/** Una llamada con function call forzado, con rotación de modelo+key. Compartido por razonador y narrador. */
export class GeminiToolCaller {
  private readonly keys: string[]; private readonly models: string[]; private readonly fetchFn: typeof fetch; private readonly maxOutputTokens: number; private readonly tracker: QuotaTracker; private readonly log: (m: string) => void; private readonly now: (() => number) | undefined;
  constructor(o: GeminiCallerOptions) {
    if (!o.keys.length) throw new Error("Gemini: sin keys (GOOGLE_AI_API_KEY_1..4)");
    this.keys = o.keys; this.models = o.models ?? DEFAULT_GEMINI_MODELS; this.fetchFn = o.fetch ?? fetch; this.maxOutputTokens = o.maxOutputTokens ?? 8000; this.tracker = o.tracker ?? new QuotaTracker(o.now); this.log = o.log ?? (() => {}); this.now = o.now;
  }
  async call(system: string, user: string, tool: ToolSpec): Promise<{ args: unknown; model: string; usage: string }> {
    const { result, model, keyIndex } = await withRotation({ models: this.models, keys: this.keys, tracker: this.tracker, log: this.log, ...(this.now ? { now: this.now } : {}), attempt: (m, key) => this.generate(m, key, system, user, tool) });
    this.log(`[gemini] ${model} key#${keyIndex + 1} ok (${result.usage})`);
    return { ...result, model };
  }
  private async generate(model: string, key: string, system: string, user: string, tool: ToolSpec) {
    const body = { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: user }] }], tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parametersJsonSchema: tool.inputSchema }] }], toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tool.name] } }, generationConfig: { maxOutputTokens: this.maxOutputTokens, temperature: 0.1 } };
    const res = await this.fetchFn(`${BASE}/${model}:generateContent`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok) throw new Error(`HTTP ${res.status} ${data.error?.status ?? ""} ${data.error?.message ?? ""}`.trim());
    const call = (data.candidates?.[0]?.content?.parts ?? []).find((p) => p.functionCall)?.functionCall;
    if (!call) throw new Error(`gemini: sin functionCall (finish=${data.candidates?.[0]?.finishReason ?? "?"})`);
    const u = data.usageMetadata ?? {};
    return { args: call.args, usage: `tokens in/out/think ${u.promptTokenCount ?? "?"}/${u.candidatesTokenCount ?? "?"}/${u.thoughtsTokenCount ?? "?"}` };
  }
}
```

`GeminiReasoner.propose` queda: `const { args } = await this.caller.call(SYSTEM_PROMPT, buildUserMessage(bundle, this.maxDocChars), { name: PROPOSE_TOOL.name, description: PROPOSE_TOOL.description ?? "", inputSchema: PROPOSE_TOOL.input_schema as Record<string, unknown> }); return parseProposal(args, bundle);` (el test existente que inspecciona `functionDeclarations[0]` debe seguir igual: mismo shape).

`packages/reasoner/src/narrator.ts`:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { NarratorInput, Note, PositionNarrator } from "@thesis/core";
import { GeminiToolCaller, type GeminiCallerOptions, type ToolSpec } from "./gemini/transport.js";

export const NARRATOR_SYSTEM = `...texto exacto de arriba...`;

export const NOTE_TOOL: ToolSpec = {
  name: "position_note",
  description: "Nota de dos oraciones sobre una posición, y si hay motivo concreto para degradar el veredicto a REVISAR.",
  inputSchema: { type: "object", additionalProperties: false, required: ["narrative", "degrade"], properties: { narrative: { type: "string", maxLength: 400 }, degrade: { type: "boolean" }, degradeReason: { type: "string", minLength: 10 } } },
};
export const NARRATOR_VERSION = `n1-${createHash("sha256").update(NARRATOR_SYSTEM).update(JSON.stringify(NOTE_TOOL)).digest("hex").slice(0, 12)}`;

const NoteSchema = z.object({ narrative: z.string().min(1).max(400), degrade: z.boolean(), degradeReason: z.string().min(10).optional() }).strict().refine((n) => !n.degrade || !!n.degradeReason, { message: "degrade exige degradeReason" });
export function parseNote(args: unknown): Note {
  const n = NoteSchema.parse(args);
  return n.degradeReason ? { narrative: n.narrative, degrade: n.degrade, degradeReason: n.degradeReason } : { narrative: n.narrative, degrade: n.degrade };
}

export function buildNarratorMessage(i: NarratorInput): string {
  const p = i.position;
  return [
    `# Posición\n${p.symbol} (${p.market}, capa ${p.layer}): ${p.quantity} a costo ${p.avgCost}`,
    `# Veredicto por reglas\n${i.verb}: ${i.reason}\ncierre ${i.close} · stop ${i.stop ?? "sin stop"} · objetivo ${i.target ?? "—"} · ganancia ${i.gainPct}% · peso ${i.weightPct}%`,
    `# Últimos 30 cierres\n${i.last30.join(", ")}`,
    `# Filings recientes\n${i.filings.length ? i.filings.map((f) => `- ${f}`).join("\n") : "(ninguno)"}`,
    `# Noticias\n${i.news.length ? i.news.map((n) => `- ${n}`).join("\n") : "(ninguna)"}`,
    `# Riesgo de cartera\n${i.riskFacts.map((r) => `- ${r}`).join("\n")}`,
    "Llamá a position_note.",
  ].join("\n\n");
}

export class GeminiNarrator implements PositionNarrator {
  readonly promptVersion = `${NARRATOR_VERSION}-gemini`;
  private readonly caller: GeminiToolCaller;
  constructor(opts: GeminiCallerOptions) { this.caller = new GeminiToolCaller({ maxOutputTokens: 2000, ...opts }); }
  async narrate(input: NarratorInput): Promise<Note> {
    const { args } = await this.caller.call(NARRATOR_SYSTEM, buildNarratorMessage(input), NOTE_TOOL);
    return parseNote(args);
  }
}

export class AnthropicNarrator implements PositionNarrator {
  readonly promptVersion = NARRATOR_VERSION;
  private readonly client: Anthropic; private readonly model: string;
  constructor(opts: { apiKey?: string; model?: string } = {}) { this.client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {}); this.model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? "claude-sonnet-5"; }
  async narrate(input: NarratorInput): Promise<Note> {
    const res = await this.client.messages.create({ model: this.model, max_tokens: 1000, system: NARRATOR_SYSTEM, tools: [{ name: NOTE_TOOL.name, description: NOTE_TOOL.description, input_schema: NOTE_TOOL.inputSchema as never }], tool_choice: { type: "tool", name: NOTE_TOOL.name }, messages: [{ role: "user", content: buildNarratorMessage(input) }] });
    const call = res.content.find((c) => c.type === "tool_use");
    if (!call || call.type !== "tool_use") throw new Error("narrator: sin tool_use");
    return parseNote(call.input);
  }
}
```

Exports en `packages/reasoner/src/index.ts`: `export * from "./narrator.js"; export { GeminiToolCaller, type ToolSpec } from "./gemini/transport.js";` (y `DEFAULT_GEMINI_MODELS` ahora sale de transport).

- [ ] **Step 4: Run test to verify it passes** → `pnpm exec vitest run packages/reasoner` PASS (los 32 previos + 4); typecheck reasoner.

- [ ] **Step 5: Commit** `git add packages/reasoner && git commit -m "feat(reasoner): narrador de posiciones (solo degrada) sobre transporte Gemini compartido"`.

---
### Task 9: Config, container, rutas `/cartera` y cron (api)

**Files:**
- Modify: `apps/api/src/config.ts` (`finnhubToken`, `carteraCron`), `apps/api/src/container.ts` (`history`, `profiles`, `narrator`, `carteraDeps`, `buildNarrator`), `apps/api/src/routes/index.ts` (montar), `apps/api/src/index.ts` (cron), `apps/api/src/config.test.ts` (narrador), `apps/api/src/routes/routes.test.ts` (container de prueba con `carteraDeps`)
- Create: `apps/api/src/routes/cartera.ts`, `apps/api/src/routes/cartera.test.ts`

**Interfaces:**
- `Config` suma `finnhubToken: string | undefined` (`FINNHUB_API_KEY`) y `carteraCron: string` (`CARTERA_CRON`, default `"45 7 * * 1-5"`).
- `Container` suma `carteraDeps: CarteraDeps` y `store: Store & CarteraStore`.
- `buildNarrator(r: ReasonerConfig): PositionNarrator` → `GeminiNarrator` o `AnthropicNarrator` (misma regla que `buildReasoner`).
- `buildContainer`: `history = new FallbackPriceHistory(new YahooPriceHistory(httpYahoo), new AlpacaPriceHistory(http, cfg.alpaca), console.log)` con `httpYahoo = createHttpClient({ userAgent: "Mozilla/5.0 (thesis-engine)" })` (Yahoo rechaza UA raros); `profiles = cfg.finnhubToken ? new FinnhubProfiles(http, cfg.finnhubToken) : NO_PROFILES`; `spot = async (s) => (await marketData.getQuote(s))?.price ?? null`.
- Rutas (`apps/api/src/routes/cartera.ts`, `export function carteraRoutes(c: Container): Hono`):
  - `GET /cartera/positions` → `Position[]`
  - `POST /cartera/positions` body Zod `{ symbol: string, quantity: number > 0, avgCost: number > 0, currency?: string, market: "us"|"adr"|"ar", layer?: "riesgo"|"nucleo"|"cobertura", notes?: string }` → upsert → 200 `{ ok: true }`; 400 con `error` si no valida.
  - `DELETE /cartera/positions/:symbol` → `{ ok: true }`
  - `GET /cartera/transactions`; `POST /cartera/transactions` body `{ symbol, type, quantity, price, fees?, date (YYYY-MM-DD), currency?, platform?, externalId?, notes? }` → `{ inserted: n }`
  - `POST /cartera/run` → `runCartera(c.carteraDeps, { today })` + `measureVerdicts` → `CarteraSummary & { measured: {...} }`
  - `GET /cartera/verdicts` → `latestVerdicts()`; `GET /cartera/risk` → `latestRisk()` (o `null`); `GET /cartera/measurement` → `summarizeMeasurement(await allVerdicts())` más `{ total: n }`.
- `routes/index.ts`: `app.route("/", carteraRoutes(c));`
- Cron en `index.ts`: `cron.schedule(cfg.carteraCron, async () => { const today = ...; try { const s = await runCartera(c.carteraDeps, { today }); const m = await measureVerdicts(c.carteraDeps, { today }); console.log(\`[cron] cartera: ${s.verdicts.length} veredictos, ${s.errors.length} errores, medidos ${m.measured7}/${m.measured30}\`); } catch (e) { console.error("[cron] cartera failed", e); } });`

- [ ] **Step 1: Write the failing tests**

En `apps/api/src/config.test.ts` agregar:

```ts
import { AnthropicNarrator, GeminiNarrator } from "@thesis/reasoner";
import { buildNarrator } from "./container.js";
describe("buildNarrator", () => {
  it("sigue la misma regla que el razonador", () => {
    expect(buildNarrator({ kind: "gemini", geminiKeys: ["g1"] })).toBeInstanceOf(GeminiNarrator);
    expect(buildNarrator({ kind: "anthropic", anthropicApiKey: "sk", geminiKeys: [] })).toBeInstanceOf(AnthropicNarrator);
  });
});
```

`apps/api/src/routes/cartera.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Candle } from "@thesis/core";
import { MemoryStore } from "@thesis/pipeline";
import { Hono } from "hono";
import { carteraRoutes } from "./cartera.js";
import type { Container } from "../container.js";

const mk = (n: number, close: number): Candle[] => Array.from({ length: n }, (_, i) => ({ date: new Date(Date.parse("2026-06-01") + i * 86_400_000).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1_000_000 }));
function app() {
  const store = new MemoryStore();
  const c = { store, carteraDeps: { store, history: { candles: async (s: string) => mk(99, s === "SPY" ? 500 : 40) }, profiles: { profile: async () => null }, narrator: null, spot: async () => null } } as unknown as Container;
  const a = new Hono();
  a.route("/", carteraRoutes(c));
  return a;
}
const today = new Date(Date.parse("2026-06-01") + 98 * 86_400_000).toISOString().slice(0, 10); // igual a la última vela

describe("/cartera", () => {
  it("alta → run → verdicts → risk → measurement → delete", async () => {
    const a = app();
    expect((await a.request("/cartera/positions", { method: "POST", body: JSON.stringify({ symbol: "ypf", quantity: 100, avgCost: 30, market: "adr" }) })).status).toBe(200);
    expect((await a.request("/cartera/positions", { method: "POST", body: JSON.stringify({ symbol: "ypf", quantity: -1, avgCost: 30, market: "adr" }) })).status).toBe(400);
    expect(await (await a.request("/cartera/positions")).json()).toHaveLength(1);
    const run = await (await a.request("/cartera/run", { method: "POST" })).json();
    expect(run.verdicts[0].symbol).toBe("YPF");
    expect(run.verdicts[0].verb).toBe("MANTENER");
    expect((await (await a.request("/cartera/verdicts")).json())).toHaveLength(1);
    expect((await (await a.request("/cartera/risk")).json()).report.totalValue).toBeGreaterThan(0);
    const m = await (await a.request("/cartera/measurement")).json();
    expect(m.total).toBe(1);
    expect(m.byVerb.MANTENER.h7.n).toBe(0);
    expect((await a.request("/cartera/positions/YPF", { method: "DELETE" })).status).toBe(200);
    expect(await (await a.request("/cartera/positions")).json()).toHaveLength(0);
  });
  it("operaciones: inserta y dedupea", async () => {
    const a = app();
    const tx = { symbol: "YPF", type: "BUY", quantity: 1, price: 2, date: "2026-01-02", externalId: "e1" };
    expect((await (await a.request("/cartera/transactions", { method: "POST", body: JSON.stringify(tx) })).json()).inserted).toBe(1);
    expect((await (await a.request("/cartera/transactions", { method: "POST", body: JSON.stringify(tx) })).json()).inserted).toBe(0);
    expect(await (await a.request("/cartera/transactions")).json()).toHaveLength(1);
  });
});
```

(El test usa `today` = última vela para que no sea stale; el handler de `/cartera/run` debe aceptar `?today=YYYY-MM-DD` opcional para tests, default hoy.)

- [ ] **Step 2: Run tests to verify they fail** → `pnpm exec vitest run apps/api` FAIL (`carteraRoutes`, `buildNarrator` no existen).

- [ ] **Step 3: Write minimal implementation** — `config.ts`: agregar campos y lectura de env. `container.ts`: `buildNarrator`, `history`, `profiles`, `carteraDeps` (con `narrator: buildNarrator(cfg.reasoner)` y `log: (m, x) => console.log(m, x ?? "")`), `store: Store & CarteraStore` (Repo debe cumplir ambas; si typecheck falla por `recentFilingTitles`, agregarlos en Repo). `routes/cartera.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import { summarizeMeasurement } from "@thesis/core";
import { measureVerdicts, runCartera } from "@thesis/pipeline";
import { randomUUID } from "node:crypto";
import type { Container } from "../container.js";

const PositionBody = z.object({ symbol: z.string().min(1).transform((s) => s.toUpperCase()), quantity: z.number().positive(), avgCost: z.number().positive(), currency: z.string().default("USD"), market: z.enum(["us", "adr", "ar"]), layer: z.enum(["riesgo", "nucleo", "cobertura"]).default("riesgo"), notes: z.string().nullable().default(null) });
const TxBody = z.object({ symbol: z.string().min(1).transform((s) => s.toUpperCase()), type: z.enum(["BUY", "SELL", "DIVIDEND", "TRANSFER"]), quantity: z.number().positive(), price: z.number().nonnegative(), fees: z.number().nonnegative().default(0), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), currency: z.string().default("USD"), platform: z.string().nullable().default(null), externalId: z.string().nullable().default(null), notes: z.string().nullable().default(null) });

export function carteraRoutes(c: Container) {
  const app = new Hono();
  const store = c.carteraDeps.store;
  app.get("/cartera/positions", async (ctx) => ctx.json(await store.positions()));
  app.post("/cartera/positions", async (ctx) => {
    const p = PositionBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    await store.upsertPosition(p.data);
    return ctx.json({ ok: true });
  });
  app.delete("/cartera/positions/:symbol", async (ctx) => { await store.deletePosition(ctx.req.param("symbol")); return ctx.json({ ok: true }); });
  app.get("/cartera/transactions", async (ctx) => ctx.json(await store.transactions()));
  app.post("/cartera/transactions", async (ctx) => {
    const p = TxBody.safeParse(await ctx.req.json().catch(() => ({})));
    if (!p.success) return ctx.json({ error: p.error.flatten() }, 400);
    return ctx.json({ inserted: await store.insertTransactions([{ id: randomUUID(), ...p.data }]) });
  });
  app.post("/cartera/run", async (ctx) => {
    const today = ctx.req.query("today") ?? new Date().toISOString().slice(0, 10);
    const s = await runCartera(c.carteraDeps, { today });
    const measured = await measureVerdicts(c.carteraDeps, { today });
    return ctx.json({ ...s, measured });
  });
  app.get("/cartera/verdicts", async (ctx) => ctx.json(await store.latestVerdicts()));
  app.get("/cartera/risk", async (ctx) => ctx.json(await store.latestRisk()));
  app.get("/cartera/measurement", async (ctx) => { const all = await store.allVerdicts(); return ctx.json({ total: all.length, ...summarizeMeasurement(all) }); });
  return app;
}
```

Ajustar `routes.test.ts` existente: el `container()` de prueba agrega `carteraDeps` (puede ser `{} as never` si no se ejercita).

- [ ] **Step 4: Run tests** → `pnpm exec vitest run apps/api` PASS; `pnpm typecheck` verde en todo el workspace.

- [ ] **Step 5: Commit** `git add apps/api && git commit -m "feat(api): rutas /cartera, narrador en container y cron 07:45"`.

---

### Task 10: Importación desde trading v1 (CLI)

**Files:**
- Create: `apps/api/src/import-v1.ts`, `apps/api/src/import-v1.test.ts`
- Modify: `apps/api/package.json` (script `"import:v1": "tsx src/import-v1.ts"`), raíz `package.json` (`"import:v1": "pnpm --filter @thesis/api import:v1"`)

**Interfaces:**
- Produces: `export function readV1(dbPath: string): { positions: Position[]; transactions: Transaction[] }` (puro sobre `node:sqlite`), `export async function importV1(store: CarteraStore, dbPath: string): Promise<{ positions: number; transactions: number }>`.
- Mapeo: `positions` ⟶ `{ symbol, quantity, avgCost: avg_cost, currency: "USD", market: symbols.type === "adr" ? "adr" : "us", layer: "riesgo", notes }`; `transactions` ⟶ `{ id: randomUUID(), symbol, type, quantity, price, fees, date, currency, platform, externalId: external_id, notes }` (tipos fuera de BUY/SELL/DIVIDEND/TRANSFER se descartan con aviso).
- CLI: `tsx src/import-v1.ts [dbPath]`, default `path.join(root, "..", "trading", "data", "trading.db")`; usa `loadConfig()` + `createDb` + `Repo`; imprime conteos; `process.exit(0)`.
- `node:sqlite`: `import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(path, { readOnly: true }); db.prepare("select ...").all()`. Node 24 lo trae; en Node 22 requiere `--experimental-sqlite` (documentar en README).

- [ ] **Step 1: Write the failing test** `apps/api/src/import-v1.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { MemoryStore } from "@thesis/pipeline";
import { importV1, readV1 } from "./import-v1.js";

function fakeV1(): string {
  const p = path.join(mkdtempSync(path.join(tmpdir(), "v1-")), "trading.db");
  const db = new DatabaseSync(p);
  db.exec(`create table symbols (symbol text primary key, name text, type text, flag text, plaza text, active integer, created_at text);
    create table positions (id integer primary key, symbol text, quantity real, avg_cost real, notes text, updated_at text);
    create table transactions (id integer primary key, symbol text, type text, quantity real, price real, fees real, date text, currency text, total_amount real, platform text, external_id text, notes text, created_at text);
    insert into symbols values ('YPF','YPF S.A.','adr','','argentina-energy',1,''),('TSM','TSMC','us','','global',1,'');
    insert into positions (symbol, quantity, avg_cost, notes, updated_at) values ('YPF', 557.35, 30.44, null, ''),('TSM', 26.5, 376.2, 'x', '');
    insert into transactions (symbol,type,quantity,price,fees,date,currency,total_amount,platform,external_id,notes,created_at) values ('YPF','TRANSFER',557.35,41.4,0,'2026-04-18','USD',null,'Nexo','n1',null,''),('TSM','BUY',1,300,0,'2026-05-01','USD',null,'Nexo',null,null,''),('TSM','WEIRD',1,1,0,'2026-05-02','USD',null,null,null,null,'');`);
  db.close();
  return p;
}

describe("import-v1", () => {
  it("lee posiciones con su mercado y operaciones válidas", () => {
    const { positions, transactions } = readV1(fakeV1());
    expect(positions).toEqual([
      { symbol: "TSM", quantity: 26.5, avgCost: 376.2, currency: "USD", market: "us", layer: "riesgo", notes: "x" },
      { symbol: "YPF", quantity: 557.35, avgCost: 30.44, currency: "USD", market: "adr", layer: "riesgo", notes: null },
    ]);
    expect(transactions.map((t) => t.type)).toEqual(["TRANSFER", "BUY"]);
    expect(transactions[0]!.externalId).toBe("n1");
  });
  it("importa idempotente", async () => {
    const store = new MemoryStore();
    const db = fakeV1();
    expect(await importV1(store, db)).toEqual({ positions: 2, transactions: 2 });
    expect(await importV1(store, db)).toEqual({ positions: 2, transactions: 0 });
    expect(await store.positions()).toHaveLength(2);
    expect(await store.transactions()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (`./import-v1.js` no existe).

- [ ] **Step 3: Write minimal implementation** `apps/api/src/import-v1.ts`

```ts
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Position, Transaction } from "@thesis/core";
import { Repo, createDb } from "@thesis/db";
import type { CarteraStore } from "@thesis/pipeline";
import { findRoot, loadConfig } from "./config.js";

const TX_TYPES = new Set(["BUY", "SELL", "DIVIDEND", "TRANSFER"]);

/** Lee posiciones y operaciones de la SQLite de trading v1. Puro salvo por el archivo. */
export function readV1(dbPath: string): { positions: Position[]; transactions: Transaction[] } {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const pos = db.prepare("select p.symbol, p.quantity, p.avg_cost, p.notes, s.type from positions p left join symbols s on s.symbol = p.symbol order by p.symbol").all() as Array<{ symbol: string; quantity: number; avg_cost: number; notes: string | null; type: string | null }>;
    const txs = db.prepare("select symbol, type, quantity, price, fees, date, currency, platform, external_id, notes from transactions order by date, id").all() as Array<{ symbol: string; type: string; quantity: number; price: number; fees: number | null; date: string; currency: string | null; platform: string | null; external_id: string | null; notes: string | null }>;
    return {
      positions: pos.map((p) => ({ symbol: p.symbol.toUpperCase(), quantity: p.quantity, avgCost: p.avg_cost, currency: "USD", market: p.type === "adr" ? "adr" : "us", layer: "riesgo", notes: p.notes })),
      transactions: txs.filter((t) => { const ok = TX_TYPES.has(t.type); if (!ok) console.warn(`[import] salteo ${t.symbol} ${t.type} ${t.date}: tipo desconocido`); return ok; })
        .map((t) => ({ id: randomUUID(), symbol: t.symbol.toUpperCase(), type: t.type as Transaction["type"], quantity: t.quantity, price: t.price, fees: t.fees ?? 0, date: t.date.slice(0, 10), currency: t.currency ?? "USD", platform: t.platform, externalId: t.external_id, notes: t.notes })),
    };
  } finally {
    db.close();
  }
}

export async function importV1(store: CarteraStore, dbPath: string): Promise<{ positions: number; transactions: number }> {
  const { positions, transactions } = readV1(dbPath);
  for (const p of positions) await store.upsertPosition(p);
  const inserted = await store.insertTransactions(transactions);
  return { positions: positions.length, transactions: inserted };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const root = await findRoot();
  const cfg = await loadConfig(root);
  const dbPath = process.argv[2] ?? path.join(root, "..", "trading", "data", "trading.db");
  const r = await importV1(new Repo(createDb(cfg.databaseUrl)), dbPath);
  console.log(`importadas ${r.positions} posiciones y ${r.transactions} operaciones nuevas desde ${dbPath}`);
  process.exit(0);
}
```

(`Repo` debe satisfacer `CarteraStore`; `MemoryStore.insertTransactions` dedupea por `externalId` y por tupla.) Scripts en `package.json`.

- [ ] **Step 4: Run test** → PASS; typecheck api.

- [ ] **Step 5: Commit** `git add apps/api package.json && git commit -m "feat(api): importación de cartera desde trading v1"`.

---

### Task 11: Pestaña Cartera (web)

**Files:**
- Create: `apps/web/src/Cartera.tsx`
- Modify: `apps/web/src/api.ts` (tipos y llamadas), `apps/web/src/App.tsx` (tab "cartera" primera y default), `apps/web/src/styles.css` (clases de verbo)

**Interfaces (api.ts):**
```ts
export interface Position { symbol: string; quantity: number; avgCost: number; currency: string; market: "us" | "adr" | "ar"; layer: "riesgo" | "nucleo" | "cobertura"; notes: string | null }
export interface Verdict { verdictDate: string; symbol: string; verb: "VENDER" | "REVISAR" | "MANTENER" | "SUMAR"; reason: string; narrative: string | null; warning: string | null; close: number; spot: number | null; stop: number | null; target: number | null; gainPct: number; weightPct: number; spyClose: number | null; degradedBy: string | null }
export interface RiskReport { totalValue: number; weights: Array<{ symbol: string; value: number; weightPct: number }>; concentration: { byCountry: Record<string, number>; byIndustry: Record<string, number>; warnings: string[] }; correlatedPairs: Array<{ a: string; b: string; corr: number }>; betas: Record<string, number | null>; portfolioBeta: number | null; stressSpyMinus20Pct: number | null; liquidity: Array<{ symbol: string; avgDollarVolume30d: number | null; daysToLiquidate: number | null }>; notes: string[] }
export interface Measurement { total: number; pending: number; byVerb: Record<string, { h7: { n: number; hitRate: number | null; avgAlpha: number | null }; h30: { n: number; hitRate: number | null; avgAlpha: number | null } }> }
api.cartera = { positions, upsertPosition(p), deletePosition(symbol), run(), verdicts(), risk(), measurement() }
```
- UI (`Cartera.tsx`, componente `Cartera`): carga posiciones, veredictos, riesgo y medición; tabla con columnas símbolo · cant. · costo · cierre · ganancia % (verde/rojo) · peso % · **verbo** (`<span className={"verb " + verb}>`) · stop · objetivo · botón *Ver* (despliega `reason`, `narrative`, `warning`) · *Editar* · *Borrar*. Fila de formulario (símbolo, cantidad, costo, mercado, capa, notas) para alta/edición. Botón *Actualizar veredictos* (POST run, muestra resumen y errores). Tarjeta *Riesgo* con: valor total, beta de cartera, estrés −20%, avisos, concentración por país e industria, pares correlacionados, liquidez (días para liquidar). Tarjeta *Medición contra SPY* con tabla verbo × horizonte (n, acierto, alpha medio) y la nota "los MANTENER diarios están correlacionados; leé la tendencia, no el n" y "pendientes: N".
- Estilos: `.verb { padding: 2px 8px; border-radius: 999px; font-weight: 600; font-size: 12px }`, `.verb.VENDER { background: var(--bad); color: #fff }`, `.verb.REVISAR { background: #b8860b; color: #fff }`, `.verb.MANTENER { border: 1px solid var(--line) }`, `.verb.SUMAR { background: var(--ok); color: #fff }`.
- `App.tsx`: `type Tab = "cartera" | "proposed" | ...`; default `"cartera"`; etiqueta "Cartera"; `{tab === "cartera" && <Cartera />}`.

- [ ] **Step 1: Escribir `api.ts` y `Cartera.tsx`** (sin test unitario de UI en este repo; verificación: `pnpm --filter @thesis/web typecheck` y prueba manual en el navegador).
- [ ] **Step 2: `pnpm --filter @thesis/web typecheck`** → sin errores.
- [ ] **Step 3: Prueba manual**: con la API corriendo, abrir http://localhost:5173, pestaña Cartera: alta de una posición, *Actualizar veredictos*, ver verbo, stop, objetivo, riesgo. Corregir lo que no se vea.
- [ ] **Step 4: Commit** `git add apps/web && git commit -m "feat(web): pestaña Cartera con veredictos, riesgo y medición"`.

---

### Task 12: Importar la cartera real, primera corrida y documentación

**Files:**
- Modify: `README.md` (sección Cartera: qué hace, importación, cron, medición), `.env.example` (`FINNHUB_API_KEY=`, `CARTERA_CRON`), `.env` (FINNHUB key desde `trading/.env` si se quiere perfil por industria)

- [ ] **Step 1: Migrar y correr suite completa**: `pnpm db:migrate` y `DATABASE_URL=... pnpm test` → todo verde; `pnpm typecheck` verde.
- [ ] **Step 2: Importar**: `pnpm import:v1` → "importadas 8 posiciones y 34 operaciones". Verificar con `GET /cartera/positions`.
- [ ] **Step 3: Primera corrida real**: reiniciar `pnpm dev:api`; `curl -X POST localhost:3002/cartera/run` → 8 veredictos, revisar en la UI: verbos, stops, riesgo (esperado: aviso de concentración AR > 40%, pares correlacionados entre ADRs y entre mineras de bitcoin), narrativas de Gemini.
- [ ] **Step 4: README y .env.example** actualizados con la sección Cartera; nota sobre `node:sqlite` en Node 22 (`--experimental-sqlite`).
- [ ] **Step 5: Commit** `git add README.md .env.example && git commit -m "docs: cartera etapa 1"`.

---

## Self-review

- **Spec coverage:** §1 principios → Tasks 2, 7, 8 (degrade only, fail-closed, medición). §3.1 tablas → Task 6. §3.2 fuentes → Task 5 (+ spot en Task 9). §3.3 importación → Task 10. §4 reglas → Tasks 1–2. §5 riesgo → Task 3. §6 narrativa → Task 8 (+ integración en 7). §7 medición → Tasks 4 y 7. §8 API/UI/cron → Tasks 9 y 11. §9 tests → en cada task. §10 riesgos → Yahoo con respaldo (Task 5), stale (Task 2), nota de medición en UI (Task 11).
- **Placeholders:** el texto de `NARRATOR_SYSTEM` se copia literal desde Task 8 (marcado "texto exacto de arriba"); no hay TBD.
- **Type consistency:** `VerdictRow`/`Transaction` definidos en core (Task 6) y usados por db, pipeline, api y web con los mismos nombres; `CarteraStore` (Task 7) = métodos de `Repo` (Task 6) + `recentFilingTitles`/`recentNewsTitles`; `CarteraDeps.spot` es `(symbol) => Promise<number | null>` en Tasks 7 y 9; `ToolSpec.inputSchema` en Task 8 coincide con `PROPOSE_TOOL.input_schema` (cast).
