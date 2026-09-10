# Registro de uso de fuentes externas

Fecha: 2026-09-10. Estado: implementado en `feat/registro-uso` (sin spec previo: el dueño pidió desarrollarlo directamente; este documento deja escrito lo que se construyó y por qué).

## Problema

No había registro de cuánto se le pedía a Gemini, Finnhub, Alpaca, SEC o Yahoo, ni por paso ni por clave. Del log de tres días (8 al 10/9) salió que la cuota gratis de Gemini alcanza de sobra (4 claves = 4 proyectos × 3 modelos × 250 a 1.500 pedidos diarios contra 40 a 150 usados) y que las fallas eran propias: sin freno por minuto, 429 por minuto tratado como cuota diaria, cuatro rastreadores de cuota separados, y llamadas desperdiciadas por validación (fichas con resumen de más de 400 caracteres, tesis con `eventDate` en formato que no valida).

## Qué se construyó

1. **Tabla `external_calls`** (migración 0012): una fila por pedido saliente con hora, fuente, paso, propósito, símbolo, endpoint sin query, modelo, clave, estado HTTP, resultado (`ok`, `rpm`, `rpd`, `saturado`, `validacion`, `error`), tokens de entrada/salida/pensamiento y milisegundos. Índices por hora y por fuente+hora. Retención 90 días (`USAGE_RETENTION_DAYS`, se borra en cada chequeo de "ponerme al día").
2. **Un solo punto de salida.** `recordingFetch` (core) envuelve `fetch` y registra host, path, símbolo, estado y tiempo; el container lo inyecta en el cliente HTTP general, el de Yahoo, el de trading de Alpaca, las descripciones de Yahoo y el macro argentino. Gemini registra por su cuenta desde el transporte con tokens, modelo, clave y propósito.
3. **Atribución por paso** con `AsyncLocalStorage` (`withUsageStep` en pipeline): "ponerme al día" y los crons fijan el paso (`scan`, `cartera`, `radar`, `argentina`, `plan`, `tesis`, `ordenes`), el hub de precios fija `precios`, y toda ruta HTTP fija `api`.
4. **Escritura por lotes** (`StoreUsageRecorder`): `record` es sincrónico y encola; se vuelca cada segundo o a las 50 filas; `setResult` corrige en memoria o en la base. Un store caído nunca frena un pedido.
5. **Cuota de Gemini bien tratada.** Freno de 8 por minuto por modelo+clave (`KeyedRateLimiter`), compartido entre fichas, eventos, narrador y tesis junto con un solo `QuotaTracker`. El 429 se clasifica por el detalle de Google (`quotaId` PerMinute/PerDay y `RetryInfo.retryDelay`): por minuto espera lo pedido (tope 65 s) y reintenta la misma clave una vez; por día marca la clave hasta la medianoche de California; sin detalle se asume diario como antes.
6. **Fugas cerradas.** `parseCard` recorta resumen, motivo y riesgo al último fin de oración dentro del tope en vez de descartar la llamada; `parseProposal` normaliza `eventDate` (se queda con `YYYY-MM-DD` o cae a la fecha del evento). Toda respuesta que no valida marca su fila como `validacion`.
7. **Panel.** `GET /usage?date=` devuelve el resumen del día (`summarizeUsage`, puro): por fuente contra límite por minuto y por día, Gemini por modelo y clave con tokens y costo equivalente en plan pago, por paso, y avisos (fuente sobre 80% de su límite, Gemini fallando más del 20%). Se muestra dentro del modal de corridas del encabezado; el botón marca los avisos.

## Límites conocidos (en código, `USAGE_LIMITS`)

Gemini 10 por minuto y 250 por día por modelo y clave (piso conservador); Finnhub 60 por minuto; Alpaca 200 por minuto; SEC 600 por minuto; Yahoo sin límite. Precios de Gemini de septiembre 2026 para el costo equivalente.

## Tests

Core (fetch que registra, limitador por clave, agregación), reasoner (transporte con recorder, 429 por minuto y por día, saturado, validación, freno compartido, recorte de ficha, fecha de tesis), pipeline (registrador por lotes y contexto), db (integración contra Postgres), api (`/usage`). Smoke: API en :3003, ficha de NUTX deja filas de Alpaca y Finnhub atribuidas a `precios` y `api`.

## Fuera de alcance

Persistir el rastreador de cuota entre reinicios (cuesta una llamada por clave redescubrirlo y queda registrado); contar búsquedas web del modelo (no existen todavía); elegir la fecha del panel desde la UI.
