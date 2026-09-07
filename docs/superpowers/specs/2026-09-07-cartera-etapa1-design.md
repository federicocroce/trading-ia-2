# Cartera — etapa 1 (diseño)

Fecha: 2026-09-07. Estado: aprobado por el dueño en conversación; implementación en curso.

Extiende `docs/DESIGN.md` con una capa nueva: **veredicto diario sobre las posiciones reales del dueño**, medido contra el índice. No reemplaza las tesis por evento; convive con ellas.

## 1. Objetivo

Cada mañana de rueda, para cada posición de la cartera real, la app dice **VENDER / REVISAR / MANTENER / SUMAR**, con stop, objetivo, ganancia acumulada, peso en cartera y el por qué en dos líneas. Cada veredicto queda guardado con el precio del papel y de SPY del día, y a los 7 y 30 días se mide si acertó contra "comprar SPY y no hacer nada".

Principios heredados (de `DESIGN.md` y de la evidencia medida en trading v1):

1. **Reglas duras en código, no en prompts.** El verbo lo deciden reglas puras y testeadas. El modelo escribe la narrativa y **solo puede degradar** MANTENER → REVISAR; nunca sube un verbo ni decide VENDER.
2. **Fail-closed.** Sin precio de hoy no hay veredicto: es REVISAR con aviso. Sin datos para el stop, se dice. Nunca se inventa un número.
3. **Todo se mide contra el índice.** Un veredicto sin medición posterior no existe.
4. **El sistema trae los números; el modelo razona.** Ningún dato financiero sale del modelo.

## 2. Alcance

**Entra:** posiciones cargadas a mano (importación única desde la base SQLite de trading v1 + alta/edición en la UI); operaciones como historial; veredicto diario por posición; panel de riesgo de cartera calculado; narrativa por posición con Gemini (o Claude); medición a 7 y 30 días contra SPY; pestaña *Cartera* en la UI; cron diario.

**No entra (etapas siguientes):** candidatos nuevos (COMPRAR), universo automático, Argentina/BYMA/CEDEARs, motor técnico de divergencias, DCF, cripto, integración con brokers.

## 3. Datos

### 3.1 Tablas nuevas (Postgres, Drizzle)

- `positions`: `symbol` (único, mayúsculas), `quantity`, `avg_cost`, `currency` ('USD'), `market` ('us' | 'adr' | 'ar'), `layer` ('riesgo' | 'nucleo' | 'cobertura', default 'riesgo'), `notes`, `updated_at`.
- `transactions`: `symbol`, `type` ('BUY' | 'SELL' | 'DIVIDEND' | 'TRANSFER'), `quantity`, `price`, `fees`, `date`, `currency`, `platform`, `external_id`, `notes`. Historial; no recalcula posiciones en esta etapa.
- `symbol_meta`: `symbol`, `name`, `country`, `industry`, `market_cap`, `updated_at`. Cache del perfil (Finnhub `profile2`), refrescado semanalmente. Si no hay key de Finnhub, `country` sale de `positions.market` ('adr' → AR) e `industry` queda nulo.
- `portfolio_verdicts`: `verdict_date`, `symbol`, `verb`, `reason` (regla), `narrative` (modelo, nullable), `warning` (nullable), `close` (precio de decisión), `spot`, `stop`, `target`, `gain_pct`, `weight_pct`, `spy_close`, `degraded_by` (nullable), `prompt_version` (nullable); medición: `close_7d`, `spy_7d`, `alpha_7d_pct`, `close_30d`, `spy_30d`, `alpha_30d_pct`, `measured_at`. Único por (`verdict_date`, `symbol`).
- `portfolio_risk`: `snapshot_date` (único), `report` (jsonb con lo de §5).

### 3.2 Fuentes

