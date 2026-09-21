# La reserva por valuación la decide el código, no el modelo

Fecha: 2026-09-18 · Rama: `fix-verificador-valuacion`

## El problema, con sus números

Desde el cuestionario del 15/9 (`v1-07c33234178c`) hubo 17 verificaciones web y **ninguna salió apta**: 16 "con reservas"
y 1 "evitar". En 15 de las 17 el motivo es la misma frase: *"la valuación está en el tercio superior de su historial de
5 años"*. Como "con reservas" deja a la acción afuera del plan, el plan compra cero acciones desde el 15/9, sea cual sea
la acción.

El cuestionario no dice eso. Dice que es reserva una *"valuación en su **máximo** de 5 años contra su propia historia
sin que el crecimiento se acelere (solo con el múltiplo actual y el rango de 5 años: sin esos números no es reserva)"*,
y que **no** es reserva *"una valuación premium que el crecimiento sostiene"*. El modelo no lo aplica:

| | lo que encontró | lo que dijo |
|---|---|---|
| APH | 29,5x en un rango de 22,0 a 32,5 (71% del rango) | "tercio superior" → con reservas |
| NVDA | ~45x en un rango de 25 a 70 (44% del rango: el tercio del medio) | "tercio superior" → con reservas |
| CROX | 9,7x contra una mediana de 5 años de 9,9x (debajo de su mediana) | "tercio superior" → con reservas |
| LNC | 5,5x adelantado contra un promedio de 4,77, sin mínimo ni máximo | "tercio superior" → con reservas |

Es la tercera vez que este criterio falla por redacción (13/9: LNC, HIPO y DEC repetían "máximo de 5 años" sin número;
se agregó "sin esos números no es reserva" y ahora trae el número pero cambia "máximo" por "tercio superior"). Cambiar
otra vez la redacción no alcanza. Se hace lo mismo que el 15/9 con los datos faltantes (`aplicarFaltantes`): **lo decide
el código**.

## Qué cambia

1. **El estructurador devuelve dos cosas más** (no cambia lo que se le pregunta a la web):
   - `reservas`: la lista de salvedades que el informe da como motivo del dictamen, una por entrada, con `tipo`
     (`valuacion`, `extraordinarios`, `insiders`, `guia`, `pico_de_ciclo`, `banco`, `un_analista`, `adquisicion`,
     `demanda`, `dato_faltante`, `otra`) y `detalle`.
   - `valuationNumbers`: `metric`, `current`, `min5y`, `max5y` (números) y `growthAccelerating` (sí, no o no dice).
2. **Regla `aplicarValuacion`**, solo sobre un dictamen "con reservas":
   - la reserva de valuación **vale** si están los tres números, el múltiplo está en el 10% de arriba de su rango de
     5 años (`(actual − mínimo) / (máximo − mínimo) ≥ 0,90`) y el informe no dice que el crecimiento se acelera;
   - si no vale, se quita. Si era la única, el dictamen pasa a **apto** y el motivo lo dice con los números
     ("la única reserva era la valuación: 29,5x en un rango de 22 a 32,5, no está en su máximo de 5 años"). Si quedan
     otras, sigue "con reservas" y el motivo pasa a ser la primera que queda (TSM: la venta de insiders);
   - "con reservas" **sin lista de reservas** no se toca: falla cerrado;
   - "evitar" y "apto" no se tocan. Después corre `aplicarFaltantes`, igual que hoy: un apto con datos críticos sin
     encontrar vuelve a "con reservas".
