# Radar — etapa 2 (diseño)

Fecha: 2026-09-07. Estado: aprobado por el dueño en conversación; implementación en curso.

Extiende la etapa 1 (`2026-09-07-cartera-etapa1-design.md`) con **candidatos nuevos para comprar**: el sistema arma el universo de acciones US solo, las rankea contra sus pares por fundamentals, filtra con reglas técnicas, agrega ETFs curados, arma el plan del aporte mensual y mide todo contra SPY. Además incorpora una **taxonomía** (clase de activo, sector/industria, temas) para filtrar, agrupar y medir concentración.

## 1. Objetivo y principios

Cada semana el Radar produce hasta 40 acciones candidatas con veredicto **COMPRAR** u **OBSERVAR**, zona de entrada, stop, objetivo, tamaño sugerido, riesgo 1–10 y una ficha corta; más el estado de una lista curada de ETFs; más el **plan del aporte del mes** (USD 6.500) repartido entre núcleo, SUMAR de Cartera y COMPRAR del Radar. De lunes a viernes se refrescan precios y veredictos de los candidatos vigentes.

Principios (los de DESIGN.md y de la evidencia de trading v1):

1. **Fundamental rankea, técnico filtra.** Evidencia v1 (n≈2.900): el eje fundamental discrimina alpha contra SPY; el técnico como ranking cambia de signo por mes. Los pesos del score viven en config y solo cambian con evidencia de la medición (§8).
2. **Contra pares, no contra el mercado.** Cada acción se compara con su industria/pares. El P/E de un fabricante de chips no se compara con el de una empresa de software.
3. **Fail-closed.** Sin capitalización, sin volumen, sin métricas o sin velas: no pasa. Nunca "neutral".
4. **El modelo escribe y solo degrada.** COMPRAR → OBSERVAR con motivo citado; nunca sube ni inventa datos.
5. **Todo se mide contra SPY.** COMPRAR y OBSERVAR se miden por igual: OBSERVAR es el grupo de control de los filtros.
6. **Cero humo.** Quality bar duro (capitalización, precio, liquidez) antes de cualquier ranking. Caso SDOT de v1: micro-cap recomendada por narrativa, −72% en dos semanas.

## 2. Alcance

**Entra:** universo semanal automático (Alpaca + Finnhub); taxonomía por ticker; ranking fundamental contra pares; filtros técnicos; candidatos con entrada/stop/objetivo/tamaño/riesgo; ETFs curados con motor propio; plan del aporte mensual; ficha por candidato (modelo); refresco diario; medición a 7/30/90 días; pestaña *Radar*; edición de etiquetas en la UI; concentración por sector y tema en el panel de riesgo de Cartera.

**No entra:** Argentina/BYMA/CEDEARs (etapa 3), opciones, ejecución automática, DCF, análisis técnico completo (patrones, Fibonacci).

## 3. Fuentes (todas gratis, verificadas el 2026-09-07)

| Dato | Fuente | Notas |
|---|---|---|
| Lista de acciones US | Alpaca `GET /v2/assets?status=active&asset_class=us_equity` | 12.571 tradables en NYSE/NASDAQ/ARCA/AMEX/BATS con símbolo simple |
| Precio y volumen masivo | Alpaca `GET /v2/stocks/snapshots?symbols=…&feed=iex` | 100 símbolos por llamada, ~1 s; volumen IEX subestima el consolidado (solo pre-filtro) |
| Perfil (nombre, país, industria, acciones en circulación, moneda) | Finnhub `profile2` | 60 llamadas/min |
| Métricas fundamentales | Finnhub `stock/metric?metric=all` | 132 campos; **ADRs vienen en moneda local** (TSM en TWD): los ratios son neutrales, los montos no |
| Pares | Finnhub `stock/peers` | hasta ~10; pueden incluir listados extranjeros (se filtran al universo) |
| Consenso de analistas | Finnhub `stock/recommendation` | último período |
| Resultados vs estimaciones | Finnhub `stock/earnings` | últimos trimestres |
| Insiders | Finnhub `stock/insider-transactions` | código `P` = compra en mercado abierto |
| Próximos resultados | Finnhub `calendar/earnings?symbol=` | fecha |
| Velas diarias | Yahoo chart (respaldo Alpaca), ya integrado | para SMA200, retorno 21 velas, chandelier, ATR |
| Filings | EDGAR, ya integrado | títulos recientes del candidato (ingesta bajo demanda) |

