# Radar — verificación de candidatos (diseño)

Fecha: 2026-09-09. Estado: aprobado por el dueño en conversación; implementación pendiente.

Extiende la etapa 2 (`2026-09-07-radar-etapa2-design.md`). Motivación: el 2026-09-09 el Radar rankeó a ZVRA 1° por convicción entre 31 COMPRAR y la puso en el plan del mes. Una verificación a mano contra los resultados publicados, las noticias y los analistas mostró tres fallas del motor que el dueño no tiene por qué detectar:

1. **One-offs en los fundamentals.** Los ejes calidad y valuación usan ratios TTM de Finnhub (`peTTM`, `roeTTM`, `netProfitMarginTTM`, `operatingMarginTTM`) que incluyen resultados extraordinarios. El 45% de la ganancia TTM de ZVRA es una venta de cartera (USD 43,3M, Q1 2026); el P/E "12,8x" limpio es ~24x y el margen operativo "60%" real es 29%. El motor no tiene ninguna fuente de estados trimestrales para saberlo.
2. **Ceguera a eventos.** La ficha del modelo recibe solo títulos de filings de EDGAR ("8-K 2.02,9.01"). El rechazo de la EMA a MIPLYFFA (2026-07-23, −24% en un día, reexaminación pendiente para el Q4) nunca fue un 8-K: solo existe en noticias, que el Radar no lee.
3. **Vela parcial como cierre.** El refresco corrió a las 09:44 de Nueva York por "ponerme al día", Yahoo devolvió la vela en curso del día y el pipeline la tomó como cierre (12,57 contra el cierre real anterior 12,675). No hay reloj de mercado.

Además, la app no tiene objetivos de analistas con fecha (Finnhub solo da conteos), y los titulares del tipo "mantiene Compra, baja objetivo a 24" están disponibles gratis en las noticias.

## 1. Objetivo y principios

Que el motor haga solo lo que un analista verificaría a mano antes de recomendar: leer los estados primarios y separar lo extraordinario, leer las noticias de los últimos 90 días y clasificar lo material, no tomar una sesión abierta como cerrada, y mostrar qué dijeron los analistas y cuándo.

Principios (además de los de la etapa 2):

1. **Fuente primaria antes que agregador.** Los estados salen de la SEC (XBRL), no de un ratio precalculado. Finnhub queda como respaldo y se muestra al lado.
2. **Reglas deciden, el modelo clasifica y explica.** La fórmula de ganancia núcleo es fija y testeable. El modelo solo clasifica titulares que ya pasaron un prefiltro por reglas, citando el titular; la regla de severidad → veredicto vive en código.
3. **Fail-closed también con noticias.** Un titular que pasa el prefiltro y no pudo clasificarse deja una salvedad visible hasta que se clasifique.
4. **Todo evento que cambia un veredicto queda explicado en la app** (bandera, salvedad, ficha, Novedades), nunca solo en el chat.

## 2. Alcance

**Entra:** ganancia núcleo desde XBRL de la SEC para emisores US (10-Q/10-K) con recálculo de P/E, ROE y márgenes; eventos materiales desde noticias con clasificación por modelo y reglas de veredicto; objetivos y calificaciones de analistas extraídos de titulares; velas solo de sesiones cerradas (US y BYMA); secciones nuevas en la ficha; tests con fixtures reales de ZVRA.

**No entra:** emisores IFRS (20-F, ADRs) para la ganancia núcleo (siguen con Finnhub y bandera `sin_estados`); búsqueda web general; APIs pagas de analistas; eventos positivos (el Radar es un filtro de valor); cambiar pesos o umbrales del score.

## 3. Fuentes (gratis, verificadas el 2026-09-09)

