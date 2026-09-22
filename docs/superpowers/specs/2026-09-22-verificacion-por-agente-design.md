# La verificación y la revisión las hace un agente de Claude, no Gemini

Fecha: 2026-09-22 · Rama: `feat-verificacion-agente` · Aprobado por el dueño en chat ("vamos así por ahora").

## Por qué

Del 15/9 al 22/9 la verificación web y la revisión antes de comprar con Gemini gratis fallaron de dos formas:

- **Cuota.** Cuatro claves gratis: 20 búsquedas por día por proyecto en 2.5-flash, y los 3.x saturados (503) la mitad del
  tiempo. El 21/9 y el 22/9 las cuatro claves estaban agotadas: ninguna verificación ni revisión corrió.
- **Datos inventados.** SEZL quedó "con reservas" por "ganancia limpia 0,04 contra 0,09 esperado"; el comunicado ante la
  SEC dice 1,13 ajustada contra 0,95 de consenso, con un beneficio fiscal de 1,9 M ya excluido. La revisión del 22/9 repitió
  el mismo dato falso. AII quedó "evitar" porque "no es una empresa cotizada" (salió a bolsa en 2025). La objeción de SMCI
  del 18/9 era el comunicado de un estudio de abogados buscando demandantes, no un regulador.

El 21/9 el agente de Claude Code, leyendo fuentes primarias, encontró lo correcto en los cuatro casos. `/hechos` ya corre
así los sábados con el plan del dueño, sin API key (`claude -p`).

## Qué cambia

### 1. El agente escribe hallazgos; la app decide

Una skill `/verificar` corre por cron y, para cada símbolo, hace dos tareas:

- **Verificar**: responde el cuestionario de siempre leyendo el comunicado de resultados (8-K/6-K), el 10-Q/10-K y los Form 4.
- **Revisar antes de comprar**: novedades de los últimos 30 días que cambien la compra.

No pone veredictos. Devuelve hallazgos con tipo, dato, fecha y URL, en un JSON que valida un esquema del núcleo:

- **Verificación**: último trimestre (fecha, ventas y ganancia contra consenso, extraordinarios con monto, ganancia por acción
  limpia y consenso como números, guía), analistas, eventos, valuación (`metric`, `current`, `min5y`, `max5y`,
  `growthAccelerating`), próximos resultados, `reservas[]` (tipo de la lista de siempre + detalle + fuente), `evitar[]`
  (motivo de una lista cerrada + detalle + fuente), `faltantes[]` (datos críticos no encontrados) y fuentes.
- **Revisión**: `objeciones[]` (tipo + detalle + fecha + fuente) y si la búsqueda se pudo hacer.

**La app decide por regla** (núcleo, puro, con test):

1. **Evitar** solo si hay un motivo de `evitar[]` con **fuente primaria** (los mismos hosts de `config/hechos-fuentes.json`).
   Es lo único de la IA que todavía frena una compra, así que tiene que salir de un documento. Un motivo sin fuente
   primaria baja a reserva `otra`.
2. **Reservas**, con las dos reglas del criterio escrito:
   - valuación: `aplicarValuacion` de siempre (en su máximo de 5 años, sin crecimiento que acelere, con los tres números);
   - **extraordinarios** (nuevo, el mismo defecto que valuación): vale solo si la ganancia limpia queda en línea o por
     debajo del consenso (`limpia ≤ consenso × 1,03`), con los dos números. SEZL (1,13 contra 0,95) no es reserva.
3. **Apto** si no queda ninguna reserva. Después, `aplicarFaltantes` de siempre: un apto con datos críticos sin encontrar
   vuelve a "con reservas", y un "evitar" que no encontró ni el último trimestre (AII) pasa a "con reservas".
4. **Revisión**: `objecion` si hay al menos una objeción con URL; `sin_objeciones` si se buscó y no hay; `no_pude_verificar`
   si la búsqueda no se pudo hacer. Se descarta como objeción el comunicado de un estudio de abogados buscando accionistas
   ("encourages investors", "investigation on behalf of", "law firm"): no es un hecho (SMCI, 18/9). La revisión sigue siendo
   solo un aviso, como desde el 18/9.

