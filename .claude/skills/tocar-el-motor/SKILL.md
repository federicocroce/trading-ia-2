---
name: tocar-el-motor
description: Obligatoria antes de cambiar cualquier regla, umbral, peso, tope o filtro que decida qué comprar o vender. Exige medir antes de cambiar, con la ventana y el sesgo declarados, y distinguir lo que frena de lo que informa. Usar SIEMPRE que se toque ranking, compuertas, frenos, convicción, plan, stops o tamaño de posición.
---

# Tocar el motor

## CONGELADO del 10/10/2026 al 7/11/2026

Decisión del dueño (10/10): "nada de esto genera confianza" si las reglas cambian cada dos días. Hasta el 7/11 **no
se cambian pesos, orden medido, frenos ni topes** de lo que decide comprar o vender. Solo se corrige un error
demostrado (un dato falso, dos pantallas que se contradicen, un bug), y se dice que es eso.

Lo que el analista no comparta de una línea del plan va por `analista --importar` con un criterio de la lista, nunca
como consejo en el chat (ver `packages/core/src/radar/analista.ts`).

Revisiones con fecha y con la medida escrita de antemano:

- **21/10**: líderes en retroceso a 30 días (`pnpm frenos 30`). Si no se sostienen, el tope de 2 baja a 0.
- **7/11**: el registro de aciertos (pestaña Registro del Radar). Si las compras del plan no le ganan al S&P, la app
  deja de recomendar acciones y queda en núcleo de ETFs más la disciplina de venta. Se miran también los vetos del
  analista: si no aciertan más de la mitad, el canal se cierra.
- **Hipótesis a medir el 7/11** (no son reglas): retorno de 12 meses menor a 10%. El 10/10, a 30 días, rindió −12,5%
  contra −6,5% y −5,2% de los tramos de arriba, en orden, pero con 7 acciones y una sola mitad. La sacó el dueño
  mirando MMSI ("la media de 200 está planchada"); la pendiente sola, medida dos veces, no predice.


## Por qué existe

Entre el 7 y el 8 de octubre de 2026 cambié reglas de decisión en esta app apoyado en razonamientos que
sonaban bien y eran falsos. Cada vez el dueño lo tuvo que señalar, o lo descubrí yo una hora después de
haberlo escrito. Esta skill es la lista de las formas concretas en que me equivoqué.

| Lo que hice | Por qué estaba mal |
|---|---|
| Me negué a subir el tope de posiciones: "más de una señal con rendimiento negativo empeora el resultado" | El tope no controla cuánta plata va a la señal, controla en cuántos nombres se reparte. Repartir lo mismo en más nombres baja la varianza con la misma media |
| Iba a aflojar los frenos de momento porque el agregado decía +2,26% contra +0,15% | Ese resultado venía ENTERO del régimen neutral (79% de la muestra). En régimen restrictivo el freno acierta: 12 meses >100% da −1,77% contra −0,20% |
| Iba a aflojar `bajo_sma200` porque medía +2,08% | Sesgo de supervivencia: una acción bajo su media que llegó hasta hoy es, por definición, una que se recuperó |
| Puse en negrita "la media está plana" como advertencia | Acababa de medir que la pendiente NO predice y decidir que no frene. Destacarla invitaba a la conclusión falsa de que la app la castiga |
| Dije "el ranking no se puede backtestear" | Cierto para re-rankear con otros pesos; falso para el puesto, que `radar_evaluadas` venía guardando todos los días desde el 24/9 y nunca miré |
| Tiré la media de 200 de la fila de acciones | `technicalGate` la calcula y la devuelve; `decideCandidate` la descartaba. La fila guardaba la de 20 y la de 50, y la de un ETF sí guarda su `distSma200Pct` |

El patrón: **cambié o descarté algo sin medirlo, o medí sin mirar el régimen, el sesgo y la población.**

## Procedimiento

### 1. Antes de tocar, medir el embudo

Nunca cambiar un umbral sin saber cuánto filtra y a qué costo. Preguntar con datos:

- ¿Cuántas candidatas pierde esta regla? Si la respuesta es "46 de 70", el cuello es ésta y no otra.
- ¿Qué les pasó después a las que dejó afuera? El alfa está guardado por fila a 7, 30 y 90 días.

```bash
pnpm frenos 7      # qué pasó con lo que cada freno dejó afuera, contra lo que ninguno tocó
pnpm conviccion 7  # ¿el orden por convicción separa ganadores de perdedores?
pnpm simular 30    # las condiciones de PRECIO del motor, sobre todo el histórico de velas
```

### 2. Cruzar por régimen, siempre

**Un agregado sin cruzar por régimen de tasas no sirve para decidir.** El régimen neutral es ~79% de las
observaciones del histórico, así que cualquier promedio es el promedio del régimen neutral disfrazado de ley
general. La misma regla acertó en restrictivo y costó 2,6 puntos en neutral.

Si el cambio va a ejecutarse HOY, lo que manda es el cruce del régimen de HOY, no el agregado.

### 3. Declarar el sesgo antes de leer el número

El universo con velas son los símbolos que llegaron hasta hoy. **Eso infla sistemáticamente a los grupos de
caídos**, porque un papel que cayó y sobrevivió es uno que se recuperó.

