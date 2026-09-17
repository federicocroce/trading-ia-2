# Lo que la app no ve — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el Radar llegue solo a lo que el informe `/mercado` del 17/9 encontró a mano: mire 300 en vez de 150, no diga COMPRAR de una empresa vendida por contrato, y pueda leer hechos externos verificados (guía, reservas, ofertas) que un agente semanal le acerca.

**Architecture:** reglas puras en `packages/core` (`oferta.ts`, `hechos.ts`, `candidate.ts`, `conviction.ts`); un adaptador nuevo de EDGAR en `packages/adapters`; una tabla nueva y sus métodos en `packages/db` y en `MemoryStore`; el cableado en `packages/pipeline` (`radar.ts`, `mercado.ts`, `ticker.ts`, `hechos.ts`); el contenedor, el CLI y la config en `apps/api`; etiquetas y una sección en `apps/web`; la skill `/hechos` y el agente de launchd en `.claude/skills` y `scripts/launchd`.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, zod, Postgres con drizzle (migraciones SQL a mano + `_journal.json`), Hono, React, launchd, Claude Code CLI (`claude -p`).

**Spec:** `docs/superpowers/specs/2026-09-17-lo-que-la-app-no-ve-design.md`

## Global Constraints

- Trabajar en un worktree aparte (`superpowers:using-git-worktrees`, rama `feat-lo-que-la-app-no-ve`): otras sesiones editan este repo. Nunca `git add -A`; siempre rutas explícitas.
- Test primero, después el código, después el commit. Un commit por tarea, mensaje en español rioplatense con el caso real que lo motiva.
- Nunca correr `rank` ni `refresh` del Radar a mano (el 15/9 dejó el Radar con 5 filas). Lo que se verifica contra la base se hace con `mercado` (no escribe) o leyendo tablas.
- Tests de integración contra Postgres SOLO con `pnpm test:db` (base `thesis_test`). Nunca con `DATABASE_URL` de la app.
- Antes de mergear: `pnpm verificar` (tests y tipos de todos los paquetes) en verde. Se mergea con `git push . HEAD:master` desde el worktree (el hook `pre-push` vuelve a correr `verificar`).
- Pesos de las banderas nuevas: `guia_subida` +0,2 (como `sorpresa_positiva`); `guia_recortada` y `ganancia_por_reservas` −0,3 (como `sorpresa_negativa`). Ventanas: guía 90 días, reservas 120, oferta 400. Puerta de entrada: tope 20 símbolos.
- `candidates.preselect` = 300; `top` (40) y `maxRows` (80) no cambian.
- Las reglas actúan SOLO sobre hechos con `estado: "verificado"`. Lo `no_verificado` se muestra y no mueve nada.
- El mecanismo de hechos escribe una sola tabla: `hechos_externos`. Nada más.
- Textos en español rioplatense; banderas como nombres estables con etiqueta en `apps/web/src/flagLabels.ts`.
- Correr `pnpm exec vitest run <archivo>` para el test de la tarea y `pnpm -r --no-bail typecheck` antes de cada commit.

---

### Task 0: Worktree

- [ ] **Step 1: Crear el worktree y la rama**

```bash
cd "/Users/federicocroce/Docu/Fede/trading v2/thesis-engine"
git worktree add .claude/worktrees/feat-lo-que-la-app-no-ve -b feat-lo-que-la-app-no-ve master
cd .claude/worktrees/feat-lo-que-la-app-no-ve
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"
pnpm install --frozen-lockfile
pnpm exec vitest run packages/core/src/radar/seleccion.test.ts
```

Expected: install ok; el test de selección pasa. Todas las tareas siguientes corren dentro de este directorio.

---

### Task 1: Preselección de 300 (P2)

**Files:**
- Modify: `config/radar-policy.json` (`candidates.preselect`: 150 → 300)
- Test: `packages/core/src/radar/policy-real.test.ts` (nuevo)

**Interfaces:**
- Consumes: `RadarPolicySchema` de `packages/core/src/radar/taxonomy.ts`.
- Produces: nada; es config.

- [ ] **Step 1: Escribir el test que lee el config real**

`packages/core/src/radar/policy-real.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RadarPolicySchema } from "./taxonomy.js";

/**
 * El config REAL, no un fixture. El 16/9 `maxRows` viajaba en el JSON y el esquema lo descartaba en silencio: el
 * arreglo del corte no se notaba. Y el 17/9 el informe de /mercado midió que ocho de diez finalistas quedaban entre
 * los puestos 177 y 238: con `preselect` 150 la app nunca los evaluaba (RNR 178, HG 183, ARW 185, GL 204, ESNT 212,
 * IOSP 221, ARGX 238).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const policy = RadarPolicySchema.parse(JSON.parse(readFileSync(path.join(root, "config/radar-policy.json"), "utf8")));

describe("config/radar-policy.json (el real)", () => {
  it("preselecciona al menos 300: los finalistas del 17/9 (puestos 177 a 238) entran a la evaluación", () => {
    expect(policy.candidates.preselect).toBeGreaterThanOrEqual(300);
  });
  it("mantiene el corte de 40 filas por puntaje y el tope de 80: cada fila más es una ficha del modelo", () => {
    expect(policy.candidates.top).toBe(40);
    expect(policy.candidates.maxRows).toBe(80);
  });
});
```

- [ ] **Step 2: Correr el test y verlo fallar**

Run: `pnpm exec vitest run packages/core/src/radar/policy-real.test.ts`
Expected: FAIL en "preselecciona al menos 300" (150 < 300).

- [ ] **Step 3: Cambiar el config**

En `config/radar-policy.json`, dentro de `"candidates"`: `"preselect": 300`.

- [ ] **Step 4: Correr el test y verlo pasar**

Run: `pnpm exec vitest run packages/core/src/radar/policy-real.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add config/radar-policy.json packages/core/src/radar/policy-real.test.ts
git commit -m "feat(radar): preselección de 300, con el config real bajo test

El 17/9 ocho de diez finalistas de /mercado quedaban entre los puestos 177 y
238: con 150 la app no los evaluaba nunca. Medido: los estados de la SEC que
pide el ranking pasan de 2.090 a 2.404 símbolos (pares incluidos) y quedan en
caché 7 días; las velas suman 150 por día. top y maxRows no cambian: cada fila
guardada cuesta una ficha del modelo el día del ranking."
```

---

### Task 2: Adaptador `EdgarOfferForms` (P5b, la consulta en vivo)

**Files:**
- Create: `packages/adapters/src/edgar/ofertas.ts`
- Modify: `packages/adapters/src/index.ts` (export)
- Test: `packages/adapters/test/adapters.test.ts` (describe nuevo)

**Interfaces:**
- Consumes: `HttpClient` (`getJson`), `CikResolver` de `./statements.js`, fixtures `E.companyTickersAES` y `E.submissionsAES` (ya existen: DEFM14A del 15/5/2026, PREM14A, DEF 14A, 8-K del 16/9, 10-Q).
- Produces: `class EdgarOfferForms { constructor(http: HttpClient, resolver?: CikResolver); offerFilingTitles(ticker: string, opts?: { today?: string; windowDays?: number }): Promise<string[]> }`. Títulos con el formato del ingestor: `"<formulario> — <nombre>"`.

- [ ] **Step 1: Escribir el test**

Agregar al final de `packages/adapters/test/adapters.test.ts` (los imports de `fixtureHttpClient` y `E` ya están; agregar `EdgarOfferForms` al import de `../src/edgar/index.js` → cambiarlo por `import { EdgarIngestor, fetchFilingText, filingUrl, htmlToText } from "../src/edgar/index.js"; import { EdgarOfferForms } from "../src/edgar/ofertas.js";`):

```ts
/**
 * 17/9: la regla `bajoOfertaDeCompra` existía pero sólo recibía formularios del universo de ingesta (posiciones,
 * seguimiento, plan y COMPRAR del Radar). Seis empresas vendidas por contrato (AES, WTRG, ROKU, DV, BZH, BWMN) recibían
 * franja, stop y objetivo. Esta consulta mira EDGAR en vivo para cualquier símbolo, sin escribir nada.
 */
describe("EdgarOfferForms", () => {
  const fixtures = {
    "https://www.sec.gov/files/company_tickers.json": E.companyTickersAES,
    "https://data.sec.gov/submissions/CIK0000874761.json": E.submissionsAES,
  };
  it("devuelve los formularios de oferta de los últimos 400 días con el formato del ingestor; el DEF 14A anual no", async () => {
    const titulos = await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("aes", { today: "2026-09-17" });
    expect(titulos.some((t) => t.startsWith("DEFM14A — "))).toBe(true);
    expect(titulos.some((t) => t.startsWith("PREM14A — "))).toBe(true);
    expect(titulos.every((t) => !t.startsWith("DEF 14A"))).toBe(true);
    expect(titulos.every((t) => !t.startsWith("8-K") && !t.startsWith("10-Q"))).toBe(true);
    expect(titulos[0]).toMatch(/ — AES CORP$/);
  });
  it("fuera de la ventana no devuelve nada", async () => {
    expect(await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("AES", { today: "2028-01-01" })).toEqual([]);
  });
  it("símbolo sin CIK → vacío, sin error", async () => {
    expect(await new EdgarOfferForms(fixtureHttpClient(fixtures)).offerFilingTitles("NOPE", { today: "2026-09-17" })).toEqual([]);
  });
  it("cachea por símbolo dentro del proceso: dos consultas, un pedido de submissions", async () => {
    let pedidos = 0;
    const base = fixtureHttpClient(fixtures);
    const http = { ...base, getJson: async <T,>(url: string) => { if (url.includes("/submissions/")) pedidos++; return base.getJson<T>(url); } };
    const o = new EdgarOfferForms(http);
    await o.offerFilingTitles("AES", { today: "2026-09-17" });
    await o.offerFilingTitles("AES", { today: "2026-09-17" });
    expect(pedidos).toBe(1);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/adapters/test/adapters.test.ts`
Expected: FAIL: no existe `../src/edgar/ofertas.js`.

- [ ] **Step 3: Implementar**

`packages/adapters/src/edgar/ofertas.ts`:

```ts
import type { HttpClient } from "../http/index.js";
import { CikResolver } from "./statements.js";

/**
 * Formularios que existen SÓLO cuando hay una fusión o una oferta de compra en curso. Son la prueba dura de que el
 * precio lo fija un acuerdo (AES a 15,00 en efectivo, 16/9; WTRG a 0,305 acciones de AWK, 17/9). El `DEF 14A` es el
 * poder de la asamblea anual y lo presenta toda empresa: no cuenta. Misma lista que `bajoOfertaDeCompra` en core.
 */
export const FORMULARIOS_DE_OFERTA = ["DEFM14A", "PREM14A", "SC 14D9", "425"] as const;
/** Una oferta firmada hace meses sigue fijando el precio hoy (AES: DEFM14A del 15/5 seguía vigente en septiembre). */
export const VENTANA_OFERTA_DIAS = 400;

interface Submissions {
  name: string;
  filings: { recent: { accessionNumber: string[]; filingDate: string[]; form: string[]; items?: string[] } };
}
const submissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`;
const DAY = 86_400_000;

/**
 * Consulta en vivo a EDGAR: los títulos de los formularios de oferta de un símbolo, con el mismo formato que guarda el
 * ingestor (`"<formulario>[ (items …)] — <empresa>"`), para que `bajoOfertaDeCompra` los lea igual. Un pedido por
 * símbolo (más la tabla de CIKs, que se cachea), y el resultado se cachea por símbolo dentro del proceso: el ranking
 * pregunta por cada fila de la preselección y después por cada fila guardada. No escribe nada.
 */
export class EdgarOfferForms {
  private readonly resolver: CikResolver;
  private readonly cache = new Map<string, Promise<string[]>>();
  constructor(private readonly http: HttpClient, resolver?: CikResolver) {
    this.resolver = resolver ?? new CikResolver(http);
  }

