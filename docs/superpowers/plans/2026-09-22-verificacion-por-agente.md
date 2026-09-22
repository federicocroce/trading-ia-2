# Verificación por agente Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la verificación web y la revisión antes de comprar las haga un agente de Claude Code por cron (hallazgos con fuente), y que la app decida por regla, sin llamar a Gemini para eso.

**Architecture:** El esquema del JSON del agente, el cuestionario, la versión y la regla que convierte hallazgos en dictamen viven en `@thesis/reasoner` (`agente.ts`), junto a `aplicarValuacion`/`aplicarFaltantes`. El pipeline arma la lista de pendientes e importa (valida, decide, guarda en las tablas existentes). La API elige verificador (`VERIFICADOR=agente|gemini`), deja de correr las vueltas de Gemini con el agente y expone `POST /radar/tras-verificar`. El CLI (`verificar --pendientes | --importar`) es la única puerta del agente. Skill `/verificar` + launchd lunes a viernes 08:15.

**Tech Stack:** TypeScript, zod, vitest, Hono, pnpm workspaces, launchd, Claude Code headless (`claude -p`).

**Spec:** `docs/superpowers/specs/2026-09-22-verificacion-por-agente-design.md`

## Global Constraints

- De la IA solo frena "evitar"; "evitar" solo con fuente primaria (hosts de `config/hechos-fuentes.json`).
- Extraordinarios es reserva solo si `epsLimpia ≤ epsConsenso × 1,03`, con los dos números.
- Topes por defecto: 8 verificaciones y 5 revisiones por día.
- Cron lunes a viernes 08:15; espera hasta 3 horas a `job_runs.radar.last_date = hoy`.
- `VERIFICADOR=agente` por defecto; `VERIFICADOR=gemini` vuelve a lo anterior.
- Integración solo con `pnpm test:db`; nunca `rank`/`refresh` a mano; `git add` con rutas explícitas.
- Commits terminan con `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

### Task 1: Regla y esquema del agente (reasoner)

**Files:**
- Create: `packages/reasoner/src/agente.ts`
- Modify: `packages/reasoner/src/verifier.ts` (agregar `aplicarExtraordinarios` junto a `aplicarValuacion`)
- Modify: `packages/reasoner/src/index.ts` (exportar `./agente.js`)
- Test: `packages/reasoner/test/agente.test.ts`

**Interfaces:**
- Produces:
  - `VerificacionAgenteSchema`, `RevisionAgenteSchema` (zod), tipos `VerificacionAgente`, `RevisionAgente`
  - `EVITAR_MOTIVOS`, `OBJECION_TIPOS`, `CUESTIONARIO_AGENTE: string`, `AGENTE_VERSION: string`, `AGENTE_REVISION_VERSION: string`
  - `aplicarExtraordinarios<T extends {verdict; reason; reservas: Reserva[]}>(v: T, eps: { limpia: number | null; consenso: number | null }): T`
  - `dictamenDeVerificacion(v: VerificacionAgente, hostsPrimarios: readonly string[]): VerifierResult`
  - `dictamenDeRevision(r: RevisionAgente): PreTradeReviewResult`
  - `class AgentVerifier implements CandidateVerifier` (`porAgente = true`, `verify()` lanza)
  - `class AgentReviewer implements PreTradeReviewer` (`porAgente = true`, `review()` lanza)

- [ ] **Step 1: Tests con los casos reales** — SEZL (extraordinario 1,9 M, limpia 1,13 vs 0,95 → apto), BSM (limpia debajo → con reservas), AII (evitar sin fuente primaria → reserva; con seis faltantes → con reservas), ATEX (evitar con 8-K en sec.gov → evitar), APH (valuación 29,5 en 22–32,5 + insiders por opciones que el agente no lista → apto), revisión SMCI (Kuehn Law descartada; 10-K válido → objeción), búsqueda no hecha → no_pude_verificar, hallazgo sin URL → el esquema rechaza, versiones con prefijo.
- [ ] **Step 2: Correr y ver que fallan** — `pnpm exec vitest run packages/reasoner/test/agente.test.ts` → FAIL (módulo inexistente).
- [ ] **Step 3: Implementar** `agente.ts` y `aplicarExtraordinarios` (código en la rama).
- [ ] **Step 4: Correr y ver que pasan.**
- [ ] **Step 5: Commit** `feat(verificador): el agente escribe hallazgos con fuente y la app decide`.

### Task 2: Pipeline — pendientes, importador, y no llamar al verificador del agente

**Files:**
- Modify: `packages/core/src/radar/types.ts` (`porAgente?: boolean` en `CandidateVerifier` y `PreTradeReviewer`)
- Modify: `packages/pipeline/src/radar-verify.ts` (`verifyFor`: con `porAgente` devuelve lo guardado sin llamar ni gastar presupuesto)
- Modify: `packages/pipeline/src/radar.ts` (`reviewPending`: con `porAgente` no hace nada)
- Create: `packages/pipeline/src/agente.ts` (`pendientesDelAgente`, `importarDelAgente`)
- Test: `packages/pipeline/src/agente.test.ts`, `packages/pipeline/src/radar-verify.test.ts`

**Interfaces:**
- Consumes: todo lo de la Task 1.
- Produces:
  - `pendientesDelAgente(deps: Pick<RadarDeps,"store"|"verifier"|"reviewer">, opts: { today: string; topeVerificaciones: number; topeRevisiones: number; simbolos?: string[] }): Promise<{ hoy; version; versionRevision; cuestionario; verificar: Array<{symbol; nombre; contexto}>; revisar: Array<{symbol; nombre; verificacion; linea}> }>`
  - `importarDelAgente(store, archivo: unknown, opts: { hostsPrimarios: readonly string[]; today: string; version: string; versionRevision: string; ensayo?: boolean }): Promise<{ verificados: Array<{symbol; verdict; reason}>; revisados: Array<{symbol; verdict; reason}>; rechazados: Array<{symbol: string | null; motivo: string}> }>`

- [ ] Tests: orden (plan → pendientes del plan → COMPRAR por convicción sin bloqueo fijo), topes, vigentes excluidas, símbolos forzados; importador guarda con la versión del agente, rechaza ítems inválidos uno por uno sin tirar el archivo, `ensayo` no escribe; `verifyFor` y `reviewPending` con `porAgente` no llaman.
- [ ] Implementar, correr, commit `feat(pipeline): pendientes e importador del agente de verificación`.

### Task 3: API — elegir verificador, apagar las vueltas, ruta, CLI y config

**Files:**
- Modify: `apps/api/src/config.ts` (`verificador: "agente" | "gemini"`; `RadarConfig.agente` desde `config/verificacion-agente.json`)
- Create: `config/verificacion-agente.json` (`{ "topeVerificaciones": 8, "topeRevisiones": 5 }`)
- Modify: `apps/api/src/container.ts` (`buildVerifier`/`buildReviewer` con el modo)
- Modify: `apps/api/src/verificaciones.ts` (exportar `refrescarTrasVerificar`; con `porAgente` no corre)
- Modify: `apps/api/src/revisiones.ts` (con `porAgente` no corre)
- Modify: `apps/api/src/routes/radar.ts` (`POST /radar/tras-verificar` `{ symbols: string[] }`)
- Modify: `apps/api/src/radar-cli.ts` (`verificar --pendientes [--salida f] [SÍMBOLOS…]`, `verificar --importar f [--ensayo]`)
- Test: `apps/api/src/verificaciones.test.ts`, `apps/api/src/revisiones.test.ts`, `apps/api/src/config.test.ts` si existe

- [ ] Tests: con el verificador del agente las vueltas no llaman ni guardan "no pude verificar"; config lee el modo y los topes.
- [ ] Implementar, `pnpm verificar`, commit `feat(api): la verificación la hace el agente; Gemini queda para lo demás`.

### Task 4: Skill, cron e instalación

**Files:**
- Create: `.claude/skills/verificar/SKILL.md`
- Create: `scripts/launchd/run-verificar.sh`
- Modify: `scripts/launchd/install.sh`, `scripts/launchd/uninstall.sh`
- Create: `docs/verificaciones/README.md`

- [ ] Skill: pendientes → agentes de a 2 símbolos con el cuestionario del JSON → `docs/verificaciones/<fecha>.json` → `verificar --importar` → `docs/verificaciones/<fecha>.md` con costo. Reglas duras de `/hechos`.
- [ ] `run-verificar.sh`: espera Docker y el refresco del día (hasta 3 h), corre `claude -p "/verificar"` con herramientas acotadas.
- [ ] Plist lunes a viernes 08:15. Commit `feat(verificar): skill y cron del agente de verificación`.

### Task 5: Verificar la salida antes de encender el cron

- [ ] Merge a master, reinicio de la API, `consistencia` y `auditar`.
- [ ] Corrida a mano: `claude -p "/verificar SEZL SMCI AII APH"` con `--ensayo` en el importador; comparar contra lo esperado de la spec.
- [ ] Mostrar al dueño. Recién con su visto bueno: importar de verdad e instalar el plist.