| Qué | Fuente | Límite / nota |
|---|---|---|
| Estados trimestrales | SEC `https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json` | 10 req/s con `SEC_USER_AGENT` (ya configurado). Un JSON por empresa (0,5–3 MB). CIK vía `company_tickers.json` (ya usado por EDGAR) |
| Noticias | Finnhub `company-news?symbol=&from=&to=` | 60/min compartido. Verificado: trae el rechazo de la EMA (24/7) y tres bajas de objetivo (27/7) con titulares claros |
| Clasificación de titulares | Gemini Flash free (transporte existente `GeminiToolCaller`) | ~40 llamadas semanales + pocas diarias; solo titulares que pasan el prefiltro |
| Reloj de sesión | Cálculo local con `Intl.DateTimeFormat` en `America/New_York` y `America/Argentina/Buenos_Aires` | sin red |

## 4. Ganancia núcleo (estados de la SEC)

**Adapter** `SecStatements` (`packages/adapters/src/edgar/statements.ts`): `quarters(symbol) → QuarterlyStatements | null`. Resuelve el CIK, baja `companyfacts` y arma los **últimos 8 trimestres** con estos tags (prioridad de izquierda a derecha; falta → `null`):

- ingresos: `Revenues`, `RevenueFromContractWithCustomerExcludingAssessedTax`, `RevenueFromContractWithCustomerIncludingAssessedTax`, `SalesRevenueNet`
- resultado operativo: `OperatingIncomeLoss`
- resultado neto: `NetIncomeLoss`, `ProfitLoss`
- resultado antes de impuestos: `IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest`, `IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments`
- impuestos: `IncomeTaxExpenseBenefit`
- flujo operativo: `NetCashProvidedByUsedInOperatingActivities`; capex: `PaymentsToAcquirePropertyPlantAndEquipment`
- acciones diluidas: `WeightedAverageNumberOfDilutedSharesOutstanding`; patrimonio (instantáneo): `StockholdersEquity`, `StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest`
- **extraordinarios** (lista fija `EXTRAORDINARY_TAGS` en código, con signo): ganancias que inflan (`GainLossOnDispositionOfAssets`, `GainLossOnDispositionOfAssets1`, `GainLossOnSaleOfBusiness`, `GainLossOnDispositionOfIntangibleAssets`, `GainLossOnSaleOfPropertyPlantEquipment`, `GainsLossesOnExtinguishmentOfDebt`, `DeconsolidationGainOrLossAmount`, `BusinessCombinationBargainPurchaseGainRecognizedAmount`) y cargos que deprimen (`AssetImpairmentCharges`, `ImpairmentOfLongLivedAssetsHeldForUse`, `ImpairmentOfIntangibleAssetsExcludingGoodwill`, `ImpairmentOfIntangibleAssetsFinitelived`, `GoodwillImpairmentLoss`, `RestructuringCharges`, `LitigationSettlementExpense`, `InventoryWriteDown`).

**Armado de trimestres** (puro, `packages/core/src/radar/statements.ts`): los hechos de duración se agrupan por (`start`, `end`); un trimestre es una duración de 80–100 días; el Q4 se deriva como anual (350–380 días) menos los nueve meses acumulados (260–290 días); si falta un trimestre pero hay acumulados, se deriva por diferencia (Q2 = 6M − Q1, Q3 = 9M − 6M). Los flujos de caja vienen solo acumulados: siempre por diferencia. Ante duplicados por reexpresión gana el `filed` más reciente. Los instantáneos (patrimonio) se toman por `end`. Un trimestre sin resultado operativo ni neto no cuenta.

**Ganancia núcleo** (puro, `coreEarnings(quarters)`), sobre los últimos 4 trimestres (TTM):

```
extraordinariosTTM   = Σ ganancias extraordinarias − Σ cargos extraordinarios
operativoNucleoTTM   = operativoTTM − extraordinariosTTM
tasa                 = impuestosTTM / antesDeImpuestosTTM, acotada a [0, 0.35]; si antesDeImpuestos ≤ 0 o falta: 0.21
netoNucleoTTM        = operativoNucleoTTM × (1 − tasa)
epsNucleoTTM         = netoNucleoTTM / accionesDiluidas(último trimestre)
desvioPct            = (netoTTM − netoNucleoTTM) / max(|netoTTM|, |netoNucleoTTM|, 1)
```