- **Velas diarias (OHLCV)**: Yahoo Finance chart API (gratis, sirve para `.BA` en la etapa 3). Respaldo: barras diarias de Alpaca (feed IEX). Puerto en core: `PriceHistory.candles(symbol, days)`.
- **Spot**: snapshot de Alpaca (ya integrado). Informa ganancia intradiaria; **no decide**.
- **SPY**: mismas velas.
- **Perfil** (país, industria, capitalización): Finnhub `profile2`, opcional.
- **Contexto para la narrativa**: títulos de los últimos filings del ticker (ya ingeridos en `raw_events`) y noticias RSS argentinas que mencionen la empresa (para ADRs).

### 3.3 Importación desde v1

Comando `pnpm import:v1 [ruta a trading.db]` (default `../trading/data/trading.db`). Lee `positions` y `transactions` con `node:sqlite` (sin dependencia nueva), mapea `symbols.type` ('adr' | 'us') a `market` y hace upsert. Idempotente: se puede correr dos veces sin duplicar (posiciones por símbolo; operaciones por `external_id` o por la tupla fecha+símbolo+tipo+cantidad+precio).

## 4. Reglas de decisión (puras, en `packages/core/src/portfolio`)

Portadas de trading v1 (`today-decisions.ts`), con sus tests.

- **Stop dinámico (chandelier)**: máximo de las últimas 22 velas menos 3 × ATR(22). Sube con la acción; nunca baja. `null` si hay menos de 23 velas.
- **Objetivo**: `close + 2 × (close − stop)` (riesgo/beneficio 2:1). `null` sin stop.
- **Precio de decisión**: el último **cierre** diario. El spot intradiario solo informa.
- **Precio viejo**: si la última vela tiene más de 4 días calendario → **REVISAR** con aviso ("no pude cotizar hoy"). Fail-closed.
- **Jerarquía** (en este orden):
  1. Precio viejo → REVISAR.
  2. Capa `nucleo`/`cobertura` con cierre bajo el stop → MANTENER con aviso (el stop duro no aplica a índices; evidencia v1 a 7 años: +62.6% vendiendo por stop vs. +166.0% sin tocar).
  3. Cierre ≤ stop → **VENDER**.
  4. Spot intradiario ≤ stop pero sin cierre abajo → MANTENER con aviso ("la venta se confirma con el cierre").
  5. Sin stop (faltan velas) → MANTENER con aviso.
  6. Criterio SUMAR (abajo) → **SUMAR**.
  7. Si no → **MANTENER**.
  Después de la regla corre la narrativa (§6): si el modelo pide degradar, un MANTENER o SUMAR pasa a **REVISAR** con el motivo del modelo y el stop nombrado. Ningún otro verbo cambia.
- **SUMAR** (única regla nueva; explícita y medible), las tres a la vez:
  - peso de la posición < 80% del peso igualitario (`100 / n` posiciones);
  - cierre > stop;
  - retorno de las últimas 21 velas ≤ +15% (no perseguir).

## 5. Panel de riesgo de cartera (calculado)

Un snapshot diario, en `portfolio_risk.report`:

- **Pesos** por posición (a precio de cierre) y valor total.
- **Concentración** por país e industria (participación de cada uno y HHI). Aviso si un país o industria supera 40%.
- **Correlación** entre posiciones sobre retornos diarios de 126 velas; se listan los pares con correlación > 0.7.
- **Beta** de cada posición contra SPY (63 velas) y beta de la cartera.
- **Estrés**: caída estimada de la cartera si SPY cae 20% = Σ peso × beta × (−20%). Es una aproximación lineal y se etiqueta como tal.
- **Liquidez**: volumen medio en dólares de 30 días y días necesarios para liquidar la posición al 10% del volumen diario.

Sin narrativa: son números. La narrativa por posición (§6) los recibe como contexto.

## 6. Narrativa (modelo)

Puerto en core: `PositionNarrator.narrate(input) → { narrative, degrade: boolean, degradeReason? }`. Implementaciones: Gemini (con la rotación de keys/modelos ya construida) y Anthropic. Se elige con la misma regla que el razonador (`resolveReasoner`).

