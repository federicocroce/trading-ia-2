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
| Cartera real | `packages/core/src/cartera`, `packages/pipeline/src/cartera.ts` | Veredicto diario por posición con reglas duras, panel de riesgo calculado, narrativa que solo degrada, medición contra SPY a 7/30 días, curva de la cartera desde las operaciones (TWR, XIRR, volatilidad, drawdown contra SPY) |
| Radar | `packages/core/src/radar`, `packages/pipeline/src/radar.ts` | Universo semanal (Alpaca + Finnhub), ranking contra pares, candidatos COMPRAR/OBSERVAR, ETFs, plan del aporte, taxonomía, medición 7/30/90 |
| Ficha por ticker | `packages/pipeline/src/ticker.ts`, `apps/api/src/routes/ticker.ts` | Página global por símbolo: perfil, precio vivo, gráfico, posición y veredicto, fundamentals y pares, tesis, operaciones, noticias. Todo servido desde la base |
| UI | `apps/web` | Cartera (veredictos, riesgo, medición), Radar (candidatos, ETFs, plan, etiquetas), ficha por ticker, propuestas, abiertas, historial, calibración |

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
pnpm dev                    # todo junto: Postgres (docker) + migraciones + API en :3001 + UI en http://localhost:5173
pnpm dev:api                # solo la API (:3001 + cron)
pnpm dev:web                # solo la UI (http://localhost:5173)
pnpm run:daily              # una corrida a mano (ingesta → filtro → razonamiento)
```

Flujo: la corrida deja tesis en **Propuestas**. Vos abrís cada una, leés razonamiento e invalidación, y aprobás (pasa por riesgo y va a Alpaca paper) o rechazás (queda registrado, para medir tu criterio). Cuando el evento se resuelve, en **Abiertas** cerrás la posición diciendo si pasó lo predicho; eso alimenta **Calibración**.

Eventos con fecha que no tienen API gratuita (PDUFA, fallos, licitaciones) se cargan a mano en `config/events.csv`. El universo de tickers está en `config/universe.json`.

## Cartera real

Pestaña **Cartera** (primera del menú): tus posiciones reales con un veredicto diario por posición, **VENDER / REVISAR / MANTENER / SUMAR**, precio vivo con la variación del día al lado, valor, P&L en USD y en %, totales de la cartera (solo posiciones en USD), stop dinámico, objetivo, peso, el por qué en dos líneas, un panel de riesgo calculado (concentración por país e industria, pares correlacionados, beta, estrés si SPY cae 20%, liquidez) y la medición de cada veredicto contra SPY a 7 y 30 días. Diseño en [`docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md`](docs/superpowers/specs/2026-09-07-cartera-etapa1-design.md).

**Curva de la cartera** (card en Cartera, `GET /cartera/curve`): la cartera reconstruida día a día desde las operaciones y las velas guardadas, sin pedir nada a la red. Un aporte no cuenta como ganancia: el retorno diario se calcula contra el valor de ayer más lo que entró hoy (TWR), y el índice base 100 encadena esos retornos; el drawdown se mide sobre ese índice, no sobre el valor (vender no es caer). Muestra total, anualizado (solo con 60 ruedas o más), XIRR con las fechas reales, volatilidad anualizada y caída máxima, los mismos números para comprar SPY y quedarse, y cuánto valdría la misma plata puesta en SPY en las mismas fechas (SPY sin dividendos). Traspasos se ignoran, USDC cuenta como USD, dividendos son retorno del día. Fail-closed: un papel sin velas queda afuera y se dice; si las operaciones no cuadran con la posición cargada, se dice; una operación posterior a la última vela espera a la próxima corrida. Una lectura en una línea, por regla y sin modelo, dice si le ganás a SPY y con cuánta volatilidad y caída. Se cachea 5 minutos y se invalida al tocar posiciones u operaciones (`?fresh=1` la fuerza).

Reglas, no prompts: el verbo lo deciden reglas puras en `packages/core/src/cartera` (stop *chandelier* 22/3, jerarquía portada de trading v1, criterio SUMAR explícito). El modelo (Gemini o Claude) escribe la narrativa con los números que recibe y **solo puede degradar** MANTENER/SUMAR a REVISAR citando un filing o noticia; nunca sube un verbo ni decide VENDER. Sin precio de hoy, el veredicto es REVISAR con aviso: no se inventa nada.

```bash
pnpm import:v1 [ruta/a/trading.db]   # una vez: posiciones y operaciones desde trading v1 (busca ../trading y ../../trading)
curl -X POST localhost:3002/cartera/run   # o el botón "Actualizar veredictos"; el cron corre lun–vie 07:45 (CARTERA_CRON)
```

Posiciones y operaciones también se cargan y editan en la UI. Precios diarios de Yahoo con respaldo de Alpaca; perfil de empresa de Finnhub si hay `FINNHUB_API_KEY`. El precio vivo de la tabla sale de Alpaca (Yahoo para los `.BA`) con 6 s de timeout por símbolo; si una fuente no responde, esa fila usa el cierre del veredicto y se ve apagada, y los totales avisan cuántas quedaron sin precio. Importar requiere `node:sqlite` (Node 24; en Node 22, `NODE_OPTIONS=--experimental-sqlite`).

## Radar (candidatos nuevos)

Pestaña **Radar**: acciones US para **COMPRAR / OBSERVAR** y ETFs curados, más el **plan del aporte mensual**. Diseño en [`docs/superpowers/specs/2026-09-07-radar-etapa2-design.md`](docs/superpowers/specs/2026-09-07-radar-etapa2-design.md).

- **Universo** (domingo 20:00, `RADAR_SCAN_CRON`, o botón *Barrer universo*): ~12.500 acciones de Alpaca → precio ≥ 5 y volumen → fundamentals de Finnhub (≤ 55/min, ≈ 1 h) → capitalización ≥ USD 500M y volumen ≥ USD 5M/día. Reanudable: si se corta, retoma donde iba. Requiere `FINNHUB_API_KEY`.
- **Ranking**: fundamental primero, **contra pares** (mismo negocio): valuación, calidad, crecimiento y balance como z-scores dentro del grupo; pesos en `config/radar-policy.json`. Lo técnico filtra, no rankea: bajo la SMA200 queda afuera; subió > 15% en 21 ruedas o reporta en ≤ 10 días → OBSERVAR; 4ª semana seguida como candidato → OBSERVAR. Salen 40 con entrada, stop chandelier, objetivo 2:1, tamaño (1% de riesgo, tope 10%) y riesgo 1–10.
- **ETFs** (`config/etfs.json`): fuerza relativa contra SPY; los de núcleo se compran por calendario (NUCLEO), satélites y coberturas COMPRAR/OBSERVAR.
- **Plan del aporte** (1.º de mes 08:00, `RADAR_PLAN_CRON`, o *Armar plan con este monto* con la plata que tengas líquida, `POST /radar/plan?amount=40000`): mientras el núcleo esté bajo su objetivo va el 60% del monto al núcleo (`coreSharePctWhileBelowTarget`); SUMAR de Cartera hasta el 30% del resto (`sumarSharePctOfRest`); nuevas por **convicción** repartidas parejo, respetando el máximo de posiciones nuevas, más una línea de tu seguimiento (`watchLinesMax`) y un ETF satélite (`etfLinesMax`); sobrante al núcleo. Cada línea trae cantidad, "comprar hasta", stop y objetivo del día; si la acción se mueve como algo que ya tenés, la razón de la línea lo dice. Montos y topes en `config/radar-policy.json` (`contribution`).
- **Lo que más recomienda hoy** (`GET /radar/top`): los COMPRAR ordenados por convicción = score × fiabilidad del grupo (pares/10, tope 1) + 0.2 por consenso de compra, insiders que compran o sorpresa positiva − 0.15/0.3 por banderas negativas − 0.1 por punto de riesgo sobre 5 − 0.3 si el objetivo queda a menos de 5% − 0.3 si comparte un tema donde la cartera ya supera 40% − 0.3 si **se mueve como una posición tuya** (correlación de retornos diarios > 0.7 en 126 ruedas, la misma vara del panel de riesgo; la salvedad nombra al papel: "se mueve como YPF que ya tenés"). Cada uno con razones y salvedades en palabras; "todo acompaña" = sin salvedades. El objetivo no es un pronóstico: es 2× la distancia al stop.
- **Ficha** por candidato (modelo): qué hace, por qué rankea, riesgo principal, foso, temas sugeridos. Solo puede degradar COMPRAR → OBSERVAR citando un dato.
- **Taxonomía** (`config/taxonomia.json`): clase de activo, sector por industria y temas transversales (IA, defensa, argentina, bitcoin…). Reglas + sugerencias del modelo; lo que editás a mano nunca se pisa. Sirve para filtrar y para la concentración por sector y tema en Cartera.
- **Medición**: cada aparición se mide contra SPY a 7/30/90 días. OBSERVAR es el grupo de control: si COMPRAR no le gana, los filtros no agregan valor.

```bash
pnpm radar:scan      # barrido (reanudable; Ctrl+C corta al terminar el símbolo actual)
pnpm radar:rank      # ranking + candidatos + ETFs + fichas
pnpm radar:refresh   # refresco diario + medición
pnpm radar:plan      # plan del aporte del mes
```

## Ficha por ticker

Cualquier símbolo de Cartera o Radar es clickeable y abre su página (`/?symbol=GGAL`, también sirve para un ticker que el sistema no conoce). Portada de trading v1, con la misma idea: todo lo que se sabe del papel en un solo lugar.

- **Perfil**: nombre, sector e industria, mercado, empleados, web, desde cuándo cotiza y resumen del negocio (Yahoo; se guarda 30 días).
- **Precio**: último precio de Alpaca con variación contra el cierre anterior; si el dato tiene más de 3 días lo marca como viejo.
- **Gráfico**: velas, línea o área, con volumen; 1D/1S intradía (Yahoo en vivo), 1M/3M/1A/5A diario. Dibuja costo promedio, stop y objetivo cuando existen.
- **Tu posición** y el veredicto vigente de Cartera con su razón, narrativa y aviso.
- **Fundamentales** de Finnhub (los del último barrido) y, si es candidato del Radar, la ficha, los ejes y la tabla contra pares.
- **Tesis** por evento, **operaciones** (compras, ventas, dividendos, total invertido; un traspaso entre plataformas no cuenta como inversión) y **noticias** (Finnhub 24 h), filings SEC y prensa argentina.

Qué se guarda y qué se pide en vivo: descripción, velas diarias (las refrescan Cartera y Radar al correr) y noticias van a la base (`symbol_meta`, `candles_daily`, `news`); precio y gráfico intradía se piden en el momento.

Regla de carga: lo guardado se sirve al instante. Si falta, se pide con un timeout de 6 s por fuente; si está viejo, se sirve igual y se refresca en segundo plano para la próxima visita. Las cuatro fuentes externas (descripción, velas, noticias, precio) corren en paralelo, así que la primera visita a un símbolo nuevo tarda lo que la más lenta (≈ 5 s) y las siguientes menos de 1 s. Una fuente colgada nunca bloquea la página: aparece en `errors`.

```
GET /ticker/:symbol                      # la página completa (JSON)
GET /ticker/:symbol/chart?range=1y&interval=1d
```

## Seguimiento y temas de moda

El Radar es un filtro de valor contra pares: las historias que ya están en el precio (energía para la IA, minerales críticos) rara vez entran como candidatas. Para eso hay dos herramientas:

- **Watchlist en barra lateral y cinta del header** (portadas de trading v1, con nuestros datos): la barra lateral lista tu seguimiento con precio vivo (Alpaca; Yahoo para `.BA`, gris y con ⚠ si el precio no es de hoy), búsqueda, filtro por tipo, orden (alta, mayor suba, mayor baja, por tipo), alta con **buscador de símbolos** (Yahoo search, `GET /symbols/search?q=`: bandera, tipo, nombre y mercado; solo bolsas US y Buenos Aires) y baja. Precios **en vivo en toda la app** (Cartera, watchlist, cinta y ficha) desde un hub en la API: un lote de Alpaca (Yahoo para `.BA`) cada 15 s con el mercado US abierto y cada 60 s fuera, empujado por SSE (`GET /prices/stream`; foto en `GET /prices/all`). Si el stream se corta, la UI cae a polling cada 30 s y el punto del encabezado se apaga. Cada ítem tiene **ciclo de vida**: al agregarlo se guarda la foto (precio, stop, objetivo y tesis del Radar si los hay, plazo 30 días) y cada refresco lo evalúa: 🟢 VIVA, 🎯 GATILLADA (tocó el objetivo), ❌ INVALIDADA (tocó el stop), ⏳ EXPIRADA (venció el plazo), con el retorno desde el alta. Los resueltos quedan marcados "para revisar". La cinta del header muestra los que más subieron y bajaron hoy entre todo lo que la app sigue (cartera, seguimiento, candidatos); click abre la ficha. Rutas: `GET /prices?symbols=A,B` y `GET /prices/tape` (caché 1 y 5 min).
- **Lista de seguimiento** (card *Seguimiento* en Radar, `GET/POST/DELETE /radar/watchlist`): tickers que elegís vos. Cada día reciben el mismo tratamiento que un candidato: veredicto técnico (COMPRAR sobre la SMA200 y sin haber corrido más de 15% en 21 ruedas; si no, OBSERVAR con la razón), stop chandelier, objetivo 2:1, tamaño, riesgo, y su rank contra pares si están en el universo. Filas con `kind: "watch"`: no entran en convicción ni en el plan del aporte. Se refrescan con el Radar (07:50, "Ponerme al día") y al agregar uno.
- **Temas** `energia_ia` (VST, CEG, TLN, NRG, OKLO, SMR, GEV, VRT, BE, ETN, PWR…) y `minerales_criticos` (MP, USAR, UUUU, ALB, SQM, FCX, SCCO, RIO, BHP…) en `config/taxonomia.json`, y ETFs satélite de cada tema en `config/etfs.json`: XLU, GRID, NLR y URA para energía; REMX, LIT y COPX para minerales. Los ETFs se deciden por fuerza relativa contra SPY, no por valuación: es la forma de estar en una narrativa sin pagar la acción cara.

## Argentina (etapa 3)

Card **Argentina** en la pestaña Radar. Corre todos los días con el refresco del Radar (lun–vie 07:50), con el botón *Refrescar Argentina* o con `pnpm radar:argentina`. Configuración en `config/argentina.json`.

- **Macro del día** (`macro_ar_daily`): dólar oficial, MEP, CCL, blue, mayorista (dolarapi.com), brecha CCL/oficial, riesgo país (argentinadatos.com) y Merval en pesos y en dólares. Se guarda la serie; la card muestra la variación contra el día anterior.
- **Acciones de BYMA** (Yahoo `.BA`, en pesos): misma regla que los ETFs satélite pero contra el **Merval**: COMPRAR si le ganan al índice a 6 meses y están sobre la SMA200, si no OBSERVAR con la razón. Sin score ni rank: Finnhub no cubre el mercado local; cuando el papel tiene ADR, la fila lo enlaza y los fundamentals están en la ficha del ADR. Precio también en dólares al CCL. Stop chandelier y objetivo 2:1 en pesos. Etiquetas por regla (`accion_ar`, sector de la config, tema `argentina`); lo manual no se pisa.
- **CEDEARs**: no son una recomendación, son un chequeo. Dólar implícito = precio local × ratio / precio en EE.UU.; contra el CCL: más de +2% caro, menos de −2% barato, más de 10% en cualquier sentido = ratio mal cargado (`ratio_dudoso`). Los ratios cambian con splits: el chequeo los delata.
- **Medición**: las acciones argentinas se miden contra el Merval (en pesos) a 7/30/90 días, no contra SPY. Los CEDEARs no se miden. Ninguna fila argentina entra en el top de convicción ni en el plan del aporte (que reparte dólares).
- **Ficha por ticker**: `/?symbol=GGAL.BA` funciona; el precio vivo sale de Yahoo en pesos (Alpaca no cubre BYMA) y la sección Radar muestra la fuerza relativa contra el Merval y el enlace al ADR.

```
GET  /radar/argentina    # macro del día + serie de 60 días + acciones + cedears
POST /radar/argentina    # refresco
```

## Operación diaria: qué corre solo y qué hacés vos

Mientras la API esté prendida, todo corre solo (hora local):

| Cuándo | Paso | Dónde se ve |
|---|---|---|
| lun–vie 07:30 | Tesis por eventos (`DAILY_CRON`) | Propuestas, Abiertas, Historial |
| lun–vie 07:45 | Veredictos de Cartera + medición (`CARTERA_CRON`) | Cartera |
| lun–vie 07:50 | Refresco y medición del Radar + Argentina (`RADAR_REFRESH_CRON`) | Radar |
| domingo 20:00 | Barrido del universo + ranking (`RADAR_SCAN_CRON`) | Radar |
| día 1, 08:00 | Plan del aporte (`RADAR_PLAN_CRON`) | Radar, plan del aporte |

**Ponerme al día.** Si la máquina estaba apagada o dormida a esa hora, no hace falta acordarse de nada: la API chequea un minuto después de arrancar y cada 30 minutos qué pasos quedaron sin correr (según `job_runs`, la última fecha cubierta por cada paso, con lo que ya hay en la base como respaldo) y corre solo esos, en orden: barrido y ranking (en segundo plano), Cartera, Radar, Argentina, plan, tesis. Lo ya hecho no se repite. El botón **Ponerme al día** del encabezado hace lo mismo a mano y muestra qué está pendiente; `CATCHUP_AUTO=0` apaga el chequeo automático. Rutas: `GET /catchup` (estado) y `POST /catchup` (correr).

**Siempre prendido (macOS).** Para que la API y el web arranquen al iniciar sesión y se relancen si se caen:

```bash
scripts/launchd/install.sh      # agentes com.thesis-engine.api y .web; logs en ~/Library/Logs/thesis-engine
scripts/launchd/uninstall.sh
```

Docker Desktop queda configurado para arrancar al iniciar sesión y la base tiene `restart: unless-stopped`, así que después de un reinicio todo vuelve solo. Bajo launchd la API corre sin watch (un cambio de código no la reinicia a mitad de una corrida): después de cambiar código, `launchctl kickstart -k gui/$(id -u)/com.thesis-engine.api`. Para desarrollar con recarga automática, desinstalá los agentes y usá `pnpm dev:api`. Si querés que la Mac se despierte sola a la hora de los crons (opcional, pide sudo): `sudo pmset repeat wakeorpoweron MTWRF 07:25:00`. Sin eso, cuando la abras se pone al día en el primer chequeo.

**Tu rutina.** Cada mañana: Cartera (¿VENDER o REVISAR?), Radar (¿cambió lo que más recomienda?), Argentina (¿CCL, riesgo país?). El día 1: seguir el plan del aporte, comprar a mano en el broker y cargar las operaciones. Los lunes: mirar los candidatos nuevos del ranking del domingo. Los botones del Radar (Barrer universo, Rankear, Refrescar, Refrescar Argentina, Regenerar plan) fuerzan un paso a mano; con "Ponerme al día" casi nunca hacen falta.

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