**Capitalización en USD**: siempre `shareOutstanding` (profile2, millones) × precio USD de Alpaca. Nunca `marketCapitalization` de Finnhub (moneda local en ADRs). **Volumen en USD**: `3MonthAverageTradingVolume` (millones de acciones) × precio USD.

## 4. Universo (job semanal, reanudable)

Cron domingo 20:00 (`RADAR_SCAN_CRON`). También desde la UI ("Barrer universo") o CLI.

1. **Lista**: Alpaca assets. Se excluyen: `tradable=false`; símbolos con `.` o `/`; nombres que contengan `Warrant`, `Unit`, `Right`, `Rights`, `Preferred`, `Depositary Preferred`; exchange fuera de NYSE/NASDAQ/ARCA/AMEX/BATS.
2. **Pre-filtro (Alpaca, 100 por llamada)**: precio ≥ USD 5 y volumen IEX del día × precio ≥ USD 500.000 (IEX ≈ 10% del consolidado; es un filtro grueso). Esperado: ~2.500.
3. **Fundamentals (Finnhub, ≤ 55 llamadas/min)**: por símbolo, `profile2` + `metric`. Se guardan `symbol_meta` y `fundamentals`. **Quality bar**: capitalización USD ≥ 500M y volumen USD ≥ 5M/día; sin `shareOutstanding` o sin `3MonthAverageTradingVolume` → excluido con motivo.
4. **Estado** por símbolo en `universe_scan` (`scan_date`, `symbol`, `stage` ∈ `alpaca_ok | finnhub_ok | excluded | error`, `reason`). El job procesa solo lo pendiente del barrido en curso: si se corta, retoma. Fundamentals con menos de 7 días no se vuelven a pedir.
5. **ETFs**: no salen del barrido; vienen de `config/etfs.json` (símbolo, nombre, rol `nucleo | satelite | cobertura`, exposición, TER, temas).

Progreso consultable (`GET /radar/scan-status`): pendientes, procesados, excluidos, errores, inicio, estimación.

## 5. Taxonomía (por ticker, editable)

Tres niveles en `symbol_meta`:

1. **Clase de activo** (`asset_class`, una): `accion_us` · `adr` · `accion_ar` · `cedear` · `etf` · `bono` · `commodity` · `cripto` · `efectivo`. Automática: `etf` si está en `config/etfs.json`; `adr` si el país del perfil no es US (o la posición está marcada `adr`); `accion_us` para el resto del barrido; `cripto`/`bono`/`commodity`/`efectivo` solo por carga manual o config. ETFs llevan además `exposure` (`rv_us | rv_internacional | emergentes | sector | commodity | bonos | cripto | argentina`) y `role`.
2. **Sector e industria**: `industry` = Finnhub `finnhubIndustry` (fino). `sector` (11, estilo GICS: Tecnología, Comunicación, Consumo discrecional, Consumo básico, Salud, Financiero, Industriales, Energía, Materiales, Servicios públicos, Inmobiliario, más `Otros`) por tabla `industria → sector` en `config/taxonomia.json`. Industrias no mapeadas → `Otros` y se registran en log para ampliar la tabla.
3. **Temas** (`themes[]`, varios, transversales): lista inicial en config: `IA, semiconductores, nube_software, ciberseguridad, defensa, petroleo_gas, renovables, nuclear_uranio, litio_baterias, oro_mineria, bitcoin, fintech, bancos, biotech, consumo, infraestructura, argentina, china_taiwan, dividendos, small_caps`. Asignación: reglas `industria → temas` y `símbolo → temas` en config; para candidatos nuevos el modelo **sugiere** temas de la lista (se guardan con `themes_source = "modelo"`); el dueño confirma o edita en la UI (`themes_source = "manual"`, no se pisa). Temas fuera de la lista se ignoran (el modelo no inventa categorías).

Uso: filtros en Radar y Cartera; chips en cada fila; concentración por sector y por tema en el panel de riesgo (una acción aporta todo su peso a cada uno de sus temas); la ficha nombra pares (industria) y temas por separado.

## 6. Ranking de acciones (semanal, tras el barrido)

