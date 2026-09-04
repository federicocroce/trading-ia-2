# thesis-engine

Sistema de tesis de inversión basadas en eventos, medido en paper trading antes de tocar capital real. El diseño completo está en [`docs/DESIGN.md`](docs/DESIGN.md); lo que no está ahí, no entra.

## Estado

Etapa 1 (esqueleto): tipos, contratos, módulo de riesgo y base de datos. Sin ingesta ni razonamiento todavía.

## Setup

```bash
pnpm install
cp .env.example .env
pnpm db:up          # Postgres en :5433 vía Docker
pnpm db:migrate     # aplica drizzle/*.sql
pnpm test
pnpm typecheck
pnpm dev:api        # GET http://localhost:3001/health
```

## Estructura

```
packages/core      tipos Zod, contratos de los 5 módulos, motor de riesgo (puro, testeado)
packages/db        schema Drizzle + migraciones (test de paridad de enums con core)
packages/adapters  un Ingestor por fuente (etapa 2)
apps/api           Hono; hoy solo /health
docs/DESIGN.md     documento de referencia
```

## Reglas que no se negocian

Viven en `packages/core/src/risk/rules.ts`, no en prompts: 10% máx. por tesis, 30% por tipo de evento, 3% en prima de opciones, pausa al -3% diario, edge mínimo 0.10, cero apalancamiento, ejecución solo con aprobación humana.