El control: el alfa de TODAS las observaciones tiene que estar cerca de cero contra el índice. Si da +0,95%,
la muestra está inflada ~1 punto y hay que restarlo mentalmente — más en los grupos de caídos, menos en los
de momento.

**Regla**: si el hallazgo apunta en la misma dirección que el sesgo, no se actúa. Se anota y se dice qué dato
lo resolvería.

### 4. Mirar los símbolos distintos, no las filas

Una fila es un símbolo en un día. 500 filas de 10 símbolos son 10 observaciones. Cada medición de esta app
imprime las dos cosas y dice "POCOS SÍMBOLOS: es ruido" por debajo de su barra. Respetarla.

### 5. Separar lo que FRENA de lo que INFORMA

- Si está **medido que no predice**, se muestra y no frena. Y se muestra **apagado, sin negritas**, con su
  motivo: destacar un número que el sistema no usa invita a una conclusión falsa.
- Si está **medido que protege**, frena, con la medición en el comentario.
- **Sin régimen conocido, se aplican todos los frenos.** No se afloja una regla por no saber en qué régimen
  estamos.
- Una regla nueva solo puede quitar premios, nunca castigos: si se equivoca, el costo es ignorar algo bueno.

### 6. Buscar el dato antes de calcularlo

Antes de decir "no tengo ese dato", buscarlo. Dos veces estaba guardado:

- `radar_evaluadas` guarda el **puesto** de cada símbolo evaluado por día. Es punto en el tiempo y permite
  medir si el ranking predice, sin ningún backtest.
- `technicalGate` **devuelve** `sma200`, `return21dPct` y `atrPct`, y `decideCandidate` los tiraba.

Y al revés: lo que la fila no guarda, la pantalla no puede explicar. Si una regla decide con un número, ese
número tiene que viajar en la fila.

### 7. Después de cambiar, buscar lo que el cambio rompió

Todo cambio de reparto o de tope cambia la geometría de la ejecución. Lo que apareció al subir el tope de 4 a
7 posiciones:

- Las líneas se hicieron más chicas y **las acciones caras dejaron de alcanzar para un lote por tramo**: LLY
  con USD 1.949 y la acción en 1.212 daba `trancheQty = 0`. Línea inejecutable.
- El plan decía desplegar 40.000 cuando con lotes enteros desplegaba 37.970.

**Chequear siempre**: ¿cada línea compra al menos una acción por tramo? ¿La suma de cantidad × precio se
parece al monto que el plan dice desplegar? Si no, el plan se está sobrevendiendo.

### 8. Cuando un test falla por el cambio, preguntar qué probaba

Un test que falla puede estar fijando el comportamiento viejo con razón, o puede no haber probado nunca lo
que decía. Pasó: el test de "el lugar vacío no lo toma un ETF" comparaba montos por línea entre dos planes de
**forma distinta** (uno con línea de ETF y otro sin ella, porque esa es la otra mitad de la misma regla). La
igualdad se cumplía por una coincidencia aritmética del tope apretado.

Antes de actualizar un test: entender por qué pasaba antes. Si pasaba por coincidencia, cambiarlo por la
invariante real y decirlo en el comentario.

### 9. Verificar contra la salida, no contra el código

```bash
pnpm test && pnpm typecheck          # necesario y no alcanza
pnpm consistencia                    # cada fila contra sus velas, su verificación y sus reglas
pnpm auditar                          # las pantallas entre sí
```

La suite verde con 1.388 tests convivió con: un fondo cerrado en el plan con USD 3.132 asignados, dos
pantallas con stops distintos para la misma posición en VENDER, y un barrido que podía estar truncado sin que
nada lo viera. **Correr el motor de verdad y mirar la salida.**

Y después de cambiar código, **reiniciar la API**: el primer `cartera/run` después de un arreglo devolvió los
números viejos porque el proceso había arrancado antes de la edición.

```bash
launchctl kickstart -k gui/$(id -u)/com.thesis-engine.api
```

### 10. Dejar la decisión escrita donde vive la regla

Cada umbral lleva en su comentario: la medición que lo justifica, con la ventana, los símbolos distintos y el
régimen. Un umbral sin eso es criterio mío disfrazado de regla, y el dueño ya dijo que eso no sirve.

## Reglas duras

- **Lo que no se puede medir, no se cambia.** Se anota, se dice qué dato lo resolvería, y se deja como está.
- **Lo que el dueño ya decidió no se revierte sin su palabra.** La revisión previa avisa y no frena (18/9):
  eso es su decisión. Se corre, no se discute.
- **No cargar un hecho con una URL que no se abrió.** Fuente primaria significa que se fue a buscar y se leyó.
- **Al ensanchar el universo, esperar basura nueva.** Subir la preselección a 600 destapó un fondo cerrado
  rankeado con métricas de empresa, primero de un grupo de 15 símbolos sin industria. Después de ensanchar,
  mirar los nombres nuevos uno por uno.
- **Las fundamentales son de hoy.** Para rankear el pasado existe `fundamentals_historia` y hay que tomar,
  por símbolo, la última versión con fecha ≤ la del test. `as_of` es la fecha en que se pidió el símbolo, no
  un corte uniforme.
- **Decir el estado real, no el cómodo.** La app no tiene filo de selección demostrado: el tramo de mejor
  puesto rindió −1,74% con 34% de acierto. Eso se dice junto con cualquier mejora, no en su lugar.
