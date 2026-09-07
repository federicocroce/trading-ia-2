# thesis-engine

Sistema de tesis de inversión basadas en eventos, medido en paper trading antes de tocar capital real. El diseño de referencia está en [`docs/DESIGN.md`](docs/DESIGN.md); lo que no está ahí, no entra.

## Estado

Etapas 1 a 6 implementadas y testeadas (85 tests, incluida integración contra Postgres). Falta lo único que no se puede hacer sin vos: correrlo en vivo y acumular tesis en paper.

| Módulo | Dónde | Qué hace |
|---|---|---|
| Ingesta | `packages/adapters` | EDGAR (filings por ticker), calendario de earnings de Nasdaq, RSS argentino (Boletín Oficial, Ámbito, Infobae), CourtListener, CSV manual para fechas PDUFA/fallos/licitaciones |
| Filtro | `packages/core/src/filter` | Dedupe, ventana 5–45 días, liquidez, allowlist de ADRs, presupuesto diario con prioridad por tipo |
| Razonamiento | `packages/reasoner` | Claude (Anthropic) o Gemini Flash free tier con rotación de keys/modelos; mismo prompt, tool use y JSON estricto en ambos; guía por tipo de evento; `pMarket` se fuerza desde la cadena de opciones (straddle ATM), no lo decide el LLM |
| Riesgo | `packages/core/src/risk` | 10% por tesis, 30% por tipo, 3% en prima de opciones, pausa al -3% diario, edge mínimo 0.10, cero apalancamiento, kill switch, solo con aprobación humana |
| Paper trading | `packages/adapters/src/alpaca` | Broker Alpaca paper (el constructor rechaza cuentas reales), market data, opciones |
| Orquestación | `packages/pipeline` | Corrida diaria, aprobación/rechazo humano, cierre con PnL real, reporte de calibración (§7) |
| API + cron | `apps/api` | Hono; corrida diaria lun–vie 07:30, sync de órdenes cada 15 min |
| UI | `apps/web` | Propuestas (aprobar/rechazar), abiertas (cerrar), historial, calibración |

## Setup

Requisitos: Node 22+, pnpm, Docker Desktop.

```bash
pnpm install
cp .env.example .env        # completar ALPACA_KEY_ID/SECRET (paper), SEC_USER_AGENT y el razonador (ver abajo)
pnpm db:up                  # Postgres en :5433
pnpm db:migrate
pnpm test                   # 85 tests; los de integración corren solo si DATABASE_URL está en el env
pnpm smoke:sources          # verifica que EDGAR, Nasdaq y los RSS responden desde tu red
```

Claves de Alpaca paper: https://app.alpaca.markets → Paper Trading → Home → tarjeta *API Keys*. Las de cuenta real no sirven (y el código las rechaza).

Razonador: se elige solo según qué credenciales haya en `.env`. Con `ANTHROPIC_API_KEY` usa Claude; si no, con `GOOGLE_AI_API_KEY_1..4` usa Gemini Flash (free tier de https://aistudio.google.com, rotando keys y modelos ante cuota o 503); `REASONER=gemini|anthropic` fuerza uno. Las tesis de Gemini llevan `prompt_version` con sufijo `-gemini` para distinguirlas en calibración. Si el razonador falla en un evento, el evento queda pendiente y se reintenta en la corrida siguiente.

## Uso diario

```bash
pnpm dev:api                # API en :3001 + cron
pnpm dev:web                # UI en http://localhost:5173
pnpm run:daily              # una corrida a mano (ingesta → filtro → razonamiento)
```

Flujo: la corrida deja tesis en **Propuestas**. Vos abrís cada una, leés razonamiento e invalidación, y aprobás (pasa por riesgo y va a Alpaca paper) o rechazás (queda registrado, para medir tu criterio). Cuando el evento se resuelve, en **Abiertas** cerrás la posición diciendo si pasó lo predicho; eso alimenta **Calibración**.

Eventos con fecha que no tienen API gratuita (PDUFA, fallos, licitaciones) se cargan a mano en `config/events.csv`. El universo de tickers está en `config/universe.json`.

## Criterio de salida de paper (DESIGN.md §7)

La pestaña Calibración muestra en vivo si se cumple: ≥ 30 tesis cerradas, Brier del sistema mejor que el del mercado, PnL medio positivo, drawdown < 15%. Hasta que diga **SÍ**, no se habla de dinero real. Es probable que la primera versión no lo cumpla; ese resultado también sirve.

## Estructura

```
packages/core      tipos Zod, contratos, filtro, riesgo, pricing (probabilidad implícita)
packages/adapters  ingestors + Alpaca; tests con fixtures, sin red
packages/reasoner  prompts, tool schema, cliente Anthropic
packages/pipeline  dailyRun, approveAndExecute, closeThesis, calibrationReport, MemoryStore
packages/db        schema Drizzle, migraciones, Repo (test de paridad de enums con core)
apps/api           Hono + cron + CLI
apps/web           Vite + React
config/            universe.json, events.csv
docs/DESIGN.md     referencia
```

## Reglas que no se negocian

Viven en `packages/core/src/risk/rules.ts`, no en prompts. Cambiarlas requiere cambiar código y tests, a propósito.