La fórmula ignora el resultado no operativo a propósito: ahí caen las ganancias por venta de vouchers, revaluaciones de warrants y similares (ZVRA Q2 2025: USD 147,9M no operativos). El costo es subestimar levemente a empresas con mucho interés cobrado; se acepta.

**Ajustes de implementación (2026-09-09)**

- `buildQuarters` deduplica ítems extraordinarios con el mismo valor exacto dentro del trimestre (el mismo hecho etiquetado bajo dos tags, caso ZVRA Q1 2026: `GainLossOnDispositionOfAssets1` y `GainLossOnDispositionOfIntangibleAssets`).
- `QuarterStatement.nonoperatingIncome` (tags `NonoperatingIncomeExpense`, `OtherNonoperatingIncomeExpense`): una ganancia extraordinaria se resta del operativo solo si es positiva y no está explicada por el resultado no operativo del trimestre (≥ 80% de la ganancia → vive fuera del operativo, caso del voucher de ZVRA Q2 2025).
- Los cargos e impairments NO se suman de vuelta (quedan informativos en `extraordinaryItems`): en XBRL muchos viven en notas y no en el estado de resultados (ZVRA Q1 2026 "impairment" 43,3M ausente del P&L), así que sumarlos inflaría el núcleo; dirección conservadora.
- La bandera y el recálculo solo aplican cuando hay ganancias extraordinarias operativas identificadas (`extraordinaryTTM ≠ 0`); sin ellas quedan los ratios de Finnhub, para no sesgar a favor de empresas apalancadas (el núcleo ignora intereses).
- Con operativo núcleo ≤ 0 no hay escudo fiscal: neto núcleo = operativo núcleo.

**Salida** `CoreEarnings`: `revenueTTM`, `operatingIncomeTTM`, `coreOperatingIncomeTTM`, `netIncomeTTM`, `coreNetIncomeTTM`, `coreEpsTTM`, `operatingCashFlowTTM`, `freeCashFlowTTM`, `equity`, `taxRate`, `extraordinaryItems[]` (`{tag, quarterEnd, value}`), `deviationPct`, `quarters[]` (los 8, para la ficha).

**Bandera** `resultado_extraordinario` cuando `|desvioPct| > 0.25`. Texto en la ficha y en salvedades: "ganancia TTM inflada 45% por extraordinarios (venta de activos 43,3M, Q1 2026): P/E núcleo 24x" o "deprimida" si el signo es negativo. Aparece como salvedad sin penalización de convicción: el ranking ya usa las cifras núcleo.

**Recalculo de métricas** (puro, `applyCoreMetrics(f, core, priceUsd)`): con estados disponibles, en `metrics` se reemplazan `peTTM = precio / epsNucleoTTM` (null si eps ≤ 0), `netProfitMarginTTM = netoNucleo / ingresos × 100`, `operatingMarginTTM = operativoNucleo / ingresos × 100`, `roeTTM = netoNucleo / patrimonio × 100`. Los valores de Finnhub se conservan en `metricsRaw`. Sin resultado operativo (bancos, aseguradoras) o sin estados (IFRS, sin CIK): no se reemplaza nada y se agrega la bandera `sin_estados` (informativa; sin penalización).

**Cuándo se piden**: el universo con fundamentals tiene ~2.700 símbolos (barrido del 2026-09-09); pedir `companyfacts` para todos serían ~3 GB por semana. Por eso en `rankRadar` se piden en dos pasadas. Pasada 1: ranking con Finnhub → pre-selección (150). Pasada 2: estados para la pre-selección ∪ los miembros de sus grupos de pares (deduplicado, concurrencia 4, caché de 7 días en tabla `statements`) → recalcular métricas → ranking definitivo → filtros técnicos → candidatos. Un símbolo fuera de la pre-selección inicial puede entrar al ranking definitivo solo por el cambio de medianas de su grupo; queda con Finnhub y `sin_estados`. Documentado, aceptado.

## 5. Eventos materiales (noticias)

**Cadencia.** En `rankRadar`, para los 40 candidatos: noticias de los últimos 90 días. En `refreshRadar` (diario), para todos los candidatos vigentes: noticias desde `scanned_to` (tabla `radar_news_scans`) hasta hoy. Los ítems se guardan en la tabla `news` existente (único por símbolo + URL).