3. **Volver a estructurar sin volver a buscar.** El informe de cada verificación está guardado (`research_text`). Cambiar
   el estructurador cambia la versión, y sin más las 17 quedarían "con cuestionario anterior" y habría que buscarlas de
   nuevo, con una cuota de búsqueda de menos de 10 por clave y por día. Como lo que se le pregunta a la web **no cambió**,
   `verifyFor` re-estructura el informe guardado cuando (a) su versión está en la lista de versiones con el mismo
   cuestionario de investigación, (b) tiene menos de 7 días y (c) el informe está completo. Guarda la fila con la versión
   nueva y **la misma fecha** (los hechos son de ese día; la vigencia de 7 días se cuenta desde la búsqueda). No gasta
   presupuesto de búsqueda. Si el estructurador falla, queda lo que había y se reintenta en la próxima vuelta.
   Un test fija el hash de `RESEARCH_SYSTEM`: el día que alguien cambie el cuestionario, la lista de versiones
   compatibles tiene que vaciarse.

## Qué no cambia

- `RESEARCH_SYSTEM` (el cuestionario), la cuota, el tope por corrida, la compuerta del plan, el resto de las reservas.
- No se agregan columnas: los números quedan escritos en el motivo. La ficha muestra lo mismo que hoy.

## Sobre "una regla nueva nunca quita una penalidad"

Esta no quita una penalidad de la regla: hace cumplir la regla que ya está escrita desde el 13/9 y que el modelo no
aplica. Lo que sí es decisión y queda a la vista: **0,90** como medida de "en su máximo". Con 0,85 SEZL (87,5%) sigue
con reservas; con 0,90 no.

## Casos reales bajo test

- APH 15/9: 29,5 en 22,0–32,5, única reserva → apto, con los números en el motivo.
- NVDA 18/9: 45 en 25–70 → apto.
- TSM 15/9: valuación + insiders → sigue con reservas, motivo: insiders.
- LNC 15/9: sin mínimo ni máximo → la reserva de valuación no vale ("sin esos números no es reserva").
- Un múltiplo en 97% de su rango y sin aceleración → la reserva vale.
- El mismo con `growthAccelerating: true` → no vale.
- "Con reservas" sin lista → no se toca.
- Apto por esta regla pero con FALTANTES → vuelve a con reservas.
- `verifyFor`: fila de la versión anterior, fresca, con informe → re-estructura, no gasta presupuesto, conserva la fecha;
  vencida o de otra versión → busca como siempre; si el estructurador falla → queda lo anterior.

## Verificación de la salida

Antes de mergear: pasar los 17 informes guardados por el estructurador nuevo **sin escribir en la base**, y revisar uno
por uno contra su texto que la lista de reservas esté completa (el riesgo es que el estructurador omita una reserva y
la regla apruebe de más). La tabla resultante —qué pasa a apto, qué sigue con reservas y por qué— se le muestra al dueño
antes de mergear.

---

# Segunda parte: las dos compuertas de IA avisan en vez de bloquear (opción A)

Aprobada por el dueño el 18/9, después de ver la simulación de la primera parte.

## Por qué no alcanzaba con arreglar el verificador

Simulación del plan del 18/9 sin escribir, con las 6 verificaciones que la regla pasa a "apto": APH, SMCI, NVDA y PGY
pasaban la verificación (NVDA y PGY además volvían de OBSERVAR a COMPRAR: la reserva falsa contaba como segunda salvedad
de calidad) y **el plan seguía comprando solo núcleo**: las cuatro quedaban en "revisión antes de comprar pendiente".
Esa revisión se creó el 15/9 y **nunca corrió** (`pretrade_reviews`: cero filas). Pide una búsqueda de Gemini por acción
**y por día**, su instrucción es "buscá razones para no comprarla", y solo "sin objeciones" dejaba pasar. El mismo día,
16 llamadas a Gemini gratis sin búsqueda lograron 2 respuestas en 10 minutos (503 y claves agotadas).

Las reglas de la app sí encontraban candidatas. Lo que las frenaba eran dos controles de IA en serie, corridos por un
modelo gratis y saturado, y los dos sesgados al no.

## La regla

- De la IA **solo frena lo que afirma algo con fuente**: verificación "evitar" (sea del cuestionario que sea) y una
  revisión con "objeción" (toda revisión guardada trae fuentes: una respuesta sin búsqueda se descarta antes).