**Grupo de comparación**: pares de Finnhub ∩ universo con fundamentals frescos (máx. 10). Si quedan < 4, el grupo es la industria (Finnhub) dentro del universo. Si aun así < 4, el símbolo se marca `sin_pares` y no rankea (fail-closed).

**Ejes**, cada uno = promedio de z-scores robustos dentro del grupo (`(x − mediana) / (1.4826 × MAD)`, winsorizado a ±3; métrica faltante → el eje se calcula con las que haya; si faltan todas → eje `null`):

| Eje | Métricas (Finnhub) | Sentido |
|---|---|---|
| Valuación (0.35) | `peTTM`, `evEbitdaTTM`, `psTTM` | más bajo = mejor (z invertido); P/E ≤ 0 se trata como faltante |
| Calidad (0.30) | `roeTTM`, `operatingMarginTTM`, `netProfitMarginTTM` | más alto = mejor |
| Crecimiento (0.25) | `revenueGrowthTTMYoy`, `revenueGrowth5Y`, `epsGrowthTTMYoy` | más alto = mejor |
| Balance (0.10) | `totalDebt/totalEquityAnnual` (invertido), `currentRatioAnnual` | |

`score = Σ peso × eje` sobre los ejes disponibles, reponderando si alguno es `null`; con ≤ 1 eje disponible no rankea. Pesos en `config/radar-policy.json`.

**Pre-selección**: top 150 por score → velas (Yahoo/Alpaca, 260 días) → **filtros técnicos**:
- cierre < SMA200 → **excluido** (`bajo_sma200`);
- retorno de 21 velas > +15% → **OBSERVAR** (`no_perseguir`);
- resultados en ≤ 10 días (Finnhub calendar) → **OBSERVAR** (`resultados_cerca`);
- sin 200 velas → excluido (`sin_historial`).

**Candidatos**: los 40 mejores que quedan. Para cada uno:
- `verdict`: COMPRAR salvo bandera que degrade.
- entrada: `[cierre, cierre × 1.02]`; stop chandelier 22/3; objetivo 2:1 (mismas funciones de etapa 1).
- **tamaño**: riesgo por operación = `riskPerTradePct` (1%) × valor de Cartera (último snapshot; sin snapshot, `fallbackPortfolioUsd`); `qty = floor(riesgo / (entradaAlta − stop))`; `sizeUsd = qty × entradaAlta`, tope `maxPositionPct` (10%) del valor de Cartera.
- **riesgo 1–10**: base 1 + beta (> 1.5: +2; > 1.2: +1) + ATR% (> 4%: +2; > 2.5%: +1) + deuda/patrimonio (> 1.5: +2; > 0.8: +1) + volumen USD (< 10M: +2; < 25M: +1) + capitalización (< 2B: +2; < 10B: +1); tope 10.
- **banderas** (`flags[]`): `insiders_compran` (≥ 1 compra código P en 90 días), `insiders_venden` (≥ 3 ventas S), `consenso_compra` (strongBuy+buy > 60%), `consenso_venta`, `sorpresa_positiva` (última sorpresa > +5%), `sorpresa_negativa`, `dividendo` (yield > 2%), `no_perseguir`, `resultados_cerca`, `residente_cronico`.
- **residente crónico**: `nth_appearance` = semanas consecutivas como candidato. Desde la 4ª → OBSERVAR (`residente_cronico`). Evidencia v1: 4ª+ aparición sin compra, alpha negativo.

Datos por candidato (solo los 40): insiders, consenso, sorpresas, próximos resultados, pares con sus métricas (para la ficha).

## 7. ETFs (semanal y diario)

Para cada ETF de `config/etfs.json`: velas 260 días; fuerza relativa vs SPY a 3/6/12 meses (`(1+r_etf)/(1+r_spy) − 1`); distancia a SMA200; ATR%.
- `nucleo`: verdict **NUCLEO** (siempre elegible para el aporte; sin timing).
- `satelite` / `cobertura`: **COMPRAR** si fuerza relativa 6m > 0 y retorno 21 velas ≤ +15% y cierre > SMA200; si no, **OBSERVAR** con motivo.
Se guardan en `radar_candidates` con `kind = "etf"`, stop/objetivo igual que acciones, sin score fundamental.

## 8. Plan del aporte (mensual)

