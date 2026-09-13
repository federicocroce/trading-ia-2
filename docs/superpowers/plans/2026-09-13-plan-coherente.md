# Plan coherente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la app, con los datos del 13/9, dé el mismo plan que la verificación manual y explique cada exclusión.

**Architecture:** reglas puras en `packages/core`, cableado en `packages/pipeline`, textos del modelo en `packages/reasoner`, pantalla en `apps/web`, chequeos en `pantallas.ts` / `consistency.ts`.

**Tech Stack:** TypeScript, vitest, pnpm workspaces, Postgres (drizzle).

**Spec:** `docs/superpowers/specs/2026-09-13-plan-coherente-design.md`

## Global Constraints

- Una regla nueva solo puede quitar premios, nunca castigos: ninguna fila pasa de OBSERVAR a COMPRAR por esto.
- Constantes: `ENTRY_STOP_ATR = 2.5`, `UNCONFIRMED_GROWTH_PCT = 100`, `FOMC_WINDOW_BUSINESS_DAYS = 3`.
- Textos en español rioplatense, banderas como nombres estables con etiqueta en `apps/web/src/flagLabels.ts`.
- Cada chequeo nuevo con un test que lo hace fallar con el caso real que lo motivó.
- Correr `DATABASE_URL=postgres://thesis:thesis@localhost:5433/thesis pnpm test` y `pnpm typecheck` antes de cada commit.

---

### Task 1: Stop de compra nueva

**Files:**
- Modify: `packages/core/src/cartera/stop.ts` (agregar `entryStop`, `ENTRY_STOP_ATR`)
- Modify: `packages/core/src/radar/candidate.ts` (`decideCandidate` input `held?: boolean`)
- Modify: `packages/core/src/radar/etf.ts` (`decideEtf(cfg, candles, spy, p, opts?: { newEntry?: boolean })`)
- Modify: `packages/core/src/radar/consistency.ts` (`stop_guardado` acepta los dos; nuevo `stop_dentro_del_ruido`)
- Test: `packages/core/src/cartera/stop.test.ts`, `packages/core/src/radar/candidate.test.ts`, `packages/core/src/radar/etf.test.ts`, `packages/core/src/radar/consistency.test.ts`

**Interfaces:**
- Produces: `entryStop(candles: Candle[], entryLow: number): number | null` = `round2(min(computeTrailingStop(candles), entryLow − ENTRY_STOP_ATR × atr(candles, 14)))`; null si falta cualquiera de los dos.

- [ ] Test `entryStop`: serie en retroceso donde el de seguimiento queda a 0,4 ATR → devuelve `entryLow − 2,5 ATR`; serie en tendencia fuerte donde el de seguimiento está más abajo → devuelve el de seguimiento; pocas velas → null.
- [ ] Test `decideCandidate`: la misma serie en retroceso da COMPRAR con `stop = entryLow − 2,5 ATR` y `target = entryHigh + 2 × (entryHigh − stop)`; con `held: true` da el de seguimiento; los veredictos de las series de `bajo_stop` y `stop_dentro_de_la_entrada` que ya existen no cambian.
- [ ] Test `decideEtf` con `newEntry: true` (stop ancho) y sin él (igual que hoy).
- [ ] Test consistencia: fila con el stop de compra nueva → sin hallazgo; fila con stop congelado (caso BEAM) → `stop_guardado` grave; COMPRAR no en cartera con stop a 0,4 ATR → `stop_dentro_del_ruido` grave.
- [ ] Implementar, correr, commit `fix(stop): una compra nueva no puede nacer con el stop dentro del ruido`.

### Task 2: Cableado del stop en el pipeline

**Files:**
- Modify: `packages/pipeline/src/radar.ts` (rank y refresh pasan `held`; ETFs pasan `newEntry: true`)
- Modify: `packages/pipeline/src/watchlist.ts` (pasa `held`)
- Modify: `packages/pipeline/src/consistency.ts` (pasa el conjunto de símbolos en cartera al chequeo)
- Test: `packages/pipeline/test/*` existente de refresh (fila en cartera conserva el de seguimiento)

- [ ] Test: refresh con una posición en cartera → la fila de ese símbolo tiene el stop de seguimiento; la de un símbolo que no está → stop ancho.
- [ ] Implementar, correr, commit.

### Task 3: Un solo objetivo por símbolo

**Files:**
- Modify: `packages/core/src/cartera/verdict.ts` (SUMAR: `target = computeTarget(entryTiming(candles)?.high ?? close, stop)`)
- Modify: `packages/pipeline/src/radar.ts:690` (`target: candidatePorSimbolo.get(v.symbol)?.target ?? v.target`)
- Modify: `packages/core/src/radar/pantallas.ts` (tipos con `target`; chequeo `objetivo_distinto`)
- Test: `packages/core/src/cartera/verdict.test.ts`, `packages/core/src/radar/pantallas.test.ts`

- [ ] Test pantallas: caso TSM del 13/9 (Radar 498,44, plan 472,46) → `objetivo_distinto` grave; iguales → nada; Cartera MANTENER con otro objetivo → nada.
- [ ] Test verdict: SUMAR usa el techo de la franja; MANTENER sigue desde el cierre.
- [ ] Implementar, correr, commit `fix(objetivo): TSM tenía dos objetivos para la misma compra`.

### Task 4: Ganancia, pérdida y consenso en "lo que más recomienda"