- **Avisan y no frenan**: "con reservas", verificación pendiente, verificación con el cuestionario anterior, revisión
  pendiente y "no pude verificar". Van escritos con ⚠ en la línea del plan y como dato (`PlanLine.avisos`); toda pantalla
  que diga COMPRAR o SUMAR los muestra al lado de la etiqueta.
- **Siguen frenando las reglas fijas** que salieron de NBN y GFI: banco sin estados, subió más de 100% en 12 meses,
  consenso a menos de 10%, bajo oferta de compra, stop en el ruido, no diversifica (correlación ≥ 0,85), convicción
  negativa, tope por posición.
- Lo que entra sin verificación vigente o sin revisión queda anotado (`verificationsPending`, `reviewsPending`) y corre
  solo; si la revisión encuentra una objeción, la línea sale en el rearmado y "por qué cambió" lo dice. Una revisión
  pendiente ya no pone todo el plan en ESPERAR.
- "Con reservas" sigue restando 0,3 de convicción y contando como salvedad de calidad en el Radar: eso no cambia.

## Lo que cambia en un caso ya fijado

El caso del 10/9 (APH, NVDA, LNC, NBN, con HRTG afuera por su reserva) pasa a APH, NVDA, HRTG, LNC: HRTG es 3° por
convicción y entra con su reserva escrita; NBN, 7°, queda sin lugar. La diferencia la explica esta regla y ninguna otra.

## Simulación del plan del 18/9 con el código nuevo (sin escribir)

| escenario | núcleo | acciones | ETF |
|---|---:|---|---|
| recién desplegado (verificaciones tal como están) | 26.159 | APH 4.918 · TSM 4.741 · SMCI 4.182, las tres con ⚠ con reservas y ⚠ revisión pendiente | — |
| verificaciones re-estructuradas | 24.000 | APH 3.608 · SMCI 3.131 · TSM 3.073 (⚠ insiders) · NVDA 2.987, las cuatro con ⚠ revisión pendiente | CIBR 3.201 |

Siguen afuera por regla fija: SNDK, SIMO, LQDA (subieron más de 100%), NBN, ORRF, HSBC (banco sin estados), SLDE, MEDP
(consenso), CROX, VIST (convicción negativa), PGY (tope de 4 posiciones nuevas).

**Lo que la simulación muestra y esta regla no resuelve:** las cuatro acciones son del mismo tema (semiconductores y
hardware de IA) y el plan no mide la correlación de las líneas nuevas entre sí, solo contra lo que ya se tiene.

## Riesgo aceptado

Se pierde el freno automático del 15/9 ("el verificador falla cerrado" como bloqueo). Lo cubren las reglas fijas y el
aviso visible; una reserva genuina (HRTG: reservas liberadas en temporada benigna) ya no deja afuera, la muestra.

---

# Tercera parte: la objeción de la revisión también avisa

Aprobada por el dueño el 18/9, después de ver correr la revisión por primera vez.

**Qué pasó.** A las 12:17 se rearmó el plan con la segunda parte: núcleo 30.900 + APH 4.918 + SMCI 4.182. A las 12:19 la
app corrió sola la revisión antes de comprar de las dos —la primera vez en su historia— y **las dos volvieron con
objeción**: APH, "el CEO y el CFO vendieron unos USD 172 M en acciones en 90 días"; SMCI, "nueva investigación legal por
ventas a empresas chinas… y ventas de directivos" (22 fuentes cada una). El plan se rearmó y volvió a solo núcleo.

**Por qué.** A la revisión se le pide "buscá razones para no comprarla". En una empresa grande casi siempre hay ventas de
directivos o una rebaja de objetivo en 30 días, y sobre SMCI los estudios de abogados publican "investigaciones" todas
las semanas. Como información sirve (el dato de APH conviene leerlo antes de comprar); como compuerta frena todo: 2 de 2.