  async offerFilingTitles(ticker: string, opts: { today?: string; windowDays?: number } = {}): Promise<string[]> {
    const sym = ticker.toUpperCase();
    const key = `${sym}|${opts.today ?? ""}|${opts.windowDays ?? ""}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.lookup(sym, opts).catch((e) => { this.cache.delete(key); throw e; });
      this.cache.set(key, p);
    }
    return p;
  }

  private async lookup(sym: string, opts: { today?: string; windowDays?: number }): Promise<string[]> {
    const cik = await this.resolver.resolve(sym);
    if (!cik) return [];
    const sub = await this.http.getJson<Submissions>(submissionsUrl(cik));
    const hoy = Date.parse(opts.today ?? new Date().toISOString().slice(0, 10));
    const desde = new Date(hoy - (opts.windowDays ?? VENTANA_OFERTA_DIAS) * DAY).toISOString().slice(0, 10);
    const r = sub.filings.recent;
    const out: string[] = [];
    for (let i = 0; i < r.form.length; i++) {
      const form = r.form[i]!;
      if (!(FORMULARIOS_DE_OFERTA as readonly string[]).includes(form)) continue;
      const fecha = r.filingDate[i]!;
      if (fecha < desde || fecha > new Date(hoy).toISOString().slice(0, 10)) continue;
      const items = r.items?.[i] ?? "";
      out.push(`${form}${items ? ` (items ${items})` : ""} — ${sub.name}`);
    }
    return out;
  }
}
```

En `packages/adapters/src/index.ts` agregar `export * from "./edgar/ofertas.js";` después de la línea de `./edgar/statements.js`.

- [ ] **Step 4: Correr y ver pasar**

Run: `pnpm exec vitest run packages/adapters/test/adapters.test.ts`
Expected: PASS (los 4 tests nuevos y los anteriores).

- [ ] **Step 5: Commit**

```bash
git add packages/adapters/src/edgar/ofertas.ts packages/adapters/src/index.ts packages/adapters/test/adapters.test.ts
git commit -m "feat(edgar): consulta en vivo de formularios de oferta de compra por símbolo

La regla existía desde el 16/9 pero sólo recibía formularios del universo de
ingesta. El 17/9 el comando mercado calculó franja, stop y objetivo a seis
empresas vendidas por contrato (AES, WTRG, ROKU, DV, BZH, BWMN). Un pedido por
símbolo, cacheado en el proceso, sin escribir nada."
```

---

### Task 3: Bajo oferta → OBSERVAR (núcleo)

**Files:**
- Modify: `packages/core/src/radar/candidate.ts` (`decideCandidate`, la línea que arma `reasons`)
- Test: `packages/core/src/radar/candidate.test.ts`

**Interfaces:**
- Consumes: `decideCandidate(i, p)` y su entrada `filings?: readonly string[]` (ya existen).
- Produces: con `bajo_oferta_de_compra`, `verdict` es `"OBSERVAR"` y `reasons` lo incluye. `PLAN_BLOCKERS` queda igual.

- [ ] **Step 1: Escribir el test**

En `packages/core/src/radar/candidate.test.ts`, agregar un `describe` al final (usa `up`, `today`, `tech`, `sizing`, `f` que ya están definidos arriba en ese archivo):

```ts
/**
 * 17/9: ROKU con el DEFM14A del 1/9 (Fox paga 96 en efectivo más 0,9693 FOXA) seguía COMPRAR con objetivo 170,99.
 * Una fila que dice COMPRAR se compra (regla del 14/9), y un precio fijado por contrato no es una compra: la oferta
 * pasa a ser motivo de OBSERVAR, no sólo bloqueo del plan.
 */
describe("decideCandidate bajo oferta de compra", () => {
  const p = { technical: tech, sizing, candidates: { top: 40, preselect: 150, chronicWeeks: 4 } };
  it("con un DEFM14A la fila queda OBSERVAR y dice por qué", () => {
    const d = decideCandidate({ f: f({ symbol: "ROKU" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, filings: ["DEFM14A — ROKU, INC."] }, p);
    expect("excluded" in d).toBe(false);
    if ("excluded" in d) return;
    expect(d.verdict).toBe("OBSERVAR");
    expect(d.flags).toContain("bajo_oferta_de_compra");
    expect(d.reasons).toContain("bajo_oferta_de_compra");
  });
  it("sin formularios de oferta sigue COMPRAR", () => {
    const d = decideCandidate({ f: f(), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, filings: ["10-Q — Empresa Inc."] }, p);
    if ("excluded" in d) throw new Error("no debería excluir");
    expect(d.verdict).toBe("COMPRAR");
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/core/src/radar/candidate.test.ts`
Expected: FAIL: `verdict` es "COMPRAR" en el primer test.

- [ ] **Step 3: Implementar**

En `packages/core/src/radar/candidate.ts`, en `decideCandidate`, reemplazar la línea que arma `reasons`:

```ts
  // La verificación web que dice "evitar" observa por sí sola, como un evento grave. Y una empresa bajo oferta de
  // compra también (17/9): una fila que dice COMPRAR se compra, y un precio fijado por contrato no es una compra.
  const reasons = [...gate.reasons, ...(flags.includes("residente_cronico") ? ["residente_cronico"] : []), ...(flags.includes("evento_grave") ? ["evento_grave"] : []), ...(flags.includes("verificacion_evitar") ? ["verificacion_evitar"] : []), ...(flags.includes("bajo_oferta_de_compra") ? ["bajo_oferta_de_compra"] : [])];
```

- [ ] **Step 4: Correr y ver pasar; typecheck**

Run: `pnpm exec vitest run packages/core && pnpm --filter @thesis/core typecheck`
Expected: PASS. Si algún test existente esperaba COMPRAR con un DEFM14A (buscar `bajo_oferta` en `packages/core/src/radar/*.test.ts` y en `packages/pipeline/test`), actualizarlo a OBSERVAR con un comentario que cite el 17/9.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/radar/candidate.ts packages/core/src/radar/candidate.test.ts
git commit -m "fix(radar): una empresa bajo oferta de compra es OBSERVAR, no COMPRAR con bloqueo

ROKU el 17/9: DEFM14A del 1/9 y la fila decía COMPRAR con objetivo 170,99
contra 96 en efectivo más 0,9693 FOXA. COMPRAR tiene un solo significado (14/9):
si la pantalla lo dice, se compra. El bloqueo del plan queda como segunda
defensa."
```

---

### Task 4: Hechos externos en el núcleo (tipos, esquema, reglas, puerta)

**Files:**
- Create: `packages/core/src/radar/hechos.ts`
- Modify: `packages/core/src/radar/index.ts` (export), `packages/core/src/radar/candidate.ts` (`buildFlags` y `decideCandidate` reciben `hechos`), `packages/core/src/radar/conviction.ts` (`POSITIVE`, `NEGATIVE`, `INFO`)
- Test: `packages/core/src/radar/hechos.test.ts` (nuevo), `packages/core/src/radar/conviction.test.ts` (agregar un caso; si el archivo no existe, crearlo con el caso de abajo)

**Interfaces:**
- Produces (todo exportado desde `@thesis/core`):
  - `HECHO_TIPOS`, `type HechoTipo = "guia" | "ganancia_por_reservas" | "oferta_de_compra"`.
  - `HechoEntradaSchema` (zod, unión discriminada por `tipo`) y `type HechoEntrada`.
  - `type HechoExterno = HechoEntrada & { primaria: boolean; estado: "verificado" | "no_verificado"; origen: "agente" | "manual"; detectadoAt: string; vigenteHasta: string | null }`.
  - `VENTANAS_DIAS = { guia: 90, ganancia_por_reservas: 120, oferta_de_compra: 400 }`, `VENTANA_MAXIMA_DIAS = 400`, `PUERTA_TOPE = 20`.
  - `esFuentePrimaria(url: string, hosts: readonly string[]): boolean`.
  - `clasificarHecho(e: HechoEntrada, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): HechoExterno`.
  - `hechosVigentes(hechos: readonly HechoExterno[], today: string): HechoExterno[]`.
  - `banderasDeHechos(hechos: readonly HechoExterno[], today: string): string[]`.
  - `textoDeHecho(h: HechoExterno): string`.
  - `simbolosConPuerta(hechos: readonly HechoExterno[], today: string, tope?: number): string[]`.
  - `buildFlags(..., extra: { ...; hechos?: readonly HechoExterno[] })` y `decideCandidate({ ...; hechos?: readonly HechoExterno[] })`.

- [ ] **Step 1: Escribir los tests**

`packages/core/src/radar/hechos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { HechoEntradaSchema, banderasDeHechos, clasificarHecho, esFuentePrimaria, hechosVigentes, simbolosConPuerta, textoDeHecho, type HechoEntrada, type HechoExterno } from "./hechos.js";

const HOSTS = ["sec.gov", "prnewswire.com"];
const today = "2026-09-17";
const guia = (over: Partial<Extract<HechoEntrada, { tipo: "guia" }>> = {}): HechoEntrada => ({
  tipo: "guia", symbol: "FIVE", fecha: "2026-09-02",
  valor: { direccion: "sube", metrica: "ganancia ajustada por acción 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" },
  fuente: { url: "https://www.sec.gov/Archives/edgar/data/1177609/000117760926000023/q22026fivebelowexhibit991.htm", titulo: "8-K del 2/9/2026" },
  ...over,
});
const h = (e: HechoEntrada, estado: HechoExterno["estado"] = "verificado"): HechoExterno => ({ ...clasificarHecho(e, { hostsPrimarios: HOSTS, origen: "manual", detectadoAt: `${today}T12:00:00.000Z` }), estado });

describe("HechoEntradaSchema", () => {
  it("acepta los tres tipos con su forma", () => {
    expect(HechoEntradaSchema.safeParse(guia()).success).toBe(true);
    expect(HechoEntradaSchema.safeParse({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/x", titulo: "8-K" } }).success).toBe(true);
    expect(HechoEntradaSchema.safeParse({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta la PUC de Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://www.sec.gov/y", titulo: "8-K del 27/10/2025" } }).success).toBe(true);
  });
  it("rechaza fecha sin formato, URL vacía y dirección inválida", () => {
    expect(HechoEntradaSchema.safeParse(guia({ fecha: "2/9/2026" })).success).toBe(false);
    expect(HechoEntradaSchema.safeParse(guia({ fuente: { url: "", titulo: "x" } })).success).toBe(false);
    expect(HechoEntradaSchema.safeParse({ ...guia(), valor: { ...guia().valor, direccion: "arriba" } }).success).toBe(false);
  });
});

describe("esFuentePrimaria y clasificarHecho", () => {
  it("sec.gov y sus subdominios son primarios; un portal no", () => {
    expect(esFuentePrimaria("https://www.sec.gov/Archives/x", HOSTS)).toBe(true);
    expect(esFuentePrimaria("https://data.sec.gov/x", HOSTS)).toBe(true);
    expect(esFuentePrimaria("https://finance.yahoo.com/x", HOSTS)).toBe(false);
    expect(esFuentePrimaria("no es una url", HOSTS)).toBe(false);
  });
  it("verificado sólo si la fuente es primaria (13/9: un dato sin fuente primaria no mueve nada)", () => {
    expect(clasificarHecho(guia(), { hostsPrimarios: HOSTS, origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" })).toMatchObject({ primaria: true, estado: "verificado", origen: "agente", vigenteHasta: null });
    expect(clasificarHecho(guia({ fuente: { url: "https://finance.yahoo.com/x", titulo: "nota" } }), { hostsPrimarios: HOSTS, origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" })).toMatchObject({ primaria: false, estado: "no_verificado" });
  });
});

describe("hechosVigentes", () => {
  it("guía 90 días, reservas 120, oferta 400; vigenteHasta manda", () => {
    const vieja = h(guia({ fecha: "2026-06-01" }));
    const fresca = h(guia({ fecha: "2026-07-01" }));
    const oferta = h({ tipo: "oferta_de_compra", symbol: "AES", fecha: "2026-03-01", valor: { comprador: "GIP/EQT", efectivoUsd: 15, ratio: null, etapa: "faltan FERC y estados", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: "https://www.sec.gov/z", titulo: "8-K" } });
    const vencida: HechoExterno = { ...oferta, vigenteHasta: "2026-09-01" };
    expect(hechosVigentes([vieja, fresca, oferta, vencida], today).map((x) => x.fecha)).toEqual(["2026-07-01", "2026-03-01"]);
  });
});

describe("banderasDeHechos", () => {
  it("guía subida verificada → guia_subida; no verificada → nada", () => {
    expect(banderasDeHechos([h(guia())], today)).toEqual(["guia_subida"]);
    expect(banderasDeHechos([h(guia(), "no_verificado")], today)).toEqual([]);
  });
  it("guía baja → guia_recortada; reafirma → guia_reafirmada", () => {
    expect(banderasDeHechos([h(guia({ valor: { ...guia().valor, direccion: "baja" } }))], today)).toEqual(["guia_recortada"]);
    expect(banderasDeHechos([h(guia({ valor: { ...guia().valor, direccion: "reafirma" } }))], today)).toEqual(["guia_reafirmada"]);
  });
  it("reservas: sin ellas por debajo del consenso (PGR 2T: 4,11 contra 4,70) → ganancia_por_reservas; sobrevive → nada", () => {
    const pgr = (epsSinReservas: number): HechoExterno => h({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/p", titulo: "8-K del 15/7/2026" } });
    expect(banderasDeHechos([pgr(4.11)], today)).toEqual(["ganancia_por_reservas"]);
    expect(banderasDeHechos([pgr(4.8)], today)).toEqual([]);
  });
  it("oferta de compra → bajo_oferta_de_compra", () => {
    const wtrg = h({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta la PUC de Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://www.sec.gov/w", titulo: "8-K del 27/10/2025" } });
    expect(banderasDeHechos([wtrg], today)).toEqual(["bajo_oferta_de_compra"]);
    expect(textoDeHecho(wtrg)).toBe("vale 0,305 acciones de AWK (American Water, falta la PUC de Pensilvania)");
  });
  it("textos: guía y reservas", () => {
    expect(textoDeHecho(h(guia()))).toBe("subió la guía el 2026-09-02: ganancia ajustada por acción 2026 8,65-9,05 → 9,83-10,31");
    const pgr = h({ tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://www.sec.gov/p", titulo: "8-K" } });
    expect(textoDeHecho(pgr)).toBe("la ganancia del 2T 2026 lleva USD 551 M de reservas liberadas: sin eso 4,11 contra 4,7 esperado");
    const aes = h({ tipo: "oferta_de_compra", symbol: "AES", fecha: "2026-03-01", valor: { comprador: "GIP/EQT", efectivoUsd: 15, ratio: null, etapa: "faltan FERC y estados", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: "https://www.sec.gov/z", titulo: "8-K" } });
    expect(textoDeHecho(aes)).toBe("vendida a 15 en efectivo (GIP/EQT, faltan FERC y estados)");
  });
});

describe("simbolosConPuerta", () => {
  it("sólo guía subida verificada en 90 días, los más recientes primero, sin repetir, con tope", () => {
    const hs = [h(guia({ symbol: "FIVE", fecha: "2026-09-02" })), h(guia({ symbol: "FIVE", fecha: "2026-06-05" })), h(guia({ symbol: "VIEJA", fecha: "2026-05-01" })), h(guia({ symbol: "NOVER", fecha: "2026-09-10" }), "no_verificado"), h(guia({ symbol: "BAJA", fecha: "2026-09-10", valor: { ...guia().valor, direccion: "baja" } })), h(guia({ symbol: "ARW", fecha: "2026-08-06" }))];
    expect(simbolosConPuerta(hs, today)).toEqual(["FIVE", "ARW"]);
    expect(simbolosConPuerta(hs, today, 1)).toEqual(["FIVE"]);
  });
});
```

Y en `packages/core/src/radar/candidate.test.ts`, dentro del `describe("decideCandidate bajo oferta de compra")` de la Task 3, agregar:

```ts
  it("un hecho de oferta verificado hace lo mismo que el formulario; uno de guía subida suma la bandera sin cambiar el veredicto", () => {
    const base = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${today}T00:00:00.000Z` };
    const oferta = clasificarHecho({ tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2026-09-01", valor: { comprador: "AWK", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "PUC", cierreEsperado: null, formulario: "425" }, fuente: { url: "https://www.sec.gov/a", titulo: "425" } }, base);
    const d1 = decideCandidate({ f: f({ symbol: "WTRG" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, hechos: [oferta] }, p);
    if ("excluded" in d1) throw new Error("no debería excluir");
    expect(d1.verdict).toBe("OBSERVAR");
    expect(d1.flags).toContain("bajo_oferta_de_compra");
    const guiaSube = clasificarHecho({ tipo: "guia", symbol: "FIVE", fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: "8", despues: "9" }, fuente: { url: "https://www.sec.gov/b", titulo: "8-K" } }, base);
    const d2 = decideCandidate({ f: f({ symbol: "FIVE" }), candles: up, nthAppearance: 1, portfolioUsd: 150_000, today, hechos: [guiaSube] }, p);
    if ("excluded" in d2) throw new Error("no debería excluir");
    expect(d2.verdict).toBe("COMPRAR");
    expect(d2.flags).toContain("guia_subida");
  });
```

(agregar `clasificarHecho` al import de `../index.js` en ese archivo).

`packages/core/src/radar/conviction.test.ts`: si no existe, crearlo; si existe, agregar el `describe`:

```ts
import { describe, expect, it } from "vitest";
import { convictionFor } from "./conviction.js";
import type { CandidateRow } from "./types.js";

const fila = (flags: string[]): CandidateRow => ({ candidateDate: "2026-09-17", symbol: "FIVE", kind: "stock", verdict: "COMPRAR", score: 1, axes: {}, peerGroup: Array(11).fill("P"), rankInGroup: 1, groupSize: 11, close: 100, entryLow: 100, entryHigh: 102, stop: 90, target: 126, sizeUsd: 10_000, sizeQty: 100, riskScore: 3, flags, nthAppearance: 1, summary: null, whyRanks: null, mainRisk: null, moat: null, degradedBy: null, promptVersion: null, spyClose: null, close7d: null, spy7d: null, alpha7dPct: null, close30d: null, spy30d: null, alpha30dPct: null, close90d: null, spy90d: null, alpha90dPct: null, measuredAt: null });

describe("convicción con hechos externos (17/9)", () => {
  it("guia_subida suma 0,2 como sorpresa_positiva; guia_recortada y ganancia_por_reservas restan 0,3", () => {
    const base = convictionFor(fila([]), null, {})!.conviction;
    expect(convictionFor(fila(["guia_subida"]), null, {})!.conviction).toBeCloseTo(base + 0.2, 4);
    expect(convictionFor(fila(["guia_recortada"]), null, {})!.conviction).toBeCloseTo(base - 0.3, 4);
    expect(convictionFor(fila(["ganancia_por_reservas"]), null, {})!.conviction).toBeCloseTo(base - 0.3, 4);
    expect(convictionFor(fila(["guia_reafirmada"]), null, {})!.conviction).toBeCloseTo(base, 4);
    expect(convictionFor(fila(["ganancia_por_reservas"]), null, {})!.cautions.join(" ")).toMatch(/reservas liberadas/);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/core/src/radar/hechos.test.ts packages/core/src/radar/candidate.test.ts packages/core/src/radar/conviction.test.ts`
Expected: FAIL (módulo `./hechos.js` inexistente; `hechos` no es entrada de `decideCandidate`; pesos desconocidos).

- [ ] **Step 3: Implementar**

`packages/core/src/radar/hechos.ts`:

```ts
import { z } from "zod";

/**
 * Hechos externos (17/9). Datos con fecha y fuente que la app no puede sacar de sus proveedores, en una forma que las
 * reglas puedan leer. Los carga un agente (o el dueño, a mano) por el importador; la app decide con reglas y tests.
 *
 * La regla que manda: el agente escribe HECHOS, no veredictos. "FIVE: guía anual subida el 2/9 de 8,65-9,05 a
 * 9,83-10,31, fuente 8-K en sec.gov" sí; "FIVE: COMPRAR" no, porque serían dos varas.
 *
 * Y sólo lo VERIFICADO mueve algo. Verificado = la fuente es primaria (un host de la lista de config: reguladores y
 * cables de comunicados). Lo demás se muestra con su estado y no cambia banderas, veredictos ni convicción (13/9: un
 * dato inventado dentro de un recordatorio no puede mover un plan).
 */
export const HECHO_TIPOS = ["guia", "ganancia_por_reservas", "oferta_de_compra"] as const;
export type HechoTipo = (typeof HECHO_TIPOS)[number];

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "fecha AAAA-MM-DD");
const simbolo = z.string().regex(/^[A-Za-z][A-Za-z0-9.-]{0,9}$/);
export const FuenteSchema = z.object({ url: z.string().url(), titulo: z.string().min(1) });
export const GuiaValorSchema = z.object({ direccion: z.enum(["sube", "baja", "reafirma"]), metrica: z.string().min(1), periodo: z.string().min(1), antes: z.string().nullable(), despues: z.string().nullable() });
export const ReservasValorSchema = z.object({ trimestre: z.string().min(1), montoUsd: z.number(), puntosCombinado: z.number().nullable(), epsPublicado: z.number(), epsSinReservas: z.number(), epsConsenso: z.number().nullable() });
export const OfertaValorSchema = z.object({ comprador: z.string().min(1), efectivoUsd: z.number().nullable(), ratio: z.object({ acciones: z.number().positive(), de: z.string().min(1) }).nullable(), etapa: z.string().min(1), cierreEsperado: z.string().nullable(), formulario: z.string().nullable() });

const comun = { symbol: simbolo, fecha: fechaIso, fuente: FuenteSchema };
export const HechoEntradaSchema = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("guia"), ...comun, valor: GuiaValorSchema }),
  z.object({ tipo: z.literal("ganancia_por_reservas"), ...comun, valor: ReservasValorSchema }),
  z.object({ tipo: z.literal("oferta_de_compra"), ...comun, valor: OfertaValorSchema }),
]);
export type HechoEntrada = z.infer<typeof HechoEntradaSchema>;
export type HechoExterno = HechoEntrada & { primaria: boolean; estado: "verificado" | "no_verificado"; origen: "agente" | "manual"; detectadoAt: string; vigenteHasta: string | null };

/** Cuánto dura cada tipo de hecho. Una oferta firmada hace meses sigue fijando el precio (AES: 400 días, como EDGAR). */
export const VENTANAS_DIAS: Record<HechoTipo, number> = { guia: 90, ganancia_por_reservas: 120, oferta_de_compra: 400 };
export const VENTANA_MAXIMA_DIAS = 400;
/** La puerta de entrada al ranking: como mucho estos símbolos, los más recientes. */
export const PUERTA_TOPE = 20;
const DAY = 86_400_000;

export function esFuentePrimaria(url: string, hosts: readonly string[]): boolean {
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => host === h.toLowerCase() || host.endsWith(`.${h.toLowerCase()}`));
}

export function clasificarHecho(e: HechoEntrada, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): HechoExterno {
  const primaria = esFuentePrimaria(e.fuente.url, o.hostsPrimarios);
  return { ...e, symbol: e.symbol.toUpperCase(), primaria, estado: primaria ? "verificado" : "no_verificado", origen: o.origen, detectadoAt: o.detectadoAt, vigenteHasta: null };
}

/** Dentro de la ventana de su tipo y no vencido. Independiente del estado: lo no verificado también se muestra. */
export function hechosVigentes(hechos: readonly HechoExterno[], today: string): HechoExterno[] {
  const hoy = Date.parse(today);
  return hechos.filter((h) => {
    if (h.vigenteHasta !== null && h.vigenteHasta < today) return false;
    const edad = (hoy - Date.parse(h.fecha)) / DAY;
    return edad >= 0 && edad <= VENTANAS_DIAS[h.tipo];
  });
}

const coma = (n: number) => String(n).replace(".", ",");
const millones = (usd: number) => `USD ${Math.round(usd / 1e6)} M`;

/** El texto de la salvedad o la razón, para la ficha y para el informe. */
export function textoDeHecho(h: HechoExterno): string {
  if (h.tipo === "guia") {
    const verbo = h.valor.direccion === "sube" ? "subió" : h.valor.direccion === "baja" ? "recortó" : "reafirmó";
    return `${verbo} la guía el ${h.fecha}: ${h.valor.metrica} ${h.valor.antes ?? "—"} → ${h.valor.despues ?? "—"}`;
  }
  if (h.tipo === "ganancia_por_reservas") {
    return `la ganancia del ${h.valor.trimestre} lleva ${millones(h.valor.montoUsd)} de reservas liberadas: sin eso ${coma(h.valor.epsSinReservas)} contra ${h.valor.epsConsenso === null ? "—" : coma(h.valor.epsConsenso)} esperado`;
  }
  const v = h.valor;
  if (v.ratio) return `vale ${coma(v.ratio.acciones)} acciones de ${v.ratio.de} (${v.comprador}, ${v.etapa})`;
  return `vendida a ${v.efectivoUsd === null ? "—" : coma(v.efectivoUsd)} en efectivo (${v.comprador}, ${v.etapa})`;
}

/**
 * Banderas que producen los hechos VERIFICADOS y vigentes. Los pesos los pone `conviction.ts` y copian a los datos
 * equivalentes del proveedor: `guia_subida` vale lo que `sorpresa_positiva`, `ganancia_por_reservas` lo que
 * `sorpresa_negativa`. `bajo_oferta_de_compra` es la misma bandera que producen los formularios de EDGAR.
 */
export function banderasDeHechos(hechos: readonly HechoExterno[], today: string): string[] {
  const out: string[] = [];
  const add = (f: string) => { if (!out.includes(f)) out.push(f); };
  for (const h of hechosVigentes(hechos, today)) {
    if (h.estado !== "verificado") continue;
    if (h.tipo === "guia") add(h.valor.direccion === "sube" ? "guia_subida" : h.valor.direccion === "baja" ? "guia_recortada" : "guia_reafirmada");
    else if (h.tipo === "ganancia_por_reservas") {
      const sobrevive = h.valor.epsConsenso !== null && h.valor.epsSinReservas >= h.valor.epsConsenso;
      if (!sobrevive) add("ganancia_por_reservas");
    } else add("bajo_oferta_de_compra");
  }
  return out;
}

/**
 * La puerta de entrada (17/9): un hecho verificado de guía subida garantiza que la app mire a esa empresa aunque su
 * puntaje la deje fuera de la preselección. No cambia el puntaje ni el filtro. FIVE en el puesto 412 con la guía
 * subida dos veces es el caso.
 */
export function simbolosConPuerta(hechos: readonly HechoExterno[], today: string, tope = PUERTA_TOPE): string[] {
  const out: string[] = [];
  const candidatos = hechosVigentes(hechos, today)
    .filter((h) => h.estado === "verificado" && h.tipo === "guia" && h.valor.direccion === "sube")
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  for (const h of candidatos) {
    if (out.length >= tope) break;
    if (!out.includes(h.symbol)) out.push(h.symbol);
  }
  return out;
}
```

`packages/core/src/radar/index.ts`: agregar `export * from "./hechos.js";` después de `./oferta.js`.

`packages/core/src/radar/candidate.ts`:
- import: `import { banderasDeHechos, type HechoExterno } from "./hechos.js";`
- en `buildFlags`, el tipo de `extra` suma `hechos?: readonly HechoExterno[]`, y al final, antes del `return flags`:

```ts
  // Hechos externos verificados (17/9): guía, reservas, oferta. Misma bandera que EDGAR para la oferta, sin repetir.
  for (const hf of banderasDeHechos(extra.hechos ?? [], extra.today ?? new Date().toISOString().slice(0, 10))) if (!flags.includes(hf)) flags.push(hf);
```
- en `decideCandidate`, la entrada suma `/** Hechos externos vigentes del símbolo (17/9): guía, reservas, oferta. Sólo los verificados producen banderas. */ hechos?: readonly HechoExterno[];` y en la llamada a `buildFlags` se agrega `...(i.hechos !== undefined ? { hechos: i.hechos } : {}),`.

`packages/core/src/radar/conviction.ts`:
- en `POSITIVE`: `guia_subida: "subió la guía (hecho verificado, con fuente en la ficha)",`
- en `NEGATIVE`: `guia_recortada: { text: "recortó la guía (hecho verificado, con fuente en la ficha)", penalty: 0.3 }, ganancia_por_reservas: { text: "la ganancia publicada lleva reservas liberadas: sin ellas no llega al consenso (hecho verificado, con fuente en la ficha)", penalty: 0.3 },`
- en `INFO`: `guia_reafirmada: "reafirmó la guía (hecho verificado)",`
- en el comentario de cabecera, agregar la línea: `−0.3 guía recortada / ganancia sostenida por reservas (hechos externos verificados); +0.2 guía subida.`

- [ ] **Step 4: Correr y ver pasar; typecheck**

Run: `pnpm exec vitest run packages/core && pnpm --filter @thesis/core typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/radar/hechos.ts packages/core/src/radar/hechos.test.ts packages/core/src/radar/index.ts packages/core/src/radar/candidate.ts packages/core/src/radar/candidate.test.ts packages/core/src/radar/conviction.ts packages/core/src/radar/conviction.test.ts
git commit -m "feat(radar): hechos externos en el núcleo: guía, reservas y oferta, con reglas y puerta de entrada

Un hecho es un dato con fecha y fuente que la app no puede sacar de sus
proveedores. Sólo lo verificado (fuente primaria) mueve algo: guía subida +0,2,
guía recortada y ganancia por reservas −0,3 (los pesos de sorpresa_positiva y
sorpresa_negativa), oferta de compra → OBSERVAR. La puerta: un hecho de guía
subida garantiza que el ranking mire a esa empresa (tope 20), con su mismo
puntaje y filtro. Casos del 17/9: FIVE (guía, puesto 412), PGR/RNR/ESNT/HG
(reservas), WTRG (0,305 AWK), AES (15,00)."
```

---

### Task 5: La tabla `hechos_externos` (db) y el almacén en memoria

**Files:**
- Modify: `packages/db/src/schema.ts` (tabla nueva al final)
- Create: `packages/db/drizzle/0024_hechos_externos.sql`
- Modify: `packages/db/drizzle/meta/_journal.json` (entrada nueva)
- Modify: `packages/db/src/repo.ts` (tres métodos)
- Modify: `packages/pipeline/src/store.ts` (`RadarStore` + `MemoryStore`), `packages/pipeline/src/mercado.ts` (el Proxy `sinEscribir` también anula `saveHechos`)
- Test: `packages/db/src/repo.integration.test.ts` (caso nuevo), `packages/pipeline/test/hechos.test.ts` (nuevo)

**Interfaces:**
- Produces en `RadarStore`:
  - `saveHechos(rows: HechoExterno[]): Promise<number>` (upsert por símbolo+tipo+fecha+url; devuelve cuántos procesó)
  - `hechos(symbol: string, desde: string): Promise<HechoExterno[]>` (fecha ≥ desde, más recientes primero)
  - `hechosPorTipo(tipo: HechoTipo, desde: string): Promise<HechoExterno[]>`

- [ ] **Step 1: Escribir los tests**

`packages/pipeline/test/hechos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clasificarHecho, type HechoExterno } from "@thesis/core";
import { MemoryStore } from "../src/index.js";

const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z" };
const guia = (symbol: string, fecha: string): HechoExterno => clasificarHecho({ tipo: "guia", symbol, fecha, valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "10" }, fuente: { url: `https://www.sec.gov/${symbol}/${fecha}`, titulo: "8-K" } }, o);

describe("MemoryStore hechos", () => {
  it("guarda sin duplicar (símbolo+tipo+fecha+url), lista por símbolo y por tipo desde una fecha", async () => {
    const s = new MemoryStore();
    expect(await s.saveHechos([guia("five", "2026-09-02"), guia("FIVE", "2026-09-02"), guia("ARW", "2026-08-06"), guia("VIEJA", "2026-01-01")])).toBe(4);
    expect((await s.hechos("five", "2026-06-01")).map((h) => h.fecha)).toEqual(["2026-09-02"]);
    expect((await s.hechosPorTipo("guia", "2026-06-01")).map((h) => h.symbol).sort()).toEqual(["ARW", "FIVE"]);
    expect(await s.hechosPorTipo("oferta_de_compra", "2026-01-01")).toEqual([]);
  });
});
```

En `packages/db/src/repo.integration.test.ts`, dentro del `d("Repo (Postgres real)")`, agregar en el `afterAll` la línea `await db.delete(schema.hechosExternos).where(eq(schema.hechosExternos.symbol, `H${ticker}`));` y este caso:

```ts
  it("hechos_externos: upsert por símbolo+tipo+fecha+url, lectura por símbolo y por tipo", async () => {
    const sym = `H${ticker}`;
    const base = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z" };
    const h1 = clasificarHecho({ tipo: "guia", symbol: sym, fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS", periodo: "FY2026", antes: "8", despues: "10" }, fuente: { url: `https://www.sec.gov/${sym}/1`, titulo: "8-K" } }, base);
    const h2 = clasificarHecho({ tipo: "oferta_de_compra", symbol: sym, fecha: "2026-08-01", valor: { comprador: "X", efectivoUsd: 15, ratio: null, etapa: "votada", cierreEsperado: null, formulario: "DEFM14A" }, fuente: { url: `https://www.sec.gov/${sym}/2`, titulo: "DEFM14A" } }, base);
    expect(await repo.saveHechos([h1, h2])).toBe(2);
    expect(await repo.saveHechos([{ ...h1, valor: { ...h1.valor, despues: "11" } }])).toBe(1);
    const porSimbolo = await repo.hechos(sym, "2026-01-01");
    expect(porSimbolo.map((h) => h.tipo)).toEqual(["guia", "oferta_de_compra"]);
    expect(porSimbolo[0]?.tipo === "guia" && porSimbolo[0].valor.despues).toBe("11");
    expect(porSimbolo[0]).toMatchObject({ estado: "verificado", primaria: true, origen: "manual", vigenteHasta: null });
    expect((await repo.hechosPorTipo("oferta_de_compra", "2026-01-01")).some((h) => h.symbol === sym)).toBe(true);
    expect(await repo.hechos(sym, "2026-09-10")).toEqual([]);
  });
```

(agregar `import { clasificarHecho } from "@thesis/core";` al archivo).

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/pipeline/test/hechos.test.ts && pnpm test:db`
Expected: FAIL (métodos inexistentes; tabla inexistente).

- [ ] **Step 3: Implementar**

`packages/db/src/schema.ts`, al final:

```ts
/**
 * Hechos externos (17/9): guía, ganancia por reservas y ofertas de compra con fecha y fuente, cargados por el importador
 * (`radar-cli.ts hechos --importar`). Es la ÚNICA tabla que ese mecanismo escribe. `estado` = verificado si la fuente es
 * primaria; sólo lo verificado produce banderas. Único por (símbolo, tipo, fecha, url): el mismo hecho cargado dos
 * veces se actualiza, no se duplica.
 */
export const hechosExternos = pgTable(
  "hechos_externos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    symbol: text("symbol").notNull(),
    tipo: text("tipo").notNull(),
    fecha: date("fecha").notNull(),
    valor: jsonb("valor").notNull(),
    fuenteUrl: text("fuente_url").notNull(),
    fuenteTitulo: text("fuente_titulo").notNull(),
    primaria: boolean("primaria").notNull(),
    estado: text("estado").notNull(),
    origen: text("origen").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    vigenteHasta: date("vigente_hasta"),
  },
  (t) => [uniqueIndex("hechos_externos_unico").on(t.symbol, t.tipo, t.fecha, t.fuenteUrl), index("hechos_externos_symbol").on(t.symbol)],
);
```

`packages/db/drizzle/0024_hechos_externos.sql`:

```sql
-- Hechos externos (2026-09-17): guía, ganancia por reservas y ofertas de compra con fecha y fuente.
-- La única tabla que escribe el importador de hechos; sólo lo verificado (fuente primaria) produce banderas.
CREATE TABLE IF NOT EXISTS "hechos_externos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" text NOT NULL,
  "tipo" text NOT NULL,
  "fecha" date NOT NULL,
  "valor" jsonb NOT NULL,
  "fuente_url" text NOT NULL,
  "fuente_titulo" text NOT NULL,
  "primaria" boolean NOT NULL,
  "estado" text NOT NULL,
  "origen" text NOT NULL,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "vigente_hasta" date
);
CREATE UNIQUE INDEX IF NOT EXISTS "hechos_externos_unico" ON "hechos_externos" ("symbol", "tipo", "fecha", "fuente_url");
CREATE INDEX IF NOT EXISTS "hechos_externos_symbol" ON "hechos_externos" ("symbol");
```

`packages/db/drizzle/meta/_journal.json`: agregar al final de `entries`:

```json
    {
      "idx": 24,
      "version": "7",
      "when": 1789490000000,
      "tag": "0024_hechos_externos",
      "breakpoints": true
    }
```

`packages/db/src/repo.ts` (imports: agregar `HechoExterno, HechoTipo` al `import type` de `@thesis/core`), métodos nuevos junto a `saveVerification`:

```ts
  // ---------- hechos_externos (17/9) ----------
  async saveHechos(rows: HechoExterno[]): Promise<number> {
    let n = 0;
    for (const h of rows) {
      const v = { symbol: h.symbol.toUpperCase(), tipo: h.tipo, fecha: h.fecha, valor: h.valor, fuenteUrl: h.fuente.url, fuenteTitulo: h.fuente.titulo, primaria: h.primaria, estado: h.estado, origen: h.origen, detectedAt: new Date(h.detectadoAt), vigenteHasta: h.vigenteHasta };
      await this.db.insert(s.hechosExternos).values(v).onConflictDoUpdate({ target: [s.hechosExternos.symbol, s.hechosExternos.tipo, s.hechosExternos.fecha, s.hechosExternos.fuenteUrl], set: v });
      n++;
    }
    return n;
  }
  async hechos(symbol: string, desde: string): Promise<HechoExterno[]> {
    const rows = await this.db.select().from(s.hechosExternos).where(and(eq(s.hechosExternos.symbol, symbol.toUpperCase()), gte(s.hechosExternos.fecha, desde))).orderBy(desc(s.hechosExternos.fecha));
    return rows.map(toHecho);
  }
  async hechosPorTipo(tipo: HechoTipo, desde: string): Promise<HechoExterno[]> {
    const rows = await this.db.select().from(s.hechosExternos).where(and(eq(s.hechosExternos.tipo, tipo), gte(s.hechosExternos.fecha, desde))).orderBy(desc(s.hechosExternos.fecha));
    return rows.map(toHecho);
  }
```

y al final del archivo, junto a `toRawEvent`:

```ts
function toHecho(r: typeof s.hechosExternos.$inferSelect): HechoExterno {
  return { symbol: r.symbol, tipo: r.tipo as HechoTipo, fecha: String(r.fecha), valor: r.valor, fuente: { url: r.fuenteUrl, titulo: r.fuenteTitulo }, primaria: r.primaria, estado: r.estado as HechoExterno["estado"], origen: r.origen as HechoExterno["origen"], detectadoAt: r.detectedAt.toISOString(), vigenteHasta: r.vigenteHasta ? String(r.vigenteHasta) : null } as HechoExterno;
}
```

`packages/pipeline/src/store.ts`:
- `import type { ..., HechoExterno, HechoTipo } from "@thesis/core";` (sumar a los imports de tipos existentes).
- En `RadarStore`, después de `verification(...)`:

```ts
  /** Hechos externos (17/9): la única tabla que escribe el importador. `hechos` = por símbolo desde una fecha, más recientes primero. */
  saveHechos(rows: HechoExterno[]): Promise<number>;
  hechos(symbol: string, desde: string): Promise<HechoExterno[]>;
  hechosPorTipo(tipo: HechoTipo, desde: string): Promise<HechoExterno[]>;
```
- En `MemoryStore`, campo `hechosMap = new Map<string, HechoExterno>();` y métodos:

```ts
  async saveHechos(rows: HechoExterno[]) {
    for (const h of rows) this.hechosMap.set(`${h.symbol.toUpperCase()}|${h.tipo}|${h.fecha}|${h.fuente.url}`, { ...h, symbol: h.symbol.toUpperCase() });
    return rows.length;
  }
  async hechos(symbol: string, desde: string) {
    return [...this.hechosMap.values()].filter((h) => h.symbol === symbol.toUpperCase() && h.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
  async hechosPorTipo(tipo: HechoTipo, desde: string) {
    return [...this.hechosMap.values()].filter((h) => h.tipo === tipo && h.fecha >= desde).sort((a, b) => b.fecha.localeCompare(a.fecha));
  }
```

`packages/pipeline/src/mercado.ts`, en `sinEscribir`: `if (p === "upsertCandles" || p === "saveStatements" || p === "saveFundamentals" || p === "saveHechos") return async () => {};` (para `saveHechos`, devolver `async () => 0`: la firma pide número; escribirlo como `if (p === "saveHechos") return async () => 0;` antes del otro `if`).

- [ ] **Step 4: Aplicar la migración a la base de tests y a la de la app, y correr**

```bash
DATABASE_URL=postgres://thesis:thesis@localhost:5433/thesis_test pnpm --filter @thesis/db migrate
pnpm --filter @thesis/db migrate
pnpm exec vitest run packages/pipeline/test/hechos.test.ts && pnpm test:db && pnpm -r --no-bail typecheck
```

Expected: las dos migraciones aplican `0024`; PASS en los dos tests; tipos ok. (La base de la app recibe una tabla vacía; ninguna otra tabla se toca.)

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema.ts packages/db/drizzle/0024_hechos_externos.sql packages/db/drizzle/meta/_journal.json packages/db/src/repo.ts packages/db/src/repo.integration.test.ts packages/pipeline/src/store.ts packages/pipeline/src/mercado.ts packages/pipeline/test/hechos.test.ts
git commit -m "feat(db): tabla hechos_externos, la única que escribe el importador de hechos

Una fila por hecho, única por símbolo, tipo, fecha y url de la fuente. Se lee
por símbolo (la ficha, el ranking) y por tipo (la puerta de entrada). El
comando mercado sigue sin escribir: el proxy anula saveHechos también."
```

---

### Task 6: Cableado en el pipeline (preselección con ofertas y hechos, puerta, refresco, `mercado`)

**Files:**
- Modify: `packages/pipeline/src/radar.ts` (`rankRadar`, `refreshRadar`, helper `hechosDe`)
- Modify: `packages/pipeline/src/mercado.ts` (`FilaMercado.hechos`, pedir filings y hechos)
- Test: `packages/pipeline/test/radar.test.ts` (tres casos nuevos)

**Interfaces:**
- Consumes: `deps.filingsDeOferta(symbol)`, `deps.store.hechos`, `deps.store.hechosPorTipo`, `simbolosConPuerta`, `hechosVigentes`, `VENTANAS_DIAS`, `VENTANA_MAXIMA_DIAS` de `@thesis/core`.
- Produces: `export async function hechosDe(deps: Pick<RadarDeps, "store">, symbol: string, today: string): Promise<HechoExterno[]>`; `FilaMercado.hechos: HechoExterno[]`.

- [ ] **Step 1: Escribir los tests**

En `packages/pipeline/test/radar.test.ts` (los helpers `deps`, `policy`, `TODAY`, `symbols` están arriba; agregar `clasificarHecho` al import de `@thesis/core`):

```ts
describe("rankRadar con ofertas y hechos externos (17/9)", () => {
  it("una empresa bajo oferta en la preselección queda OBSERVAR y el plan no la compra", async () => {
    const { store, d } = deps({ filingsDeOferta: async (s) => (s === "SA" ? ["DEFM14A — SA CORP"] : []) });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    const sa = r.candidates.find((c) => c.symbol === "SA")!;
    expect(sa.verdict).toBe("OBSERVAR");
    expect(sa.flags).toContain("bajo_oferta_de_compra");
    const plan = await buildContributionPlan(d, { month: "2026-05", portfolioUsd: 150_000 });
    expect(plan.lines.map((l) => l.symbol)).not.toContain("SA");
    expect(await store.latestCandidates()).not.toHaveLength(0);
  });
  it("la puerta: un hecho verificado de guía subida hace evaluar y guardar a un símbolo fuera de la preselección; uno no verificado, no", async () => {
    const chico = { ...policy, candidates: { top: 2, preselect: 3, chronicWeeks: 4, maxRows: 2 } };
    const { store, d } = deps({ policy: chico });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${TODAY}T00:00:00.000Z` };
    const hecho = (symbol: string, url: string) => clasificarHecho({ tipo: "guia", symbol, fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: "8", despues: "10" }, fuente: { url, titulo: "8-K" } }, o);
    await store.saveHechos([hecho("SF", "https://www.sec.gov/sf"), hecho("SE", "https://finance.yahoo.com/se")]);
    const r = await rankRadar(d, { today: TODAY, portfolioUsd: 150_000 });
    const guardados = r.candidates.filter((c) => c.kind === "stock").map((c) => c.symbol);
    expect(guardados).toContain("SF"); // puesto 6 de 12, fuera de la preselección de 3 y del tope de 2
    expect(guardados).not.toContain("SE"); // el hecho no es verificado
    expect(guardados.length).toBe(3); // el tope de 2 más la puerta
    expect(r.candidates.find((c) => c.symbol === "SF")!.flags).toContain("guia_subida");
  });
  it("explorarMercado pide los formularios de oferta y los hechos, y los devuelve en la fila", async () => {
    const { store, d } = deps({ filingsDeOferta: async (s) => (s === "SB" ? ["PREM14A — SB CORP"] : []) });
    await scanUniverse(d, { scanDate: "2026-05-17", today: TODAY });
    const o = { hostsPrimarios: ["sec.gov"], origen: "manual" as const, detectadoAt: `${TODAY}T00:00:00.000Z` };
    await store.saveHechos([clasificarHecho({ tipo: "guia", symbol: "SA", fecha: "2026-05-10", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "10" }, fuente: { url: "https://www.sec.gov/sa", titulo: "8-K" } }, o)]);
    const m = await explorarMercado(d, { today: TODAY, portfolioUsd: 150_000, preselect: 12, conEstados: false });
    expect(m.filas.find((f) => f.symbol === "SB")).toMatchObject({ verdict: "OBSERVAR" });
    expect(m.filas.find((f) => f.symbol === "SB")!.flags).toContain("bajo_oferta_de_compra");
    const sa = m.filas.find((f) => f.symbol === "SA")!;
    expect(sa.flags).toContain("guia_subida");
    expect(sa.hechos.map((h) => h.tipo)).toEqual(["guia"]);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/pipeline/test/radar.test.ts`
Expected: FAIL en los tres casos nuevos.

- [ ] **Step 3: Implementar**

`packages/pipeline/src/radar.ts`:

1. Imports desde `@thesis/core`: agregar `hechosVigentes`, `simbolosConPuerta`, `VENTANAS_DIAS`, `VENTANA_MAXIMA_DIAS`, `type HechoExterno`.

2. Helper, después de `statementsFor`:

```ts
/** Hechos externos vigentes del símbolo (17/9), para el ranking, el refresco y el comando mercado. Un fallo de lectura = sin hechos. */
export async function hechosDe(deps: Pick<RadarDeps, "store">, symbol: string, today: string): Promise<HechoExterno[]> {
  return hechosVigentes(await deps.store.hechos(symbol, addDays(today, -VENTANA_MAXIMA_DIAS)).catch(() => [] as HechoExterno[]), today);
}
```

3. En `rankRadar`, reemplazar desde `const first = rankStocks(...)` hasta `const kept = ...` por:

```ts
  // La puerta de entrada (17/9): símbolos con un hecho verificado de guía subida en 90 días. Se piden sus estados junto
  // con la preselección y se evalúan con las mismas reglas; si quedan COMPRAR, entran a las filas aunque el tope esté
  // lleno (son como mucho PUERTA_TOPE). FIVE en el puesto 412 con la guía subida dos veces es el caso.
  const puerta = simbolosConPuerta(await store.hechosPorTipo("guia", addDays(opts.today, -VENTANAS_DIAS.guia)).catch(() => [] as HechoExterno[]), opts.today).filter((s) => all.has(s));
  // Dos pasadas (spec verificación §4): la primera con Finnhub elige a quién pedirle estados; la segunda rankea con la ganancia núcleo.
  const first = rankStocks(all, policy.weights).ranked.slice(0, policy.candidates.preselect);
  const cores = await withStatements(deps, all, [...first.flatMap((r) => [r.symbol, ...r.group]), ...puerta], opts.today);
  const { ranked, skipped } = rankStocks(all, policy.weights);
  const pre = ranked.slice(0, policy.candidates.preselect);
  const porPuerta = new Set(puerta.filter((s) => !pre.some((r) => r.symbol === s)));
  const preConPuerta: RankedStock[] = [...pre, ...[...porPuerta].map((s) => ranked.find((r) => r.symbol === s)).filter((r): r is RankedStock => !!r)];
  const coreOf = (sym: string): CoreEarnings | null | undefined => (deps.statements ? (cores.get(sym) ?? null) : undefined);
  const spy = await deps.history.candles("SPY", HISTORY_DAYS).catch(() => [] as Candle[]);
  if (spy.length) await store.upsertCandles("SPY", spy).catch(() => {});
  const spyClose = spy[spy.length - 1]?.close ?? null;
  const { candles, errors } = await candlesFor(deps, preConPuerta.map((r) => r.symbol));
  const verifyBudget: VerifyBudget = { left: policy.candidates.verifyPerRun ?? VERIFY_PER_RUN_DEFAULT };

  // Filtro técnico sobre TODA la pre-selección: entran las `top` mejores por puntaje y, además, cualquier COMPRAR
  // que quede abajo del corte, hasta `maxRows` (16/9: 13 COMPRAR con puestos 77 a 149 no se veían). El filtro es
  // puro y las velas de la preselección ya están bajadas, así que evaluarlas todas no cuesta un pedido más.
  // Los formularios de oferta y los hechos se piden acá, para TODAS las filas (17/9): una empresa vendida por contrato
  // no puede contar como COMPRAR al elegir qué se guarda. Se cachean para no volver a pedirlos abajo.
  const filingsPor = new Map<string, string[]>();
  const hechosPor = new Map<string, HechoExterno[]>();
  const evaluadas: Array<{ item: RankedStock; verdict: "COMPRAR" | "OBSERVAR" }> = [];
  for (const r of preConPuerta) {
    const c = candles[r.symbol];
    if (!c) continue;
    const f = all.get(r.symbol)!;
    const rCore = coreOf(r.symbol);
    const filings = await deps.filingsDeOferta(r.symbol).catch(() => [] as string[]);
    const hechos = await hechosDe(deps, r.symbol, opts.today);
    filingsPor.set(r.symbol, filings);
    hechosPor.set(r.symbol, hechos);
    const d = decideCandidate({ f, candles: c, nthAppearance: 1, portfolioUsd: opts.portfolioUsd, today: opts.today, filings, hechos, ...(rCore !== undefined ? { core: rCore } : {}) }, policy);
    if ("excluded" in d) {
      skipped.push({ symbol: r.symbol, reason: d.reasons.join(",") });
      continue;
    }
    evaluadas.push({ item: r, verdict: d.verdict });
  }
  const kept: RankedStock[] = seleccionarCandidatas(evaluadas, { top: policy.candidates.top, maxRows: policy.candidates.maxRows });
  for (const e of evaluadas) if (porPuerta.has(e.item.symbol) && e.verdict === "COMPRAR" && !kept.includes(e.item)) kept.push(e.item);
```

4. En el bucle `for (const r of kept)`, reemplazar `const filings = await deps.filingsDeOferta(sym).catch(() => [] as string[]);` por `const filings = filingsPor.get(sym) ?? [];` y agregar `hechos: hechosPor.get(sym) ?? [],` al objeto `input` (después de `filings,`).

5. En `refreshRadar`, después de `const filingsPrev = ...`: `const hechosPrev = await hechosDe(deps, prev.symbol, opts.today);` y en `input` agregar `hechos: hechosPrev,` después de `filings: filingsPrev,`.

`packages/pipeline/src/mercado.ts`:
- import: `import { decideCandidate, rankStocks, type Candle, type CandidateDecision, type CoreEarnings, type EntryTiming, type Fundamentals, type HechoExterno } from "@thesis/core";` y `import { candlesFor, hechosDe, heldSymbols, universoDelRanking, withStatements, type RadarDeps } from "./radar.js";`
- `FilaMercado`: agregar `/** Hechos externos vigentes del símbolo (17/9), con su estado: para que el informe diga lo mismo que la app. */ hechos: HechoExterno[];`
- en el bucle, antes de `const d = decideCandidate(...)`:

```ts
    // Igual que el ranking (17/9): formularios de oferta y hechos externos para cada símbolo con velas. Nada se escribe.
    const filings = await deps.filingsDeOferta(sym).catch(() => [] as string[]);
    const hechos = await hechosDe(deps, sym, opts.today);
    const d = decideCandidate({ f, candles: c, nthAppearance: 1, portfolioUsd: opts.portfolioUsd, today: opts.today, held: held.has(sym), filings, hechos, ...(core !== undefined ? { core } : {}) }, policy);
```
- y en el `filas.push({...})` agregar `hechos,`.

- [ ] **Step 4: Correr y ver pasar; typecheck**

Run: `pnpm exec vitest run packages/pipeline && pnpm -r --no-bail typecheck`
Expected: PASS. Si `argentina.test.ts` u otro construye `RadarDeps` sin `filingsDeOferta`, ya lo tiene (línea 110); no hace falta tocarlo.

- [ ] **Step 5: Commit**

```bash
git add packages/pipeline/src/radar.ts packages/pipeline/src/mercado.ts packages/pipeline/test/radar.test.ts
git commit -m "feat(radar): ofertas y hechos externos para toda la preselección, y la puerta de entrada

El ranking pide los formularios de oferta y los hechos para cada fila de la
preselección antes de elegir qué guarda: una empresa vendida por contrato ya no
cuenta como COMPRAR (AES, WTRG, ROKU el 17/9). Un hecho verificado de guía
subida hace evaluar al símbolo aunque su puntaje lo deje afuera, y si es
COMPRAR entra aunque el tope esté lleno (FIVE, puesto 412). El comando mercado
hace lo mismo y devuelve los hechos en la fila."
```

---

### Task 7: Contenedor, config de fuentes y el importador (CLI)

**Files:**
- Create: `config/hechos-fuentes.json`, `packages/pipeline/src/hechos.ts`
- Modify: `apps/api/src/config.ts` (`RadarConfig.hechosFuentes`, lectura), `apps/api/src/container.ts` (`filingsDeOferta` con consulta en vivo), `apps/api/src/radar-cli.ts` (comando `hechos`), `packages/pipeline/src/index.ts` (export)
- Test: `packages/pipeline/test/hechos.test.ts` (caso del importador), `apps/api/src/config.test.ts` (si existe, un caso; si no, se prueba por `pnpm typecheck` y por la corrida de la Task 10)

**Interfaces:**
- Produces: `importarHechos(store: Pick<RadarStore, "saveHechos">, input: unknown, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): Promise<{ guardados: number; verificados: number; noVerificados: number; rechazados: Array<{ indice: number; motivo: string }> }>`.
- `config/hechos-fuentes.json`: `{ "hostsPrimarios": [...] }`; `RadarConfig.hechosFuentes: string[]`.
- CLI: `radar-cli.ts hechos --importar <archivo.json> [--origen agente|manual]`. Sale con código 1 si no guardó nada.

- [ ] **Step 1: Escribir el test del importador**

En `packages/pipeline/test/hechos.test.ts`, agregar (`importarHechos` al import de `../src/index.js`):

```ts
describe("importarHechos", () => {
  it("valida, marca verificado sólo con fuente primaria, rechaza con motivo y no frena por uno malo", async () => {
    const s = new MemoryStore();
    const r = await importarHechos(s, { hechos: [
      { tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/Archives/x", titulo: "8-K" } },
      { tipo: "ganancia_por_reservas", symbol: "PGR", fecha: "2026-07-15", valor: { trimestre: "2T 2026", montoUsd: 551e6, puntosCombinado: 2.6, epsPublicado: 4.85, epsSinReservas: 4.11, epsConsenso: 4.7 }, fuente: { url: "https://finance.yahoo.com/nota", titulo: "nota" } },
      { tipo: "guia", symbol: "MAL", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS", periodo: "FY", antes: null, despues: "1" }, fuente: { url: "", titulo: "" } },
    ] }, { hostsPrimarios: ["sec.gov"], origen: "agente", detectadoAt: "2026-09-17T00:00:00.000Z" });
    expect(r).toMatchObject({ guardados: 2, verificados: 1, noVerificados: 1 });
    expect(r.rechazados).toHaveLength(1);
    expect(r.rechazados[0]).toMatchObject({ indice: 2 });
    expect((await s.hechos("PGR", "2026-01-01"))[0]).toMatchObject({ estado: "no_verificado", origen: "agente" });
  });
  it("acepta un arreglo pelado y rechaza lo que no es ni arreglo ni { hechos }", async () => {
    const s = new MemoryStore();
    expect((await importarHechos(s, [], { hostsPrimarios: [], origen: "manual", detectadoAt: "2026-09-17T00:00:00.000Z" })).guardados).toBe(0);
    const r = await importarHechos(s, { otra: 1 }, { hostsPrimarios: [], origen: "manual", detectadoAt: "2026-09-17T00:00:00.000Z" });
    expect(r.rechazados[0]?.motivo).toMatch(/hechos/);
  });
});
```

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run packages/pipeline/test/hechos.test.ts`
Expected: FAIL (`importarHechos` no existe).

- [ ] **Step 3: Implementar**

`packages/pipeline/src/hechos.ts`:

```ts
import { HechoEntradaSchema, clasificarHecho, type HechoExterno } from "@thesis/core";
import type { RadarStore } from "./store.js";

/**
 * El importador de hechos externos (17/9). Único camino de escritura a `hechos_externos`: valida con el esquema,
 * decide `verificado` por el host de la fuente, y guarda. Lo que no valida se rechaza con su motivo y no frena al resto.
 * El agente que arma el JSON nunca toca la base: deja el archivo y esto lo lee.
 */
export interface ImportacionDeHechos {
  guardados: number;
  verificados: number;
  noVerificados: number;
  rechazados: Array<{ indice: number; motivo: string }>;
}

export async function importarHechos(store: Pick<RadarStore, "saveHechos">, input: unknown, o: { hostsPrimarios: readonly string[]; origen: "agente" | "manual"; detectadoAt: string }): Promise<ImportacionDeHechos> {
  const lista = Array.isArray(input) ? input : input && typeof input === "object" && Array.isArray((input as { hechos?: unknown }).hechos) ? (input as { hechos: unknown[] }).hechos : null;
  if (!lista) return { guardados: 0, verificados: 0, noVerificados: 0, rechazados: [{ indice: -1, motivo: "el archivo tiene que ser un arreglo o un objeto { hechos: [...] }" }] };
  const rechazados: ImportacionDeHechos["rechazados"] = [];
  const aceptados: HechoExterno[] = [];
  lista.forEach((raw, indice) => {
    const p = HechoEntradaSchema.safeParse(raw);
    if (!p.success) {
      rechazados.push({ indice, motivo: p.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ").slice(0, 300) });
      return;
    }
    aceptados.push(clasificarHecho(p.data, o));
  });
  const guardados = aceptados.length ? await store.saveHechos(aceptados) : 0;
  return { guardados, verificados: aceptados.filter((h) => h.estado === "verificado").length, noVerificados: aceptados.filter((h) => h.estado !== "verificado").length, rechazados };
}
```

`packages/pipeline/src/index.ts`: agregar `export * from "./hechos.js";`.

`config/hechos-fuentes.json`:

```json
{
  "hostsPrimarios": [
    "sec.gov",
    "fda.gov",
    "cms.gov",
    "ferc.gov",
    "nrc.gov",
    "federalregister.gov",
    "whitehouse.gov",
    "prnewswire.com",
    "globenewswire.com",
    "businesswire.com"
  ]
}
```

`apps/api/src/config.ts`:
- en `RadarConfig`: `/** Hosts cuya URL vale como fuente primaria de un hecho externo (config/hechos-fuentes.json): reguladores y cables de comunicados. */ hechosFuentes: string[];`
- `const HechosFuentesSchema = z.object({ hostsPrimarios: z.array(z.string().min(1)) });`
- en `loadRadarConfig`: `hechosFuentes: HechosFuentesSchema.parse(await read("hechos-fuentes.json")).hostsPrimarios,`
- actualizar el comentario de `loadRadarConfig` para nombrar el archivo nuevo.

`apps/api/src/container.ts`:
- import: agregar `EdgarOfferForms` al import de `@thesis/adapters`.
- antes de `const radarDeps`: `const ofertas = new EdgarOfferForms(http);`
- reemplazar `filingsDeOferta: (symbol) => store.offerFilingTitles(symbol),` por:

```ts
    // Lo guardado en raw_events si hay; si no, EDGAR en vivo (17/9): la regla tiene que llegar a toda la preselección y
    // al comando mercado, no sólo al universo de ingesta. Un pedido por símbolo, cacheado en el proceso, sin escribir.
    filingsDeOferta: async (symbol) => {
      const guardados = await store.offerFilingTitles(symbol);
      return guardados.length ? guardados : ofertas.offerFilingTitles(symbol, { today: todayLocal() });
    },
```

`apps/api/src/radar-cli.ts`:
- import: `import { readFile, writeFile } from "node:fs/promises";` y agregar `importarHechos` al import de `@thesis/pipeline`.
- `STEP`: agregar `hechos: "radar"`.
- antes del `else { console.error("uso: ...` agregar:

```ts
  // hechos --importar archivo.json [--origen agente|manual]: el único camino de escritura a hechos_externos (17/9).
  else if (cmd === "hechos") {
    const args = process.argv.slice(3);
    const i = args.indexOf("--importar");
    const archivo = i >= 0 ? args[i + 1] : undefined;
    if (!archivo) { console.error("uso: tsx src/radar-cli.ts hechos --importar archivo.json [--origen agente|manual]"); code = 1; }
    else {
      const origen = args[args.indexOf("--origen") + 1] === "manual" ? "manual" : "agente";
      const r = await importarHechos(c.store, JSON.parse(await readFile(archivo, "utf8")), { hostsPrimarios: cfg.radar.hechosFuentes, origen, detectadoAt: new Date().toISOString() });
      console.log(JSON.stringify(r, null, 2));
      if (r.guardados === 0) code = 1;
    }
  }
```
- actualizar el mensaje de uso final para incluir `hechos --importar archivo.json [--origen agente|manual]`.

- [ ] **Step 4: Correr y ver pasar; typecheck**

Run: `pnpm exec vitest run packages/pipeline/test/hechos.test.ts && pnpm -r --no-bail typecheck`
Expected: PASS; tipos ok (si `apps/api` tiene un test de config que lee todos los archivos de `config/`, corre también: `pnpm exec vitest run apps/api`).

- [ ] **Step 5: Commit**

```bash
git add config/hechos-fuentes.json packages/pipeline/src/hechos.ts packages/pipeline/src/index.ts packages/pipeline/test/hechos.test.ts apps/api/src/config.ts apps/api/src/container.ts apps/api/src/radar-cli.ts
git commit -m "feat(hechos): importador con validación y fuentes primarias; ofertas en vivo desde el contenedor

radar-cli hechos --importar valida cada hecho con el esquema, marca verificado
sólo si la fuente es un host de config/hechos-fuentes.json, y guarda en la
única tabla que este mecanismo escribe. El contenedor consulta EDGAR en vivo
cuando raw_events no tiene formularios del símbolo."
```

---

### Task 8: Pantallas: etiquetas, la ficha del ticker y la auditoría

**Files:**
- Modify: `apps/web/src/flagLabels.ts` (etiquetas y signo), `apps/web/src/api.ts` (`TickerPage.hechos`, tipo `HechoExterno`), `apps/web/src/Ticker.tsx` (tarjeta nueva)
- Create: `apps/web/src/hechos.ts` (texto puro), `apps/web/src/Hechos.tsx` (componente)
- Modify: `packages/pipeline/src/ticker.ts` (`TickerPage.hechos`, lectura)
- Test: `apps/web/src/flagLabels.test.ts` (caso), `apps/web/src/hechos.test.ts` (nuevo), `packages/pipeline/test/ticker.test.ts` (caso)

**Interfaces:**
- Consumes: `store.hechos(symbol, desde)`, `hechosVigentes`, `textoDeHecho` de `@thesis/core`.
- Produces: `TickerPage.hechos: HechoExterno[]` (vigentes, verificados o no); en web `hechoLinea(h): { chip: "verificado" | "no verificado"; texto: string; fecha: string; fuente: { url: string; titulo: string } }`.

- [ ] **Step 1: Escribir los tests**

`apps/web/src/flagLabels.test.ts`, dentro de `describe("flagLabel")` (o un `describe` nuevo):

```ts
  it("hechos externos (17/9): guía subida a favor, reservas y guía recortada como salvedad, reafirmada neutra", () => {
    expect(flagLabel("guia_subida")).toBe("subió la guía (hecho verificado)");
    expect(flagLabel("guia_recortada")).toBe("recortó la guía (hecho verificado)");
    expect(flagLabel("guia_reafirmada")).toBe("reafirmó la guía (hecho verificado)");
    expect(flagLabel("ganancia_por_reservas")).toBe("la ganancia lleva reservas liberadas: sin ellas no llega al consenso (hecho verificado)");
    expect(flagTone("guia_subida")).toBe("bueno");
    expect(flagTone("guia_recortada")).toBe("salvedad");
    expect(flagTone("ganancia_por_reservas")).toBe("salvedad");
    expect(flagTone("guia_reafirmada")).toBe("limitacion");
  });
```

`apps/web/src/hechos.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { hechoLinea } from "./hechos";

describe("hechoLinea", () => {
  it("arma texto, chip y fuente para los tres tipos", () => {
    const base = { primaria: true, estado: "verificado" as const, origen: "manual" as const, detectadoAt: "2026-09-17T00:00:00.000Z", vigenteHasta: null };
    expect(hechoLinea({ ...base, tipo: "guia", symbol: "FIVE", fecha: "2026-09-02", valor: { direccion: "sube", metrica: "EPS ajustado 2026", periodo: "FY2026", antes: "8,65-9,05", despues: "9,83-10,31" }, fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } })).toEqual({ chip: "verificado", fecha: "2026-09-02", texto: "subió la guía el 2026-09-02: EPS ajustado 2026 8,65-9,05 → 9,83-10,31", fuente: { url: "https://www.sec.gov/a", titulo: "8-K del 2/9/2026" } });
    expect(hechoLinea({ ...base, estado: "no_verificado", primaria: false, tipo: "oferta_de_compra", symbol: "WTRG", fecha: "2025-10-26", valor: { comprador: "American Water", efectivoUsd: null, ratio: { acciones: 0.305, de: "AWK" }, etapa: "falta Pensilvania", cierreEsperado: "1T 2027", formulario: "425" }, fuente: { url: "https://x", titulo: "nota" } }).chip).toBe("no verificado");
  });
});
```

`packages/pipeline/test/ticker.test.ts`: buscar el `describe` de `buildTicker` y agregar un caso que guarde un hecho en el `MemoryStore` del test (`clasificarHecho` de `@thesis/core`, como en la Task 6) y verifique `expect(page.hechos.map((h) => h.tipo)).toEqual(["guia"])` para ese símbolo, y `[]` para otro.

- [ ] **Step 2: Correr y ver fallar**

Run: `pnpm exec vitest run apps/web/src/flagLabels.test.ts apps/web/src/hechos.test.ts packages/pipeline/test/ticker.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`apps/web/src/flagLabels.ts`: en `FLAG_LABEL` agregar

```ts
  // Hechos externos (17/9): datos con fecha y fuente que carga el importador; la ficha muestra el detalle y el enlace.
  guia_subida: "subió la guía (hecho verificado)",
  guia_recortada: "recortó la guía (hecho verificado)",
  guia_reafirmada: "reafirmó la guía (hecho verificado)",
  ganancia_por_reservas: "la ganancia lleva reservas liberadas: sin ellas no llega al consenso (hecho verificado)",
```
y `guia_subida` en `BUENAS`, `guia_reafirmada` en `LIMITACIONES`.

`apps/web/src/api.ts`: tipo y campo:

```ts
export type HechoTipo = "guia" | "ganancia_por_reservas" | "oferta_de_compra";
export interface HechoExterno {
  tipo: HechoTipo;
  symbol: string;
  fecha: string;
  valor: Record<string, unknown>;
  fuente: { url: string; titulo: string };
  primaria: boolean;
  estado: "verificado" | "no_verificado";
  origen: "agente" | "manual";
  detectadoAt: string;
  vigenteHasta: string | null;
}
```
y en `TickerPage`: `/** Hechos externos vigentes (17/9): guía, reservas, oferta; los no verificados se muestran y no mueven nada. */ hechos?: HechoExterno[];`

`apps/web/src/hechos.ts` (puro, sin React; replica `textoDeHecho` del núcleo porque la web no importa `@thesis/core`):

```ts
import type { HechoExterno } from "./api";

const coma = (n: number) => String(n).replace(".", ",");
const millones = (usd: number) => `USD ${Math.round(usd / 1e6)} M`;

/** Texto de un hecho para la ficha. Mismo texto que `textoDeHecho` en el núcleo (el test de ahí es la referencia). */
export function textoDeHecho(h: HechoExterno): string {
  const v = h.valor as Record<string, unknown>;
  if (h.tipo === "guia") {
    const d = String(v["direccion"]);
    const verbo = d === "sube" ? "subió" : d === "baja" ? "recortó" : "reafirmó";
    return `${verbo} la guía el ${h.fecha}: ${String(v["metrica"])} ${(v["antes"] as string | null) ?? "—"} → ${(v["despues"] as string | null) ?? "—"}`;
  }
  if (h.tipo === "ganancia_por_reservas") {
    const consenso = v["epsConsenso"] as number | null;
    return `la ganancia del ${String(v["trimestre"])} lleva ${millones(Number(v["montoUsd"]))} de reservas liberadas: sin eso ${coma(Number(v["epsSinReservas"]))} contra ${consenso === null ? "—" : coma(consenso)} esperado`;
  }
  const ratio = v["ratio"] as { acciones: number; de: string } | null;
  const efectivo = v["efectivoUsd"] as number | null;
  if (ratio) return `vale ${coma(ratio.acciones)} acciones de ${ratio.de} (${String(v["comprador"])}, ${String(v["etapa"])})`;
  return `vendida a ${efectivo === null ? "—" : coma(efectivo)} en efectivo (${String(v["comprador"])}, ${String(v["etapa"])})`;
}

export function hechoLinea(h: HechoExterno): { chip: "verificado" | "no verificado"; fecha: string; texto: string; fuente: { url: string; titulo: string } } {
  return { chip: h.estado === "verificado" ? "verificado" : "no verificado", fecha: h.fecha, texto: textoDeHecho(h), fuente: h.fuente };
}
```

`apps/web/src/Hechos.tsx`:

```tsx
import type { HechoExterno } from "./api";
import { hechoLinea } from "./hechos";

/**
 * Hechos externos (17/9): lo que cargó el importador para este símbolo, con su estado y su fuente. Lo verificado
 * produce las banderas de la fila; lo no verificado se muestra igual, marcado, y no mueve nada.
 */
export function HechosCard({ hechos }: { hechos: HechoExterno[] }) {
  if (!hechos.length) return null;
  return (
    <div className="card">
      <b>Hechos externos</b> <span className="muted">· cargados por el importador; sólo los verificados (fuente primaria) cuentan en las banderas</span>
      {hechos.map((h) => {
        const l = hechoLinea(h);
        return (
          <div key={`${h.tipo}|${h.fecha}|${h.fuente.url}`} className="mono" style={{ marginTop: 4 }}>
            <span className={l.chip === "verificado" ? "ok" : "warn"}>{l.chip}</span> <span className="muted">{l.fecha} · {h.tipo.replace(/_/g, " ")}</span> · {l.texto} · <a href={l.fuente.url} target="_blank" rel="noreferrer">{l.fuente.titulo}</a>
          </div>
        );
      })}
    </div>
  );
}
```

(si la hoja de estilos no tiene la clase `ok`, usar la que usa la verificación apta: buscar en `apps/web/src/Verification.tsx` cómo se pinta el chip "apta" y reusar esa clase).

`apps/web/src/Ticker.tsx`: `import { HechosCard } from "./Hechos";` y, justo antes de la tarjeta "Verificación y estados", `<HechosCard hechos={t.hechos ?? []} />`.

`packages/pipeline/src/ticker.ts`:
- import: `hechosVigentes, VENTANA_MAXIMA_DIAS, type HechoExterno` de `@thesis/core`.
- `TickerPage`: `/** Hechos externos vigentes (17/9), verificados o no: la ficha los muestra con su estado y su fuente. */ hechos: HechoExterno[];`
- en el `Promise.all` de `statements, allEvents, ...` agregar `store.hechos(symbol, addDays(opts.today, -VENTANA_MAXIMA_DIAS)).catch(() => [] as HechoExterno[])` como último elemento (`hechosTodos`), y en el `return` agregar `hechos: hechosVigentes(hechosTodos, opts.today),`.

- [ ] **Step 4: Correr y ver pasar; typecheck; auditoría de pantalla**

Run: `pnpm exec vitest run apps/web packages/pipeline && pnpm -r --no-bail typecheck`
Expected: PASS.

Después, con la skill `auditar-pantalla` sobre la ficha del ticker (origen de cada dato, que se entienda sin leer el código, que no contradiga al Radar): la sección tiene que decir de dónde sale cada hecho (enlace), su estado, y que lo no verificado no mueve nada.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/flagLabels.ts apps/web/src/flagLabels.test.ts apps/web/src/api.ts apps/web/src/hechos.ts apps/web/src/hechos.test.ts apps/web/src/Hechos.tsx apps/web/src/Ticker.tsx packages/pipeline/src/ticker.ts packages/pipeline/test/ticker.test.ts
git commit -m "feat(web): la ficha muestra los hechos externos con su estado y su fuente; etiquetas de las banderas nuevas

guia_subida en verde, guia_recortada y ganancia_por_reservas como salvedad,
guia_reafirmada neutra. Cada hecho con fecha, texto, chip de verificado y
enlace a la fuente, para contrastarlo sin abrir la base."
```

---

### Task 9: La skill `/hechos` y el agente de launchd

**Files:**
- Create: `.claude/skills/hechos/SKILL.md`, `scripts/launchd/run-hechos.sh`, `docs/hechos/README.md`
- Modify: `scripts/launchd/install.sh`, `scripts/launchd/uninstall.sh`

**Interfaces:**
- Consumes: `radar-cli.ts mercado --preselect 300 --sin-estados --top 300 --salida`, `radar-cli.ts hechos --importar`.
- Produces: `docs/hechos/<fecha>.json` (entrada del importador) y `docs/hechos/<fecha>.md` (registro), y el agente `com.thesis-engine.hechos` (sábados 09:00).

- [ ] **Step 1: La skill**

`.claude/skills/hechos/SKILL.md`:

```markdown
---
name: hechos
description: Busca hechos externos con fecha y fuente (guía, ganancia por reservas, oferta de compra) para las acciones que pasan el filtro técnico del Radar, arma un JSON y lo carga con el importador de la app. El agente escribe HECHOS, no veredictos; la app decide con reglas. Lo corre el dueño con /hechos o el cron de los sábados.
argument-hint: "[SÍMBOLOS...]"
disable-model-invocation: true
---

# /hechos — lo que la app no puede leer sola

## Reglas duras

1. **Hechos, no veredictos.** Nunca escribas "COMPRAR", "apta", ni un precio objetivo. Escribís lo que pasó, con cifra, fecha y URL.
2. **Sin URL con fecha no se escribe.** Lo que no encontraste se omite. Nunca se inventa un número para completar.
3. **Fuente primaria primero**: 8-K con exhibit 99 en sec.gov, DEFM14A/PREM14A/425, comunicado en prnewswire, globenewswire o businesswire. Un portal solo si no hay primaria, y el importador lo va a marcar `no_verificado`.
4. **No tocás la base.** Dejás un JSON y corrés el importador. El importador es el único que escribe, y en una sola tabla.
5. **Tope**: 60 símbolos y 6 agentes por corrida. Con símbolos como argumento, solo esos.
6. **No corras `rank` ni `refresh`.**

## Pasos

### 1. Candidatas (sin búsqueda)

```bash
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado --preselect 300 --sin-estados --top 300 --salida /tmp/hechos-candidatas.json
```

Del JSON, tomá `filas` (las que pasan el filtro técnico). Sacá las que en `hechos` ya tienen un hecho del mismo tipo con fecha en los últimos 60 días. Quedate con hasta 60, por `score` descendente. Si recibiste símbolos como argumento, usá esos y salteá este paso.

### 2. Agentes (búsqueda)

Lanzá agentes en paralelo, de a 10 símbolos, cada uno con búsqueda web y esta única tarea, palabra por palabra:

> Para cada símbolo, buscá el ÚLTIMO comunicado de resultados trimestrales (8-K con exhibit 99 en sec.gov, o el comunicado en el cable) y de ahí: (a) si la guía cambió: dirección (sube/baja/reafirma), métrica, período, rango anterior y nuevo; (b) SOLO en aseguradoras, reaseguradoras, aseguradoras hipotecarias y bancos: el desarrollo de reservas de años anteriores del trimestre, en dólares, cuántos puntos del ratio combinado, y la ganancia por acción publicada, la ganancia sin ese desarrollo (calculala: monto × (1 − tasa) ÷ acciones, y decí que es cálculo propio en el título de la fuente) y el consenso si lo hay; (c) cualquier DEFM14A, PREM14A, SC 14D9 o 425 presentado en los últimos 400 días: comprador, precio en efectivo o ratio de canje, etapa regulatoria, cierre esperado. Devolvé SOLO un arreglo JSON con objetos de esta forma exacta, sin texto alrededor:
> `{ "tipo": "guia" | "ganancia_por_reservas" | "oferta_de_compra", "symbol": "...", "fecha": "AAAA-MM-DD", "valor": {...}, "fuente": { "url": "...", "titulo": "..." } }`
> Formas de `valor`: guia `{ direccion, metrica, periodo, antes, despues }`; ganancia_por_reservas `{ trimestre, montoUsd, puntosCombinado, epsPublicado, epsSinReservas, epsConsenso }`; oferta_de_compra `{ comprador, efectivoUsd, ratio: { acciones, de } | null, etapa, cierreEsperado, formulario }`. Sin URL con fecha, no escribas el hecho. Nada de opiniones, precios objetivo ni veredictos. Al final, en una línea aparte fuera del JSON: cuántas búsquedas hiciste.

### 3. Juntar, importar, registrar

Uní los arreglos en `docs/hechos/<fecha>.json` como `{ "hechos": [...] }` y corré:

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts hechos --importar docs/hechos/<fecha>.json --origen agente
```

Escribí `docs/hechos/<fecha>.md` con: cuántos símbolos se miraron, cuántos hechos entraron (verificados / no verificados), cuántos se rechazaron y por qué (el importador lo imprime), y el costo: agentes lanzados, búsquedas declaradas por cada uno, tokens si el entorno los muestra. Nada más: el informe no propone compras.
```

`docs/hechos/README.md`:

```markdown
# Hechos externos

Cada corrida de `/hechos` deja acá `<fecha>.json` (lo que entró al importador) y `<fecha>.md` (qué entró, qué se rechazó y cuánto costó). El importador es `radar-cli.ts hechos --importar`, el único camino de escritura a `hechos_externos`. Solo lo verificado (fuente primaria, ver `config/hechos-fuentes.json`) produce banderas en el Radar.
```

- [ ] **Step 2: El script y el agente de launchd**

`scripts/launchd/run-hechos.sh`:

```zsh
#!/bin/zsh
# Corre la skill /hechos sin nadie en la terminal (sábados 09:00, antes del ranking del domingo). El agente sólo puede
# usar el CLI del Radar, búsqueda y lectura web, agentes y escribir en docs/hechos: nada más está permitido.
export PATH="$HOME/.nvm/versions/node/v24.15.0/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin"
cd "$(dirname "$0")/../.." || exit 1
for i in $(seq 1 60); do docker ps --format '{{.Names}} {{.Status}}' | grep -q "thesis-db.*healthy" && break; sleep 5; done
echo "[hechos] $(date '+%F %T') arranca"
claude -p "/hechos" \
  --allowedTools "Bash(pnpm --filter @thesis/api exec tsx src/radar-cli.ts *),Bash(cat *),Bash(ls *),Bash(mkdir *),Read,Write,Edit,Glob,Grep,WebSearch,WebFetch,Agent" \
  --permission-mode acceptEdits \
  --max-turns 200
echo "[hechos] $(date '+%F %T') termina con código $?"
```

`scripts/launchd/install.sh`: después del `for svc in api web; do ... done`, agregar:

```zsh
# El agente semanal de hechos externos (17/9): sábados 09:00, sin KeepAlive. Si la máquina duerme, corre al despertar.
chmod +x "$ROOT/scripts/launchd/run-hechos.sh"
PLIST="$HOME/Library/LaunchAgents/com.thesis-engine.hechos.plist"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.thesis-engine.hechos</string>
  <key>ProgramArguments</key><array><string>/bin/zsh</string><string>$ROOT/scripts/launchd/run-hechos.sh</string></array>
  <key>StartCalendarInterval</key><dict><key>Weekday</key><integer>6</integer><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOGS/hechos.log</string>
  <key>StandardErrorPath</key><string>$LOGS/hechos.err.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/com.thesis-engine.hechos" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "instalado com.thesis-engine.hechos (sábados 09:00, log en $LOGS/hechos.log)"
```

`scripts/launchd/uninstall.sh`: agregar `hechos` a la lista de servicios que hace `bootout` (si la lista es `for svc in api web`, pasar a `for svc in api web hechos`).

- [ ] **Step 3: Probar la skill a mano, con dos símbolos**

Desde una sesión de Claude Code en el worktree: `/hechos FIVE WTRG`. Esperado: el JSON del día en `docs/hechos/`, el importador reporta `guardados ≥ 1`, y `docs/hechos/<fecha>.md` con el costo. Verificar que el JSON no tiene ningún campo de veredicto ni precio objetivo. Si la skill corre bien, probar el script una vez: `zsh scripts/launchd/run-hechos.sh` (con `--max-turns 40` temporal si se quiere acotar) y mirar que termine con código 0.

- [ ] **Step 4: Instalar el agente**

`scripts/launchd/install.sh` (reinstala los tres). Verificar: `launchctl print gui/$(id -u)/com.thesis-engine.hechos | grep -i "calendar\|program"`.

- [ ] **Step 5: Commit**

```bash
git add .claude/skills/hechos/SKILL.md scripts/launchd/run-hechos.sh scripts/launchd/install.sh scripts/launchd/uninstall.sh docs/hechos/README.md docs/hechos/*.json docs/hechos/*.md
git commit -m "feat(hechos): la skill /hechos y el agente de launchd de los sábados

Un agente busca hechos con fecha y fuente para lo que pasa el filtro técnico
(tope 60 símbolos, 6 agentes), deja un JSON y corre el importador. Escribe
hechos, no veredictos. La primera corrida deja el costo en docs/hechos."
```

---

### Task 10: Verificar la salida, mergear, reiniciar

**Files:**
- Create: `docs/hechos/2026-09-17-manual.json` (los hechos del informe del 17/9, cargados a mano)
- Modify: `docs/mercado/2026-09-17.md` (una nota al final: qué quedó hecho), memoria del proyecto

- [ ] **Step 1: Cargar a mano los casos reales del 17/9**

`docs/hechos/2026-09-17-manual.json`:

```json
{ "hechos": [
  { "tipo": "guia", "symbol": "FIVE", "fecha": "2026-09-02", "valor": { "direccion": "sube", "metrica": "ganancia ajustada por acción fiscal 2026", "periodo": "FY2026", "antes": "8,65-9,05", "despues": "9,83-10,31" }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/1177609/000117760926000023/q22026fivebelowexhibit991.htm", "titulo": "8-K del 2/9/2026, exhibit 99.1" } },
  { "tipo": "ganancia_por_reservas", "symbol": "PGR", "fecha": "2026-07-15", "valor": { "trimestre": "2T 2026", "montoUsd": 551000000, "puntosCombinado": 2.6, "epsPublicado": 4.85, "epsSinReservas": 4.11, "epsConsenso": 4.70 }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/0000080661/000008066126000262/pgr202606ex99earningsrelea.htm", "titulo": "8-K del 15/7/2026 (EPS sin reservas: cálculo propio del informe del 17/9)" } },
  { "tipo": "ganancia_por_reservas", "symbol": "RNR", "fecha": "2026-07-22", "valor": { "trimestre": "2T 2026", "montoUsd": 199400000, "puntosCombinado": 9.1, "epsPublicado": 12.92, "epsSinReservas": 9.5, "epsConsenso": 11.44 }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/913144/000091314426000081/rnrearningsrelease2026q2.htm", "titulo": "8-K del 22/7/2026 (EPS sin reservas: estimación del informe del 17/9)" } },
  { "tipo": "ganancia_por_reservas", "symbol": "ESNT", "fecha": "2026-08-07", "valor": { "trimestre": "2T 2026", "montoUsd": 29000000, "puntosCombinado": null, "epsPublicado": 2.08, "epsSinReservas": 1.74, "epsConsenso": 1.77 }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/1448893/000144889326000024/esnt-20260630.htm", "titulo": "10-Q del 7/8/2026, nota 5 (EPS sin reservas: cálculo propio del informe del 17/9)" } },
  { "tipo": "oferta_de_compra", "symbol": "WTRG", "fecha": "2025-10-26", "valor": { "comprador": "American Water", "efectivoUsd": null, "ratio": { "acciones": 0.305, "de": "AWK" }, "etapa": "falta la PUC de Pensilvania (acuerdo no unánime del 15/9) e Illinois; cierre previsto 1T 2027", "cierreEsperado": "2027-03-31", "formulario": "425" }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/78128/000155278125000341/e25376_ex99-1.htm", "titulo": "8-K del 27/10/2025" } },
  { "tipo": "oferta_de_compra", "symbol": "ROKU", "fecha": "2026-09-01", "valor": { "comprador": "Fox", "efectivoUsd": 96, "ratio": { "acciones": 0.9693, "de": "FOXA" }, "etapa": "DOJ pidió más información el 8/9; asambleas el 14/10", "cierreEsperado": "2027-06-30", "formulario": "DEFM14A" }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/0001428439/000119312526377700/d413482ddefm14a.htm", "titulo": "DEFM14A del 1/9/2026" } },
  { "tipo": "oferta_de_compra", "symbol": "AES", "fecha": "2026-05-15", "valor": { "comprador": "GIP (BlackRock) y EQT", "efectivoUsd": 15, "ratio": null, "etapa": "accionistas 26/6, CFIUS 27/8; faltan FERC y comisiones estaduales", "cierreEsperado": null, "formulario": "DEFM14A" }, "fuente": { "url": "https://www.sec.gov/Archives/edgar/data/874761/000119312526084157/d100078dex991.htm", "titulo": "8-K del 2/3/2026" } }
] }
```

(La oferta de WTRG lleva efectivo nulo y ratio; la de ROKU lleva efectivo y ratio: el texto usa el ratio si existe. Es una limitación conocida de esta etapa: una oferta mixta se describe por su parte en acciones.)

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts hechos --importar docs/hechos/2026-09-17-manual.json --origen manual
```

Expected: `guardados: 7, verificados: 7, noVerificados: 0, rechazados: []`.

- [ ] **Step 2: Verificar con el comando, que no escribe**

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado ROKU WTRG AES DV BZH BWMN FIVE PGR RNR ESNT HG --salida /tmp/verif-17-9.json
python3 - <<'EOF'
import json
m=json.load(open('/tmp/verif-17-9.json'))
for f in m['filas']: print(f['symbol'], f['verdict'], [x for x in f['flags'] if x in ('bajo_oferta_de_compra','guia_subida','ganancia_por_reservas')], [h['tipo']+':'+h['estado'] for h in f['hechos']])
for d in m['descartadas']: print('descartada', d['symbol'], d['motivo'])
EOF
```

Expected:
- ROKU, WTRG, AES: `OBSERVAR` con `bajo_oferta_de_compra` (por el hecho y, si EDGAR responde, también por el formulario).
- DV, BZH, BWMN: `OBSERVAR`; con `bajo_oferta_de_compra` si EDGAR devuelve su PREM14A / DEFM14A (DV y BZH sí; BWMN quizá no tenga formulario todavía: se anota).
- FIVE: `COMPRAR` con `guia_subida`.
- PGR, RNR, ESNT: con `ganancia_por_reservas` (PGR y RNR siguen COMPRAR: la bandera resta convicción, no veredicto).
- HG: sin hecho cargado (no se cargó ninguno): sin bandera nueva.

Y con preselección 300 (el config nuevo): `pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado --sin-estados --top 300 --salida /tmp/verif-300.json` → `preseleccionadas: 300`, y RNR, HG, ARW, GL, ESNT, IOSP, ARGX en `filas`.

- [ ] **Step 3: Verificación completa y merge**

```bash
pnpm verificar && pnpm test:db
git push . HEAD:master
```

Expected: verde en los dos; el hook `pre-push` vuelve a correr `verificar`; master avanza. Después, desde el repo principal: `git log --oneline -1` muestra el último commit de la rama.

- [ ] **Step 4: Reiniciar la API fuera de la corrida de la mañana**

Nunca entre las 07:30 y las 08:10 de un día hábil, ni con `GET /radar/scan-status` en `running: true`:

```bash
launchctl kickstart -k gui/$(id -u)/com.thesis-engine.api
sleep 20; curl -s localhost:3002/radar/scan-status | head -c 200
pnpm consistencia
```

Expected: la API vuelve a levantar; `consistencia` sin graves.

- [ ] **Step 5: Anotar y cerrar**

- Al final de `docs/mercado/2026-09-17.md`, una sección corta "Qué quedó hecho el 17/9 a la noche" con: P2 (300), P5b, hechos externos (tabla, importador, reglas, puerta), skill y cron; y la fecha en que se verifica: ranking del domingo 20/9, Radar del lunes 21/9 (RNR, HG, ARW, GL, ESNT, IOSP, ARGX evaluadas; FIVE por la puerta; ninguna vendida en COMPRAR).
- Memoria del proyecto (`comando-mercado.md` o una nota nueva `hechos-externos.md`): qué es, la regla "hechos, no veredictos", el cron de los sábados, el costo de la primera corrida cuando se conozca, y que el lunes 21/9 hay que mirar el Radar.
- Commit de docs con ruta explícita y `git push . HEAD:master`.

---

## Self-review (hecho al escribir el plan)

- **Cobertura del spec**: pieza 1 → Task 1; pieza 2 → Tasks 2, 3, 6, 7; pieza 3 → Tasks 4, 5, 6, 7, 8; pieza 4 → Task 9; pieza 5 → Task 10. Fuera de alcance del spec: nada acá lo toca.
- **Sin marcadores**: no hay "TBD" ni "similar a"; cada paso de código lleva el código.
- **Nombres**: `EdgarOfferForms.offerFilingTitles` (Tasks 2, 7); `HechoExterno`, `HechoTipo`, `HechoEntradaSchema`, `clasificarHecho`, `hechosVigentes`, `banderasDeHechos`, `textoDeHecho`, `simbolosConPuerta`, `VENTANAS_DIAS`, `VENTANA_MAXIMA_DIAS`, `PUERTA_TOPE` (Tasks 4, 5, 6, 8); `saveHechos`, `hechos`, `hechosPorTipo` (Tasks 5, 6, 7, 8); `hechosDe` (Tasks 6, 8 vía ticker no lo usa: la ficha llama a `store.hechos` y `hechosVigentes` directo); `importarHechos` (Tasks 7, 9); `FilaMercado.hechos` (Tasks 6, 9, 10).