Entrada: posición, veredicto de la regla con sus números, últimos 30 cierres resumidos, títulos de filings recientes, noticias que mencionen la empresa, hechos del panel de riesgo que la toquen (peso, concentración, correlación alta). Salida vía function call con schema estricto: `narrative` (máx. 2 oraciones, en español, cita los números que recibió), `degrade` (bool), `degradeReason` (obligatorio si `degrade`).

Reglas del prompt: no estimar datos que no recibió (decirlo); no proponer verbos; si ve deterioro concreto en un filing o noticia, pedir REVISAR con el motivo. El código aplica: `degrade` solo convierte MANTENER/SUMAR en REVISAR; cualquier otra cosa se ignora. Si el modelo falla, el veredicto se guarda sin narrativa y se anota el error: la regla no depende del modelo.

## 7. Medición

Job diario `measureVerdicts`: para cada veredicto con `verdict_date ≤ hoy − 7` y sin `close_7d`, busca el cierre del papel y de SPY 7 días después y guarda `alpha_7d_pct = (cierre_7d / cierre − 1) − (spy_7d / spy − 1)`. Ídem a 30 días.

Acierto por verbo: **VENDER** acierta si `alpha < 0` (el papel rindió menos que SPY después de salir); **MANTENER** y **SUMAR** aciertan si `alpha > 0`; **REVISAR** no se puntúa (es advertencia). La pestaña muestra, por verbo y horizonte: n, tasa de acierto, alpha medio. Con la nota de que los MANTENER diarios de una misma posición están correlacionados entre sí: sirven como tendencia, no como estadístico independiente.

## 8. API y UI

Rutas nuevas bajo `/cartera` (la ruta `/portfolio` existente sigue siendo el paper de tesis):

- `GET /cartera/positions`, `POST /cartera/positions` (upsert por símbolo), `DELETE /cartera/positions/:symbol`.
- `GET /cartera/transactions`, `POST /cartera/transactions`.
- `POST /cartera/run` (corre veredictos + riesgo ahora), `GET /cartera/verdicts` (los del último día), `GET /cartera/risk` (último snapshot), `GET /cartera/measurement` (agregados por verbo y horizonte).

UI: pestaña **Cartera**, primera del menú. Arriba, tabla de posiciones: símbolo, cantidad, costo, cierre, ganancia %, peso %, **verbo en color**, stop, objetivo, motivo (desplegable con la narrativa y el aviso). Botones: *Actualizar veredictos*, *Agregar posición*, editar/borrar por fila. Abajo: panel de riesgo (concentración, pares correlacionados, beta, estrés, liquidez) y medición contra SPY.

Cron: lunes a viernes 07:45 (después de la corrida de tesis de 07:30): `runPortfolio` y luego `measureVerdicts`.

## 9. Tests

- Core puro: chandelier (valores conocidos), objetivo, jerarquía completa de verbos (un test por rama), SUMAR (cada criterio por separado), métricas de riesgo (pesos, HHI, correlación, beta, estrés, liquidez) con series sintéticas, medición de alpha y acierto por verbo.
- Pipeline: `runPortfolio` con `MemoryStore` extendido, `PriceHistory` falso y narrador falso: guarda veredictos y riesgo; sin precio de hoy → REVISAR; el modelo no puede subir un verbo; fallo del modelo no bloquea. `measureVerdicts` completa 7d/30d y no repite.
- Importación: parser sobre una SQLite temporal creada en el test; idempotencia.
- DB: integración de las tablas nuevas (con limpieza).
- API: rutas de `/cartera` sobre `MemoryStore`.
- Narrador Gemini: forma del request y schema; salida inválida → sin narrativa.

## 10. Riesgos conocidos

- Yahoo es una API no oficial: puede cambiar. Por eso hay respaldo en Alpaca y la regla de precio viejo.
- El feed IEX de Alpaca subestima el volumen consolidado; la liquidez usa el volumen de Yahoo.
- La medición tarda 7 y 30 días en empezar a decir algo. Hasta entonces la pestaña lo dice explícitamente.