`config/radar-policy.json`: `monthlyContributionUsd` (6500), `coreTargetPct` (40), `coreEtfs` (p. ej. `["VTI","VEA"]` con pesos), `maxPositionPct` (15), `maxNewPositionsPerMonth` (2), `riskPerTradePct` (1), `fallbackPortfolioUsd` (150000).

Algoritmo (`planContribution`, puro sobre: posiciones + pesos de Cartera, últimos veredictos de Cartera, candidatos vigentes del Radar, política):
1. Núcleo: `gap = coreTargetPct × (valor + aporte) − valorNucleoActual`; si `gap > 0`, va `min(gap, aporte)` al núcleo, repartido entre `coreEtfs` por sus pesos objetivo (el más lejos primero).
2. Resto: candidatos en orden: SUMAR de Cartera (por menor peso primero), luego COMPRAR del Radar (acciones y ETFs satélite, por score). Cada línea recibe `min(sizeUsd sugerido, tope por posición, lo que queda)`; máximo `maxNewPositionsPerMonth` símbolos nuevos. Sobrante → núcleo.
3. Cada línea: `{ symbol, kind: nucleo | sumar | comprar, amountUsd, rationale }`. Se guarda en `contribution_plans` (`plan_month`, líneas, total, cierre y SPY por línea) y se mide a 30/90 días.

Se regenera al pedirlo desde la UI o el 1.º de cada mes a las 08:00 (`RADAR_PLAN_CRON`).

## 9. Ficha (modelo, solo degrada)

Tool `candidate_card` (function call estricto): `summary` (qué hace la empresa, ≤ 2 oraciones), `whyRanks` (≤ 2 oraciones citando números y lugar entre pares), `mainRisk` (1 oración), `moat` ∈ `debil | moderado | fuerte | desconocido`, `themes` (subconjunto de la lista de temas), `degrade` (bool), `degradeReason?`.

Entrada: perfil, métricas propias y del grupo (mediana), rank por eje, banderas, insiders, consenso, sorpresas, títulos de filings recientes (EDGAR bajo demanda: últimos 8 del ticker), temas actuales. Reglas del prompt: citar solo lo recibido; "si no tenés el dato, decilo"; degradar solo por deterioro concreto citado (guidance, litigio, dilución, default). El código aplica `degrade` solo COMPRAR → OBSERVAR (`degraded_by = "narrator"`). Fallo del modelo → candidato sin ficha, error registrado.

Se genera en el ranking semanal para los 40; el refresco diario no vuelve a llamar al modelo salvo que un candidato sea nuevo.

## 10. Refresco diario y medición

- `refreshRadar` (lun–vie 07:50, `RADAR_REFRESH_CRON`): para los candidatos vigentes (última fecha), velas nuevas → recalcula cierre, stop, objetivo, entrada, filtros técnicos y verdict; conserva score, ejes, banderas fundamentales, ficha y `nth_appearance`; guarda con la fecha de hoy.
- `measureRadar`: para `radar_candidates` y líneas de `contribution_plans` con fecha ≤ hoy − h (h ∈ 7, 30, 90) y sin medir: alpha vs SPY como en etapa 1. Acierto: COMPRAR/NUCLEO/sumar/comprar si alpha > 0; OBSERVAR se mide igual (control), sin "acierto".
- Resumen (`GET /radar/measurement`): por verdict y horizonte, n, alpha medio, tasa de acierto; y la comparación **COMPRAR vs OBSERVAR** (diferencia de alpha medio): si no es positiva con n razonable, los filtros no agregan valor.

## 11. Datos