**Prefiltro** (puro, `materialHeadlines(items)`): expresiones en inglés y español, por tipo:

| Tipo | Patrones (resumen; la lista completa vive en código y en su test) |
|---|---|
| `regulatorio` | negative opinion, CHMP, complete response letter, CRL, refuse(s) to file, reject(s), declines to approve, clinical hold, withdraws (application/NDA/BLA/MAA), FDA rejects |
| `continuidad` | going concern, bankruptcy, chapter 11, default |
| `contable` | restate(ment), material weakness, SEC investigation/subpoena, accounting probe |
| `listado` | delist, non-compliance notice, Nasdaq notice |
| `guidance` | cuts/lowers guidance or outlook, withdraws guidance |
| `dilucion` | public offering, registered direct, at-the-market, convertible notes, private placement, priced offering |
| `litigio` | class action, securities fraud, investigates claims on behalf, lawsuit |
| `gestion` | CEO resigns/steps down/departure, auditor resigns |
| `analista` | price target, maintains, reiterates, upgrades, downgrades, initiates (va a §6, no al modelo) |

**Clasificación** (modelo, tool estricta `material_events`, `packages/reasoner/src/events.ts`): entrada = símbolo, nombre, hasta 15 titulares que pasaron el prefiltro (fecha, fuente, titular, resumen). Salida = `events[]` con `date`, `kind` (los tipos de arriba más `otro`), `severity ∈ grave | moderado | ruido`, `headline` (debe ser idéntico a uno recibido; si no, se descarta), `why` (≤ 200 caracteres). Reglas del prompt: **grave** = la propia empresa recibió un rechazo regulatorio, CRL o clinical hold sobre un producto principal; duda de continuidad; reexpresión, fraude o investigación de la SEC a la empresa; aviso de delisting. **Moderado** = recorte de guidance, oferta dilutiva, demanda colectiva presentada o investigaciones de estudios tras una caída, salida del CEO. **Ruido** = resúmenes de mercado, notas promocionales, menciones de terceros. Solo con lo recibido; nunca inferir. Sin titulares que pasen el prefiltro no hay llamada. Fallo del modelo (cuota, parseo): los titulares quedan pendientes y el candidato lleva la bandera `eventos_sin_clasificar` (salvedad, −0,3 de convicción) hasta el próximo intento diario.
- Tope de 15 titulares por llamada: el excedente deja `eventos_sin_clasificar` y no avanza el barrido; el refresco siguiente clasifica el resto (los conocidos se excluyen por URL).

**Persistencia.** Tabla `radar_events`: `symbol`, `date`, `kind`, `severity`, `headline`, `url`, `source`, `why`, `detected_at`, `prompt_version`; único (`symbol`, `url`). Los `ruido` también se guardan (para no reclasificar).

**Reglas de veredicto** (en `decideCandidate`, que recibe `events` de los últimos 90 días contados desde `today`):

- algún `grave` → **OBSERVAR** con motivo `evento_grave` (bandera). Vence solo a los 90 días del evento; no hay override manual.
- algún `moderado` (y ningún grave) → bandera `evento_moderado`; sigue COMPRAR.
- `refreshRadar` reevalúa con los eventos nuevos: un COMPRAR puede pasar a OBSERVAR por evento en el refresco diario (igual que hoy por `bajo_stop`), y Novedades lo registra como cambio de veredicto.

**Convicción**: `evento_moderado` −0,3 y `eventos_sin_clasificar` −0,3, con salvedad que cita tipo, fecha y titular ("evento moderado 27/7: Levi & Korsinsky notifica una investigación a inversores"). Para eso `CandidateRow` lleva `events` (jsonb: `date`, `kind`, `severity`, `headline`), acotado a los de 90 días.

**Ficha del modelo**: `CardInput.events` (los mismos 90 días, grave y moderado) en una sección "# Eventos materiales (90 días)"; el prompt exige que `mainRisk` mencione el grave si lo hay.

## 6. Analistas desde titulares