**La regla.** La revisión antes de comprar **nunca frena**: pendiente, objeción y "no pude verificar" van escritos con ⚠
en la línea y en `PlanLine.avisos`. De la IA queda frenando solo el "evitar" de la verificación web. Siguen frenando las
reglas fijas y Cartera sobre lo que ya se tiene.

**"Por qué cambió".** Una objeción que aparece sobre una línea que ya estaba no mueve plata, así que antes no se listaba.
Ahora un cambio en los avisos de una línea con el mismo monto se lista como `aviso`, con el texto del aviso nuevo (o
"ya no lleva avisos: …" cuando se van).

**Riesgo aceptado.** Una objeción genuina (una licencia que vence, una guía recortada ayer) ya no saca la línea sola: está
escrita al lado de COMPRAR y la decisión es del dueño.

---

# Cuarta parte: lo que todavía frenaba un paso antes

Aprobada por el dueño el 18/9 ("aplicá todos los puntos"), después de preguntar por qué de 40 acciones solo 2 llegaban al plan.

**Los números del Radar del 18/9 (40 acciones):** 13 en OBSERVAR por precio (legítimo: mercado flojo), 13 en OBSERVAR por
"dos salvedades de calidad" —**en 10 de las 13 una de las dos era la reserva del verificador**—, 1 por "evitar", 1 por otro
motivo, y 12 en COMPRAR, de las cuales 10 quedaban afuera del plan por regla fija (3 subieron más de 100%, 3 bancos sin
estados, 1 consenso cerca, 2 convicción negativa, 1 Cartera dice REVISAR).

1. **"Con reservas" deja de contar como salvedad de calidad** (`QUALITY_FLAGS`). Es la misma señal que ya se aprobó que avise
   en el plan, frenando un paso antes. Sigue restando 0,3 de convicción y sigue a la vista. Caso: NVDA (evento moderado +
   la frase de la valuación). Dos salvedades que no son de la IA siguen pasando a OBSERVAR (NUTX, el caso del 10/9).
2. **Un "evitar" que no encontró nada no es un evitar.** AII el 15/9: "no se ha encontrado evidencia de que sea una empresa
   cotizada" (salió a bolsa en 2025), con los seis puntos del cuestionario sin encontrar. `aplicarFaltantes`: "evitar" con 3
   o más datos críticos sin encontrar, entre ellos el último trimestre, pasa a "con reservas" con ese motivo, y se repite
   al vencer. Un evitar por un hallazgo (ATEX, AES) no cambia. Y `reverificar SÍMBOLO [--buscar]` permite pedirlo a mano:
   una fila en OBSERVAR por "evitar" no se vuelve a verificar sola hasta el ranking posterior a su vencimiento.
3. **Un banco cuyos estados la app no puede leer queda en OBSERVAR** (`banco_sin_estados` pasa a ser motivo, como
   `bajo_oferta_de_compra`). NBN, ORRF y HSBC eran 3 de las 12 COMPRAR (7 de 46 en la pasada ancha): el plan no los compra
   nunca, rankean alto por un crecimiento que el proveedor infla, y ocupaban filas y verificaciones.
4. **Medir los frenos** (`pnpm frenos [7|30|90]`, solo lectura): alfa contra el S&P de lo que cada freno dejó afuera, contra lo
   que ningún freno tocó, solo entre lo que la técnica dejaba comprar; dice cuántos símbolos distintos hay y avisa cuando
   son pocos. Al 18/9 todavía no hay filas medidas con esos frenos (las medidas a 7 días llegan a las candidatas del 10/9):
   hay dato hacia el 22/9. Es una medición, no cambia ningún veredicto.

**No se tocó:** las dos reglas de precio ("subió más de 100%", "consenso a menos de 10%"). Chocan con cómo elige la app (elige
lo que sube y lo saca por haber subido), pero se deciden con la medición, no a ojo.

---

# Quinta parte (21/9): dos avisos que salieron de comparar el plan con la lectura del agente