**Files:**
- Modify: `packages/core/src/radar/conviction.ts` (`gainPct`/`lossPct` desde `entryHigh`; `consensus`; salvedad informativa)
- Modify: `apps/api/src/*` ruta `/radar/top` si arma el objeto a mano
- Modify: `packages/core/src/radar/pantallas.ts` (`top` opcional; chequeo `dos_a_uno_falso`)
- Modify: `apps/api/src/auditar.ts` (pide `/radar/top`)
- Modify: `apps/web/src/Radar.tsx` (`TopPicks` dice la base y el consenso)
- Test: `packages/core/src/radar/conviction.test.ts`, `pantallas.test.ts`

- [ ] Test: fila NVDA del 13/9 → texto "(2 a 1)" con porcentajes que dan 2 a 1 desde 222,66; consenso 327 → se informa; objetivo sobre el consenso → salvedad sin penalidad.
- [ ] Test pantallas: pick con +9,12 / −1,56 → `dos_a_uno_falso` grave.
- [ ] Implementar, correr, commit.

### Task 5: Crecimiento sin confirmar

**Files:**
- Modify: `packages/core/src/radar/ranking.ts` (`UNCONFIRMED_GROWTH_PCT`, `unconfirmedGrowthKeys(f)`, `metricOf` las ignora)
- Modify: `packages/core/src/radar/candidate.ts` (`buildFlags` agrega `crecimiento_sin_confirmar`)
- Modify: `packages/core/src/radar/conviction.ts` (INFO) y `apps/web/src/flagLabels.ts` (etiqueta)
- Modify: `packages/core/src/radar/consistency.ts` (chequeo `crecimiento_sin_bandera`)
- Test: `ranking.test.ts`, `candidate.test.ts`, `consistency.test.ts`

- [ ] Test: NBN (sin estados, 123,89 / 133,39) → esas dos métricas no entran al eje y la bandera aparece; NVDA con estados (105,85) → entra; empresa sin estados con +40% → entra.
- [ ] Correr la regla contra las filas guardadas y listar a quién toca antes de commitear.
- [ ] Implementar, correr, commit `fix(ranking): NBN era 1° con un crecimiento de ingresos que no existe`.

### Task 6: Verificación con cuestionario nuevo y versión guardada

**Files:**
- Modify: `packages/reasoner/src/verifier.ts` (`RESEARCH_SYSTEM`: puntos y criterio de la spec §5)
- Modify: `packages/core/src/radar/types.ts` (`VerificationSummary.promptVersion?: string | null`)
- Modify: `packages/pipeline/src/radar-verify.ts` (`summary` copia `promptVersion`)
- Test: `packages/reasoner/test/*verifier*`, `packages/pipeline/test/*verify*`

- [ ] Test: el resumen guardado lleva la versión; el prompt contiene "EPS limpio", "historia propia de 5 años" y "300% del capital".
- [ ] Implementar, correr, commit.

### Task 7: Quién entra al plan y lugar vacío al núcleo

**Files:**
- Modify: `packages/core/src/radar/plan.ts` (`buyCandidates[].verification.current`, `sumarCandidates[].verification`, vacantes)
- Modify: `packages/pipeline/src/radar.ts` (`current = c.verification?.promptVersion === deps.verifier?.promptVersion`)
- Test: `packages/core/src/radar/plan.test.ts`, `estandar.test.ts`

- [ ] Test: 4 lugares, la 1ª con verificación vieja → afuera con "verificación pendiente con el cuestionario nuevo"; la 5ª apta vigente la reemplaza; si no hay reemplazo, el ETF satélite NO entra y la parte va al núcleo con nota; SUMAR con verificación con reservas → no se suma.
- [ ] Ajustar el test dorado si cambia, explicando por qué en el commit.
- [ ] Implementar, correr, commit.

### Task 8: Noticias de antimonopolio

**Files:**
- Modify: `packages/core/src/radar/news.ts` (patrón en `regulatorio`)
- Modify: `packages/reasoner/src/events.ts` (criterio moderado)
- Modify: `packages/pipeline/src/radar-events.ts` (prefiltro también sobre lo guardado en la ventana)
- Test: `packages/core/src/radar/news.test.ts`, `packages/pipeline/test/*events*`

- [ ] Test: los 5 titulares de NVDA del 10/9 pasan el prefiltro; "Nvidia price target raised" no pasa como regulatorio.
- [ ] Test: un titular guardado antes del último barrido que ahora matchea se manda al clasificador.
- [ ] Implementar, correr, commit.

### Task 9: Reunión de la Fed

**Files:**
- Create: `config/fomc.json`
- Create: `packages/core/src/radar/fomc.ts` (`nextFomcDecision(today, dates)`, `firstTrancheFrom(today, dates, window)`)
- Modify: `packages/core/src/radar/plan.ts` (nota y `firstTrancheFrom` en `ContributionPlan`)
- Modify: `packages/pipeline/src/radar.ts` y el loader de config en `apps/api`
- Modify: `apps/web/src/Radar.tsx` (PlanCard lo muestra)
- Test: `packages/core/src/radar/fomc.test.ts`, `plan.test.ts`

- [ ] Test: domingo 13/9/2026 → decisión 16/9 dentro de 3 días hábiles → primer tramo desde el 17/9; 1/9 → nada.
- [ ] Implementar, correr, commit.

### Task 10: Pantalla, auditoría y corrida real

- [ ] Etiquetas de banderas nuevas; TopPicks y PlanCard.
- [ ] Skill `auditar-pantalla` completa.
- [ ] Merge a master, refresco del Radar y del plan con los datos reales, `pnpm auditar` + `pnpm consistencia`.
- [ ] Comparar el plan resultante contra la verificación manual línea por línea; cada diferencia se reporta.