Puro, sin modelo: `parseAnalystAction(headline, date, url)` reconoce dos formatos y devuelve `{firm, action, rating, target}` o `null`:

- Benzinga: `<Firma> (Maintains|Reiterates|Upgrades|Downgrades|Initiates Coverage On) <Calificación> on <Empresa>, (Lowers|Raises|Maintains|Announces) Price Target to $N` (y la variante `Initiates Coverage On <Empresa> with <Calificación> Rating, Announces $N Price Target`).
- TheFly: `<Empresa> price target (lowered|raised) to $N from $M at <Firma>`.

Formatos no reconocidos se ignoran (sin error). Tabla `analyst_actions`: `symbol`, `date`, `firm`, `action`, `rating`, `target`, `url`; único (`symbol`, `url`). Se alimenta en los mismos barridos de §5. Resumen de 90 días en `CandidateRow.analystTargets` (`n`, `median`, `min`, `max`, `latestDate`) y en la ficha: "objetivo mediano 24 (+98%), 3 acciones en 90 días, última 27/7". Informativo: no toca score ni convicción.

## 7. Velas de sesiones cerradas

Puro, `packages/core/src/pricing/sessions.ts`: `completedCandles(candles, now: Date, market: "us" | "ar")` descarta la última vela si su fecha es la fecha local del mercado en `now` y la hora local es anterior al cierre más 10 minutos (US: `America/New_York`, 16:10; AR: `America/Argentina/Buenos_Aires`, 17:10). Fines de semana y feriados no requieren regla: no hay vela con la fecha de hoy.

Se aplica en un decorador del adapter, `CompletedSessionsHistory(inner, now)` en `packages/adapters/src/history.ts`, envuelto en `container.ts` alrededor de `FallbackPriceHistory`; el mercado se infiere del sufijo `.BA`. Así lo reciben todos los consumidores sin tocarlos: Radar, seguimiento, stops de Cartera, Argentina, velas guardadas de la ficha. El precio en vivo de la ficha no pasa por acá (es intradía a propósito).

Efecto: un refresco a las 09:44 de Nueva York usa el cierre del día anterior; `candidateDate` sigue siendo la fecha de la corrida.

## 8. Datos

- `statements`: `symbol` pk, `cik`, `as_of`, `quarters` jsonb, `core` jsonb, `updated_at`. Frescura 7 días.
- `fundamentals`: + `metrics_raw` jsonb (Finnhub original), + `statements_as_of` date (null = sin estados).
- `radar_events`, `analyst_actions`, `radar_news_scans` (`symbol` pk, `scanned_to` date): según §5 y §6.
- `radar_candidates`: + `events` jsonb (default `[]`), + `analyst_targets` jsonb.
- Migración drizzle (`pnpm db:generate` + `db:migrate`).

## 9. API y UI

- `GET /radar/candidates/:symbol` y `GET /ticker/:symbol` devuelven además `statements` (8 trimestres, núcleo, `deviationPct`, ítems extraordinarios), `events` (90 días) y `analystActions` (90 días, con resumen).
- Ficha (Radar y página por ticker), tres secciones nuevas: **Estados (SEC)**: tabla de los últimos 4 trimestres con ingresos, operativo, neto, flujo operativo; debajo, reportado contra núcleo (P/E, ROE, márgenes) y el detalle de extraordinarios. **Eventos materiales**: lista con fecha, severidad (chip rojo grave / ámbar moderado), tipo, titular con enlace y el "por qué" del modelo. **Analistas (90 días)**: lista de acciones con fecha, firma, calificación y objetivo, y el resumen.
- Banderas nuevas en tabla y ficha con su etiqueta: `resultado_extraordinario`, `sin_estados`, `evento_grave`, `evento_moderado`, `eventos_sin_clasificar`.
- Convicción y plan: las salvedades nuevas ya fluyen por `cautions`; el plan no lista OBSERVAR y Novedades registra el cambio de veredicto.
- Ruta existente `POST /radar/rank` (o `pnpm radar:rank`): se corre una vez tras desplegar para corregir las filas vigentes.