El 21/9 el plan compraba APH, CDLR, SEZL y SMCI. La revisión automática no corrió (Gemini agotado) y el dueño pidió el
criterio del agente contra fuentes primarias. Coincidió en todo menos en SMCI, por dos cosas que ninguna regla medía.
Aprobado por el dueño: convertirlas en reglas, para que la app llegue sola o lo desmienta.

1. **`investigacion_regulatoria`, un tipo nuevo de hecho externo** (organismos, asunto, estado, si la empresa está acusada;
   ventana de un año). Abierta y verificada → bandera `investigacion_abierta`: resta 0,3 de convicción (como un evento
   moderado) y va al lado de COMPRAR ("un titular puede abrir con un salto por debajo del stop"). No frena. SMCI: su 10-K dice
   que DOJ, SEC y BIS siguen abiertas. El comunicado de un estudio de abogados buscando demandantes —lo que había marcado
   la revisión automática el 18/9— **no** es este hecho, y la skill `/hechos` lo dice. Se suman justice.gov, ftc.gov y bis.gov
   a las fuentes primarias.
2. **`objetivo_sobre_consenso`**: el objetivo de la app (mecánico: el doble del riesgo desde la entrada) queda 15% o más por
   encima del consenso de analistas (SMCI: 53,15 contra 42,38). Resta 0,15 y va al lado de COMPRAR. No cambia el veredicto.
   Un consenso fuera de escala (APH tras su split: 196 contra 78) ya se descarta antes.

Las dos son avisos con peso en la convicción, no frenos: el orden del plan puede cambiar, y `pnpm frenos` las va a medir.
De paso: un test de rutas tenía una fecha fija (25/9/2026) que empezó a fallar el 21/9; ahora es relativa.

---

# Sexta parte (21/9): la lista de líderes, que se mide y no entra al plan

META subió 12,7% en un día (Muse, Connect el 23/9) y la app no la compraba ni antes ni después; "subió más de 100%" saca
del plan a SNDK, SIMO, TER y MU. Los frenos cuidan de comprar techos, pero la app decía "no" y nunca volvía con un "ahora
sí". Medido ese día a 7 días: lo que frenó "no perseguir" (19 símbolos) rindió −0,41% contra −1,31% de lo que sí dejaba
comprar; "subió más de 100%" (4 símbolos) −3,56%: poco dato y en las dos direcciones. Aprobado por el dueño: **primero
medir, sin plata.**

- `estadoDeLider` (núcleo, puro): líder = frenada **solo** por haber subido ("no perseguir", "subió más de 100%", y el
  "consenso cerca" o las "dos salvedades" que salgan de eso), sin nada en contra del negocio, que no esté ya en cartera y que
  no se esté debilitando ("esperar confirmación": LRCX bajo su media de 50). **En retroceso** = hoy en zona, con boleto
  ejecutable y algo a favor (guía subida o sorpresa positiva). **Esperando** = todavía extendida.
- Es una marca en la fila (`lider_en_retroceso`, `lider_esperando`): no toca veredicto ni convicción ni plan. Así la medición
  que ya existe la cubre sin tabla nueva: `pnpm frenos` suma los dos grupos.
- Tarjeta "Líderes" en el resumen del Radar: estado, dónde entrar o qué nivel esperar, stop, objetivo y **medio tamaño**, con
  el cartel de que no entra al plan. Auditada: fecha del precio a la vista, el motivo real de la espera (BE), sin LRCX ni
  posiciones propias.
- Al 21/9 (simulado): en retroceso PARR, SHIP, SIMO, TER; esperando BE, FRO, META, SNDK.
- Se decide con `pnpm frenos 7` y `30`: si "líder en retroceso" le gana a "COMPRAR que ningún freno tocó" con 10 o más
  símbolos, se le abren 1 o 2 lugares en el plan con medio tamaño; si pierde, no se puso un peso.
