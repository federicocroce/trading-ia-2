# Thesis Engine — Documento de diseño v0.1

Sistema que genera, registra y mide tesis de inversión basadas en eventos y señales operativas, ejecutadas primero en paper trading. Objetivo: demostrar (o refutar) ventaja estadística antes de arriesgar capital real.

Este documento es la referencia. Lo que no está acá, no entra en la v1.

---

## 1. Principios

1. **Tesis antes que trade.** El sistema no opera; produce tesis. La ejecución es una consecuencia medible de la tesis, nunca el punto de partida.
2. **Todo se mide.** Cada tesis se registra con probabilidad estimada, precio implícito del mercado y resultado real. Sin calibración demostrada, no hay dinero real.
3. **Chico a propósito.** Ningún módulo nuevo hasta que 30–40 tesis cerradas en paper muestren edge positivo (ver §7).
4. **Filtrar antes de razonar.** Claude solo lee documentos de candidatos que pasaron filtros baratos. El costo de API es un riesgo de proyecto.
5. **Reglas duras en código, no en prompts.** Límites de posición, pérdida diaria y apagado viven en el módulo de riesgo, nunca en el LLM.

## 2. Alcance v1

**Universo**
- Acciones US listadas (NYSE/Nasdaq), con foco en small/microcaps con baja cobertura.
- ADRs argentinos: VIST, YPF, PAM, GGAL (más los que se agreguen por config).
- Opciones listadas sobre ese universo (solo calls/puts simples, sin spreads en v1).

**Tipos de tesis (event types)**
| Tipo | Fuente del evento | Fecha conocida |
|---|---|---|
| `fda` | PDUFA dates, AdCom, aprobaciones | Sí |
| `earnings` | Calendario de earnings (small caps y ADRs) | Sí |
| `legal` | Fallos, antitrust, sentencias con fecha | Sí |
| `macro_ar` | Eventos políticos/regulatorios argentinos con fecha (licitaciones, decretos, datos INDEC, fallos, elecciones) | Sí |
| `operational` | Señales operativas sin fecha: filings SEC, contrataciones, patentes, tráfico, importaciones | No |

**Fuera de alcance v1**: ejecución en cuenta real, apalancamiento, spreads de opciones, crypto, intradía, cualquier mercado fuera de US y ADRs.

## 3. Arquitectura

```
┌─────────────┐   ┌─────────────┐   ┌──────────────┐   ┌─────────────┐   ┌───────────┐
│  Ingesta    │──▶│  Filtro     │──▶│  Razonamiento│──▶│  Riesgo     │──▶│  Paper    │
│  (scheduler)│   │  (barato)   │   │  (Claude)    │   │  (reglas)   │   │  (Alpaca) │
└─────────────┘   └─────────────┘   └──────────────┘   └─────────────┘   └───────────┘
       │                                   │                                    │
       └───────────────────────────────────┴────────────────────────────────────┘
                                           ▼
                                  ┌─────────────────┐
                                  │  Base de tesis  │◀── Calibración / métricas
                                  │  (Postgres)     │
                                  └─────────────────┘
```

Cinco módulos con contrato explícito. Cada uno se escribe desde su interfaz, con un test que lo demuestra, sin mirar código de la app anterior.

### 3.1 Ingesta
Corre por cron. Cada fuente es un adaptador que emite `RawEvent`.

| Fuente | Qué trae | Costo |
|---|---|---|
| SEC EDGAR (full-text + XBRL) | 8-K, 10-Q, 10-K, 13D/G, Form 4, S-1 | Gratis |
| FDA (openFDA + calendarios PDUFA) | Fechas de decisión, AdCom | Gratis |
| Calendario earnings (Alpaca/Yahoo) | Fechas y consenso | Gratis |
| Precios y opciones (Alpaca Market Data) | OHLCV, chain, IV | Gratis (paper) |
| CourtListener / PACER RSS | Fallos con fecha | Gratis / bajo |
| Noticias (NewsAPI + RSS locales AR: Ámbito, Infobae, BCRA, INDEC, Boletín Oficial) | Contexto y eventos macro AR | Bajo |
| Datos alternativos (fase 2) | Patentes (USPTO), job postings, importaciones (ImportGenius/Panjiva) | Variable |

### 3.2 Filtro
Reglas determinísticas, sin LLM. Descarta antes de gastar tokens.
- Liquidez mínima (volumen promedio, spread).
- Cobertura: para `operational`, solo tickers con < N analistas.
- Ventana: para eventos con fecha, entre 5 y 45 días al evento.
- Dedupe: un `RawEvent` por (ticker, tipo, fecha).
- Presupuesto: máximo K candidatos por día pasan al razonamiento.

### 3.3 Razonamiento (Claude)
Un candidato entra con su paquete de documentos primarios (filing completo, transcripts, comparables históricos del mismo tipo de evento). Claude devuelve JSON estricto:

```json
{
  "ticker": "XXXX",
  "event_type": "fda",
  "event_date": "2026-10-14",
  "direction": "long | short",
  "p_estimate": 0.72,
  "p_market": 0.55,
  "edge": 0.17,
  "instrument": "stock | call | put",
  "entry_max": 12.40,
  "target": 18.00,
  "invalidation": "Texto concreto: qué hecho anula la tesis",
  "confidence": "low | med | high",
  "reasoning": "Resumen de 5–10 líneas con citas a documentos",
  "sources": ["edgar:0001234-26-000123", "fda:pdufa:..."]
}
```