## 10. Tests

Fixtures reales guardados en el repo: `companyfacts` de ZVRA recortado a los tags usados (2025–2026) y las 16 noticias de Finnhub del 15 al 31 de julio de 2026.

- Core puro: armado de trimestres (Q4 derivado, flujos por diferencia, reexpresión gana el último `filed`, trimestre faltante derivado de acumulados); `coreEarnings` con ZVRA (desvío ≈ +0,45, P/E núcleo ≈ 24x, margen operativo TTM ≈ 29%); tasa acotada y 21% por defecto; `applyCoreMetrics` sin operativo → `sin_estados`; prefiltro por tipo (positivos y negativos en inglés y español); `parseAnalystAction` con los dos formatos y titulares que no matchean; `completedCandles` antes y después del cierre, en fin de semana y para `.BA`; `decideCandidate` con grave (OBSERVAR), moderado (bandera), evento de 91 días (no cuenta), sin eventos; convicción con las salvedades nuevas y su texto.
- Reasoner: `parseMaterialEvents` descarta titulares no recibidos y severidades inválidas.
- Pipeline con `MemoryStore`: rank de punta a punta con ZVRA sintético + fixtures → fila OBSERVAR con `evento_grave` citando el titular del 24/7, `events` y `analystTargets` poblados, `metricsRaw` conservado; refresco con noticia nueva grave → COMPRAR pasa a OBSERVAR; fallo del clasificador → `eventos_sin_clasificar`; `radar_news_scans` avanza.
- Adapter: parser de `companyfacts` contra el fixture; decorador de sesiones con reloj inyectado.
- Regresión de `plan.test.ts`: sigue exigiendo que cada COMPRAR no incluido esté explicado.

## 11. Riesgos conocidos

- Tags XBRL heterogéneos: bancos y aseguradoras no reportan `OperatingIncomeLoss` → `sin_estados`, sin recálculo (mejor que un número falso). Emisores IFRS fuera de alcance.
- Cargos extraordinarios con tags propios de la empresa (`zvra_…`) no se detectan; el desvío por ganancias no operativas sí, porque la fórmula parte del operativo.
- Finnhub puede no cubrir alguna noticia de small caps; el prefiltro depende de titulares en inglés o español.
- Regex de analistas: solo Benzinga y TheFly; otros formatos se ignoran en silencio (informativo, no decide).
- Cuota de Gemini: el prefiltro limita las llamadas; si aun así falla, la bandera `eventos_sin_clasificar` mantiene la salvedad visible.
- `companyfacts` pesa hasta 3 MB por empresa: por eso se limita a pre-selección más pares, con caché de 7 días.

## 12. Criterio de aceptación (ZVRA, con datos al 2026-09-09)

- Estados: P/E núcleo 23–25x, margen operativo TTM 28–30%, `resultado_extraordinario` con ≈ +43% y el ítem `GainLossOnDispositionOfAssets1` 43,3M del Q1 2026.
- Eventos: `evento_grave` fechado 2026-07-24 citando el titular del rechazo de la EMA; veredicto OBSERVAR hasta el 2026-10-22; la ficha lo muestra y `mainRisk` lo menciona.
- Analistas: tres acciones del 2026-07-27 (BTIG 24, Guggenheim 24, Canaccord Genuity 20), mediana 24.
- Velas: un refresco antes de las 16:10 de Nueva York usa el cierre del 2026-09-08 (12,675), igual que el plan.

## 13. Enmienda 2026-09-10: calidad de la ganancia (pieza 1 de la estandarización)

**Por qué.** El 2026-09-10 NUTX rankeó 1° de su grupo y COMPRAR con: EPS núcleo 41 cuando el atribuible era ~25 (los médicos socios de cada hospital se llevan 32% de la ganancia), ingresos del último trimestre −13,6% con operativo +261%, y una demanda colectiva ("moderado"). Cada dato solo era una advertencia; juntos son motivo para observar. Lo mismo con UNIT (ganancia única de 1.685M por Windstream bajo `OtherNonrecurringGain`, fuera de la lista), KRG (venta de propiedades) y las aseguradoras (liberación de reservas de años anteriores).

