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
| Cartera real | `packages/core/src/cartera`, `packages/pipeline/src/cartera.ts` | Veredicto diario por posición con reglas duras, panel de riesgo calculado, narrativa que solo degrada, medición contra SPY a 7/30 días |
| Radar | `packages/core/src/radar`, `packages/pipeline/src/radar.ts` | Universo semanal (Alpaca + Finnhub), ranking contra pares, candidatos COMPRAR/OBSERVAR, ETFs, plan del aporte, taxonomía, medición 7/30/90 |
| UI | `apps/web` | Cartera (veredictos, riesgo, medición), Radar (candidatos, ETFs, plan, etiquetas), propuestas, abiertas, historial, calibración |

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

## Cartera real

Pestaña **Cartera** (primera del menú): tus posiciones reales con un veredicto diario por posición, **VENDER / REVISAR / MANTENER / SUMAR**, stop dinámico, objetivo, ganancia, peso, el por qué en dos líneas, un panel de riesgo calculado (concentración por país e industria, pares correlacionados, beta, estrés si SPY cae 20%, liquidez) y la medición de cada veredicto contra SPY a 7 y 30 días. Diseño en [`docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md`](docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md).

Reglas, no prompts: el verbo lo deciden reglas puras en `packages/core/src/cartera` (stop *chandelier* 22/3, jerarquía portada de trading v1, criterio SUMAR explícito). El modelo (Gemini o Claude) escribe la narrativa con los números que recibe y **solo puede degradar** MANTENER/SUMAR a REVISAR citando un filing o noticia; nunca sube un verbo ni decide VENDER. Sin precio de hoy, el veredicto es REVISAR con aviso: no se inventa nada.

```bash
pnpm import:v1 [ruta/a/trading.db]   # una vez: posiciones y operaciones desde trading v1 (busca ../trading y ../../trading)
curl -X POST localhost:3002/cartera/run   # o el botón "Actualizar veredictos"; el cron corre lun–vie 07:45 (CARTERA_CRON)
```

Posiciones y operaciones también se cargan y editan en la UI. Precios diarios de Yahoo con respaldo de Alpaca; perfil de empresa de Finnhub si hay `FINNHUB_API_KEY`. Importar requiere `node:sqlite` (Node 24; en Node 22, `NODE_OPTIONS=--experimental-sqlite`).

## Radar (candidatos nuevos)

Pestaña **Radar**: acciones US para **COMPRAR / OBSERVAR** y ETFs curados, más el **plan del aporte mensual**. Diseño en [`docs/superpowers/specs/2026-09-07-radar-etapa2-design.md`](docs/superpowers/specs/2026-09-07-radar-etapa2-design.md).

- **Universo** (domingo 20:00, `RADAR_SCAN_CRON`, o botón *Barrer universo*): ~12.500 acciones de Alpaca → precio ≥ 5 y volumen → fundamentals de Finnhub (≤ 55/min, ≈ 1 h) → capitalización ≥ USD 500M y volumen ≥ USD 5M/día. Reanudable: si se corta, retoma donde iba. Requiere `FINNHUB_API_KEY`.
- **Ranking**: fundamental primero, **contra pares** (mismo negocio): valuación, calidad, crecimiento y balance como z-scores dentro del grupo; pesos en `config/radar-policy.json`. Lo técnico filtra, no rankea: bajo la SMA200 queda afuera; subió > 15% en 21 ruedas o reporta en ≤ 10 días → OBSERVAR; 4ª semana seguida como candidato → OBSERVAR. Salen 40 con entrada, stop chandelier, objetivo 2:1, tamaño (1% de riesgo, tope 10%) y riesgo 1–10.
- **ETFs** (`config/etfs.json`): fuerza relativa contra SPY; los de núcleo se compran por calendario (NUCLEO), satélites y coberturas COMPRAR/OBSERVAR.
- **Plan del aporte** (1.º de mes 08:00, `RADAR_PLAN_CRON`): primero el núcleo hasta su objetivo, después SUMAR de Cartera y COMPRAR del Radar por score, con topes por línea y por posición. Montos en `config/radar-policy.json` (`contribution`).
- **Ficha** por candidato (modelo): qué hace, por qué rankea, riesgo principal, foso, temas sugeridos. Solo puede degradar COMPRAR → OBSERVAR citando un dato.
- **Taxonomía** (`config/taxonomia.json`): clase de activo, sector por industria y temas transversales (IA, defensa, argentina, bitcoin…). Reglas + sugerencias del modelo; lo que editás a mano nunca se pisa. Sirve para filtrar y para la concentración por sector y tema en Cartera.
- **Medición**: cada aparición se mide contra SPY a 7/30/90 días. OBSERVAR es el grupo de control: si COMPRAR no le gana, los filtros no agregan valor.

```bash
pnpm radar:scan      # barrido (reanudable; Ctrl+C corta al terminar el símbolo actual)
pnpm radar:rank      # ranking + candidatos + ETFs + fichas
pnpm radar:refresh   # refresco diario + medición
pnpm radar:plan      # plan del aporte del mes
```

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