`p_market` se deriva del precio de opciones (para eventos binarios) o del movimiento implícito por earnings. Si `edge < umbral` (inicial: 0.10), la tesis se guarda como `rejected` pero **igual se registra**, para medir si el umbral es correcto.

Base histórica de comparables: el sistema guarda todos los eventos pasados del mismo tipo con su resultado, y se los pasa a Claude como contexto. Esto es lo que mejora con el tiempo.

### 3.4 Riesgo
Módulo determinístico, sin excepciones:
- Máximo 10% del capital por tesis.
- Máximo 30% del capital en tesis del mismo tipo de evento.
- Pérdida diaria máxima 3%: se pausa todo hasta revisión manual.
- Cero apalancamiento. Opciones: solo prima pagada, máximo 3% del capital por contrato.
- Kill switch manual y automático (por errores de datos, desconexión de feeds).
- Salida por invalidación de tesis (evaluada por Claude contra noticias nuevas), no solo por precio.

### 3.5 Paper trading (Alpaca)
- Cuenta paper. Cada orden queda enlazada a un `thesis_id`.
- Se registran fills reales de paper, no precios teóricos.
- Al cierre del evento (o por invalidación), la tesis se marca `closed` con PnL y `outcome` (¿pasó lo que se predijo?).

### 3.6 Base de tesis
Postgres. Tablas mínimas:
- `raw_events` — todo lo ingerido, aunque se descarte.
- `theses` — el JSON de §3.3 más estado (`proposed | rejected | open | closed`), timestamps, versión del prompt.
- `orders` — órdenes y fills, con `thesis_id`.
- `outcomes` — resultado real del evento, PnL, si la invalidación se disparó.
- `prompt_versions` — cada cambio de prompt con hash, para atribuir mejoras.

## 4. Flujo humano (v1)

1. Cada mañana el sistema propone N tesis con edge ≥ umbral.
2. Fede revisa y aprueba/rechaza cada una (un click). El rechazo humano también se registra: sirve para medir si el criterio humano suma o resta.
3. Las aprobadas se ejecutan en paper.
4. Semanalmente: reporte de calibración (§7).

La ejecución sin aprobación humana no existe en v1.

## 5. Stack

- TypeScript monorepo (pnpm workspaces): `apps/api` (Hono), `apps/web` (React), `packages/core` (tipos y contratos), `packages/adapters` (una carpeta por fuente).
- Postgres + Drizzle.
- Scheduler: cron dentro del proceso o un worker separado (BullMQ + Redis) si la ingesta crece.
- Anthropic SDK con tool use para el JSON estricto; modelo barato para filtrado semántico si hace falta, modelo fuerte solo para razonamiento final.
- Tests: Vitest. Cada adaptador con fixtures grabadas (VCR-style), sin pegarle a APIs en CI.

## 6. Lo que se puede rescatar de la app vieja (recién en la etapa 3)

Solo se abre el repo anterior cuando el esqueleto nuevo corre de punta a punta. Cada pieza pasa por una pregunta: ¿resuelve algo que este documento necesita, está aislada y se entiende en cinco minutos? Candidatos probables: cliente de Alpaca, cliente de Yahoo/NewsAPI, tipos de tickers. Todo lo demás se descarta por defecto.

## 7. Métricas de éxito (criterio de salida de paper)

Después de mínimo 30 tesis cerradas (idealmente 40+), el sistema pasa a considerar dinero real solo si:
- **Brier score** de `p_estimate` mejor que el de `p_market` (el sistema calibra mejor que el mercado).
- **Hit rate ajustado**: PnL medio por tesis > 0 después de costos y slippage de paper.
- **Drawdown máximo** < 15% del capital paper.
- Ningún evento de riesgo (kill switch) por error de sistema en las últimas 4 semanas.

Si no se cumple, no se agrega capital: se revisa el prompt, la fuente de comparables o el tipo de evento, y se repite. Es probable que la primera versión no lo cumpla, y ese es un resultado válido.

## 8. Riesgos del proyecto

- **Costo de API**: un filing 10-K son 100k+ tokens. Mitigación: filtro duro, secciones relevantes por XBRL, caché de documentos ya razonados.
- **Datos sucios**: fechas PDUFA mal cargadas, splits, ADRs con horarios distintos. Mitigación: validación en ingesta, tests con fixtures.
- **Overfitting del prompt**: ajustar el prompt mirando resultados pasados infla la métrica. Mitigación: `prompt_versions` y evaluación solo sobre tesis posteriores al cambio.
- **Sesgo de alcance**: tentación de agregar features. Mitigación: este documento; nada entra sin pasar §7.

## 9. Plan de etapas

| Etapa | Entregable | Criterio de listo |
|---|---|---|
| 0 | Este documento aprobado | Fede lo revisa y firma |
| 1 | Repo nuevo, `packages/core` con tipos y contratos, DB con migraciones | Tests de contrato pasan |
| 2 | Ingesta: EDGAR + earnings + precios Alpaca + 1 fuente AR | Corre por cron 3 días sin errores |
| 3 | Filtro + razonamiento con 1 tipo de evento (`earnings`) | 10 tesis generadas y revisadas a mano |
| 4 | Riesgo + paper trading + UI de aprobación | Primera tesis ejecutada en paper con `thesis_id` |
| 5 | Resto de tipos de evento (`fda`, `legal`, `macro_ar`, `operational`) | Cada tipo con ≥ 5 tesis |
| 6 | Reporte de calibración semanal | Métricas de §7 visibles |
| 7 | Rescate selectivo de la app vieja | Solo lo que pasa §6 |

Recién después de 30–40 tesis cerradas se discute dinero real.