**Estados (§4), campos nuevos.** `QuarterStatement.noncontrolling` (`NetIncomeLossAttributableToNoncontrollingInterest`, por trimestre, directo o por diferencia de acumulados) y `QuarterStatement.receivables` (instantáneo: `AccountsReceivableNetCurrent`, `ReceivablesNetCurrent`, `AccountsReceivableNet`, `ContractWithCustomerReceivableAfterAllowanceForCreditLossCurrent`, `PremiumsAndOtherReceivablesNet`, `PremiumsReceivableAtCarryingValue`; lo que no está queda null, caso NUTX).

**Fórmula (§4).** `netoNucleoTTM = operativoNucleoTTM × (1 − tasa) − max(0, minoritariosTTM)`. El neto reportado (`NetIncomeLoss`) ya viene sin la parte de los socios, así que ahora el desvío compara peras con peras. `CoreEarnings` suma `noncontrollingTTM`, `receivablesPctRevenue` (cuentas a cobrar del último trimestre sobre ingresos TTM) y `lastQuarterYoy` (último trimestre contra el que terminó 350–380 días antes, ingresos y operativo en %, null si la base no es positiva).

**Extraordinarios (§4), lista ampliada.** Ganancias: `OtherNonrecurringGain`, `GainLossOnSaleOfProperties`, `GainsLossesOnSalesOfInvestmentRealEstate`, `GainLossOnInvestments`, `UnrealizedGainLossOnInvestments`, `EquitySecuritiesFvNiGainLoss`. Categoría nueva `releases`: `SupplementalInformationForPropertyCasualtyInsuranceUnderwritersPriorYearClaimsAndClaimsAdjustmentExpense`, negativo cuando es favorable (HRTG Q2 2026 −23,4M; OSCR H1 2026 −194M): entra como ganancia con el signo dado vuelta. La deduplicación por valor exacto sigue (KRG tagea la misma venta bajo dos elementos).

**Banderas nuevas (reglas puras, `earningsQualityFlags`, umbrales en `QUALITY_THRESHOLDS`):**
- `interes_minoritario`: minoritariosTTM / (netoNucleoTTM + minoritariosTTM) ≥ 20%.
- `cobranza_lenta`: cuentas a cobrar ≥ 35% de los ingresos TTM (≈ 128 días).
- `ganancia_sin_ventas`: ingresos del último trimestre < 0% interanual y operativo ≥ +50% interanual.

**Veredicto.** Dos o más de {`resultado_extraordinario`, `interes_minoritario`, `cobranza_lenta`, `ganancia_sin_ventas`, `evento_moderado`} → OBSERVAR con motivo `salvedades_de_calidad` (`QUALITY_FLAGS`, `QUALITY_OBSERVE_AT = 2`). Una sola sigue COMPRAR. Grave sigue mandando solo.

**Convicción.** −0,3 por cada una de las tres banderas nuevas, con texto. `resultado_extraordinario` sigue sin penalizar (el núcleo ya corrige).

**Ranking.** El eje de crecimiento suma `revenueGrowthQuarterlyYoy` con el mismo peso que los otros tres: un trimestre en baja ya no queda tapado por el crecimiento a 5 años.

**Ficha y panel.** El prompt de la ficha recibe una línea "Calidad" con minoritarios, cuentas a cobrar y el último trimestre interanual; la sección Estados (SEC) de la ficha muestra lo mismo, en ámbar cuando cruza el umbral.

**Aceptación (NUTX, companyfacts al 2026-09-10, fixture `test/fixtures/nutx-companyfacts.json`).** Minoritarios TTM 92,6M; neto núcleo 196,4M; EPS núcleo ≈ 28 (Finnhub 25,3; antes 41); último trimestre ingresos −13,6% y operativo +261%; banderas `interes_minoritario` y `ganancia_sin_ventas`; con la demanda del 31/8, tres salvedades → OBSERVAR por `salvedades_de_calidad`. Cuentas a cobrar null (NUTX no usa un tag estándar): queda documentado como límite.