El motivo que se guarda lo arma el código: el primer "evitar" con fuente, o la primera reserva que queda, o
"sin reservas con fuente" más la guía.

### 2. Un solo cuestionario, con versión

El cuestionario y la forma del JSON viven en el núcleo. El CLI los entrega al agente (`verificar --pendientes`), así la skill
no tiene una copia que se desfase. La versión es `agente-v1-<hash>` del cuestionario más el esquema: si cambia, lo verificado
antes queda "cuestionario anterior" (aviso, no freno) y se rehace.

### 3. Qué se verifica y cuánto

`verificar --pendientes` arma la lista, por orden:

1. Las líneas del plan vigente y lo que el plan anotó (`verificationsPending`, `reviewsPending`).
2. Las COMPRAR del Radar que siguen por convicción, no frenadas por una regla fija, sin verificación vigente (7 días, versión
   del agente).

Topes por defecto: **8 verificaciones y 5 revisiones por día** (`config/verificacion-agente.json`). La revisión es solo de las
líneas del plan (vale por el día).

### 4. Cuándo corre

`scripts/launchd/run-verificar.sh`, de lunes a viernes a las 08:15 (launchd, como `/hechos`). **Espera a que el Radar del día
esté refrescado** (`job_runs.radar.last_date = hoy`), hasta 3 horas: con el corte del 22/9 habría esperado al "ponerme al día"
de las 09:51. Si a las 3 horas no hay refresco, no corre y lo deja en el log.

### 5. Cómo entra a la app

`verificar --importar <archivo>` valida el JSON, aplica la regla, escribe en las tablas que ya existen
(`radar_verifications`, `pretrade_reviews`) con la versión del agente, y le pide a la API que refresque solo esas filas y
rearme el plan (`POST /radar/tras-verificar`, lo mismo que hace hoy la API cuando llega una verificación). Si la API no
responde, lo dice: el próximo refresco lo toma igual.

### 6. Qué pasa con Gemini

- Se deja de llamar para verificar y revisar. `VERIFICADOR=agente` (por defecto) arma un verificador y un revisor que no
  buscan: dan la versión del agente y leen lo guardado. Las vueltas de la API cada 15 minutos (`asegurarVerificaciones`,
  `asegurarRevisiones`) no corren con el agente: si corrieran, la revisión fallaría tres veces y guardaría "no pude verificar".
- `VERIFICADOR=gemini` vuelve a lo de antes, sin tocar código.
- Fichas, narrador y clasificador de titulares siguen en Gemini. Pasarlos es otro paso.

### 7. Si falla

Plan de Claude agotado, corrida cortada o JSON mal formado: el importador rechaza lo que no valida (y dice por qué), la app
sigue con lo guardado y sus avisos. Un hallazgo sin URL se rechaza.

## Qué no cambia

- La compuerta del plan: de la IA solo frena "evitar"; lo demás va como aviso al lado de COMPRAR.
- Las reglas fijas, la convicción, el Radar, Cartera.
- Las verificaciones viejas de Gemini: quedan como historial.

## Casos reales bajo test

- SEZL 2T 2026: extraordinario de 1,9 M, limpia 1,13 contra 0,95 → no es reserva.
- BSM 15/9 (limpia debajo del consenso por un ítem no recurrente) → es reserva.
- AII: evitar sin fuente primaria → reserva; evitar con seis faltantes → con reservas.
- ATEX 12/9 (ganancia explicada por un ítem único, 8-K en sec.gov) → evitar.
- APH: valuación 29,5x en 22–32,5 y venta de directivos por ejercicio de opciones → apto.
- SMCI: objeción que es un comunicado de Kuehn Law → descartada; investigaciones del 10-K → objeción válida.
- Un hallazgo sin URL → rechazado por el importador.
- El agente sin la API arriba → importa, avisa, no rompe.

## Verificación de la salida

Antes de encender el cron: una corrida a mano de `/verificar SEZL SMCI AII APH`, sin tocar el plan hasta ver la salida.
Tiene que dar: SEZL sin la reserva de 0,04; SMCI con la investigación abierta como objeción válida; AII con la empresa
encontrada y sus números; APH sin reserva por la venta de directivos. Se le muestra al dueño y recién ahí se instala el cron.