Tablas nuevas (Drizzle):
- `symbol_meta` (extender): `asset_class`, `sector`, `exposure`, `role`, `themes text[]`, `themes_source`, `currency`, `share_outstanding`.
- `fundamentals`: `symbol` pk, `as_of` date, `metrics` jsonb (subconjunto: las 12 del ranking + beta, dividendYield, 52w, retornos 26/52 semanas, volumen 3m), `peers text[]`, `mcap_usd`, `dollar_volume_usd`, `price_usd`, `next_earnings` date null, `insider_buys_90d` int null, `insider_sells_90d` int null, `analyst` jsonb null, `earnings_surprises` jsonb null, `updated_at`.
- `universe_scan`: (`scan_date`, `symbol`) pk, `stage`, `reason`, `updated_at`.
- `radar_candidates`: (`candidate_date`, `symbol`) pk, `kind` (`stock|etf`), `verdict` (`COMPRAR|OBSERVAR|NUCLEO`), `score`, `axes` jsonb, `peer_group text[]`, `rank_in_group` int, `close`, `entry_low`, `entry_high`, `stop`, `target`, `size_usd`, `size_qty`, `risk_score` int, `flags text[]`, `nth_appearance` int, `summary`, `why_ranks`, `main_risk`, `moat`, `degraded_by`, `prompt_version`, `spy_close`, medición 7/30/90 (`close_Xd`, `spy_Xd`, `alpha_Xd_pct`), `measured_at`.
- `contribution_plans`: `plan_month` pk, `created_at`, `total_usd`, `lines` jsonb (con `close` y `spyClose` por línea), medición por línea dentro del jsonb (`alpha30dPct`, `alpha90dPct`).

Config: `config/etfs.json`, `config/radar-policy.json`, `config/taxonomia.json`.

## 12. API y UI

Rutas `/radar/*`: `GET candidates` (últimos, con filtros `kind`, `verdict`, `sector`, `theme`, `assetClass`), `GET candidates/:symbol` (ficha completa: métricas propias y del grupo, pares, insiders, consenso, sorpresas), `GET etfs`, `POST scan` (arranca el barrido en segundo plano; 409 si ya corre), `GET scan-status`, `POST rank`, `POST refresh`, `GET plan`, `POST plan` (regenera), `GET measurement`. Taxonomía: `GET /taxonomy/options`, `GET /taxonomy/:symbol`, `PUT /taxonomy/:symbol` (`assetClass`, `sector`, `themes`; marca `themes_source = "manual"`).

Pestaña **Radar** (segunda del menú, después de Cartera): (1) *Plan del aporte del mes* con líneas y montos; (2) filtros por clase, sector, tema y verdict; (3) tabla de candidatos: verdict, score, rank en grupo, precio, entrada, stop, objetivo, tamaño, riesgo, banderas, chips de temas; "Ver" abre la ficha (narrativa, ejes con z-scores, tabla de pares con P/E, crecimiento y márgenes, insiders, consenso, resultados); (4) tabla de ETFs; (5) medición COMPRAR vs OBSERVAR; (6) botones *Refrescar*, *Barrer universo* (progreso en vivo), *Regenerar plan*. En Cartera: chips de temas por fila y concentración por sector y tema en el panel de riesgo; edición de etiquetas desde la fila.

## 13. Tests

- Core puro: filtros de universo (nombres, símbolos, umbrales), z-score robusto y ejes (con y sin métricas faltantes, reponderación), grupo de pares (fallback a industria, `sin_pares`), filtros técnicos y verdict, tamaño y tope, riesgo 1–10, banderas, residente crónico, motor ETF, plan del aporte (núcleo primero, topes, máximo de nuevas, sobrante), taxonomía (clase, sector por tabla, temas por reglas, edición manual no se pisa), medición y comparación COMPRAR vs OBSERVAR, concentración por tema.
- Adapters con fixtures: assets, snapshots por lote, metric, peers, recommendation, earnings, insiders, calendar; limitador de 55/min (con reloj falso).
- Pipeline con `MemoryStore`: barrido reanudable (corta a la mitad y retoma sin repetir), ranking de punta a punta con datos sintéticos, refresco conserva score y ficha, medición, plan.
- DB: integración de las tablas nuevas con limpieza. API: rutas con `MemoryStore`. Narrador: request y `parseCard` (temas fuera de la lista se descartan).

## 14. Riesgos conocidos

- Finnhub free: 60/min; el barrido completo tarda ~1 h y puede fallar a mitad: por eso es reanudable y no bloquea la API.
- Pares de Finnhub pueden ser listados extranjeros: se filtran al universo; si quedan pocos, industria.
- Métricas de ADRs en moneda local: los ratios sirven; capitalización y volumen se calculan en USD desde acciones en circulación y precio de Alpaca.
- Yahoo no oficial: respaldo Alpaca (ya existe).
- La medición a 90 días tarda tres meses en decir algo; COMPRAR vs OBSERVAR a 30 días es la primera señal.
