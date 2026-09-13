---
name: auditar-pantalla
description: Auditoría obligatoria de una pantalla antes de darla por terminada. Verifica el origen de cada dato mostrado, que cada número se entienda sin leer el código, y que no contradiga a las otras pantallas. Usar SIEMPRE después de crear o modificar cualquier pantalla, aunque ya se haya auditado antes.
---

# Auditar una pantalla

## Por qué existe

Los tests comparan el código contra lo que yo mismo especifiqué. El typecheck compara los tipos contra sí
mismos. Ninguno de los dos mira si lo que la pantalla muestra **dice la verdad y se entiende**.

Entre el 9 y el 12 de septiembre de 2026, todos los errores graves los encontró el dueño mirando la pantalla
y preguntando, no la suite:

| Lo que él vio | Lo que era |
|---|---|
| "¿por qué una ganancia de 5,8%?" | La columna objetivo era el doble de la distancia al stop, correlación 1,0000 |
| "¿de verdad me hacés comprar esto?" | Reserva en SGOV que entraba cada mes y no salía nunca |
| "¿ninguno es realmente comprable?" | Las banderas a favor se pintaban igual que las salvedades |
| "¿qué es esto que no entiendo?" | Objetivos de analistas de antes de un split, con potenciales de +134% |
| "¿qué tiene que ver con la acción propia?" | Un comparable sin ingresos aplastaba el puntaje de Amphenol |

El patrón es siempre el mismo: **la pantalla mostraba un número que nadie había contrastado contra su
origen ni contra el resto de la app**. Esta skill existe para que eso deje de depender de que él pregunte.

## Cuándo correrla

**Siempre que se crea o se modifica una pantalla, un componente que renderiza datos, o el endpoint que la
alimenta.** No importa si esa pantalla ya se auditó antes: si se vuelve a tocar, se vuelve a auditar
entera. Un cambio chico en una columna puede romper el significado de otra.

También al cambiar una función del núcleo que produce algo que se muestra, porque ahí el número cambia sin
que la pantalla se toque.

## Procedimiento

### 1. Inventario de lo que se muestra

Listar **cada dato visible** de la pantalla. Para cada uno, completar la cadena hasta el origen:

```
campo mostrado → endpoint → columna o función del núcleo → fuente externa
```

Si algún eslabón no se puede nombrar, el dato no se entiende y eso ya es un hallazgo.

### 2. Origen y veracidad

Para cada dato, contestar con evidencia, no de memoria:

- ¿De dónde sale exactamente? Abrir el código, no suponerlo.
- ¿El valor mostrado coincide con el de su origen? Consultarlo en la base o recalcularlo a mano.
- Si es un porcentaje, ¿contra qué base está calculado, y esa base está a la vista?
- Si es una fecha, ¿de cuándo es el dato y eso se ve? Un dato de anteayer presentado como de hoy miente.
- ¿Puede ser nulo? ¿Qué se muestra entonces? Un hueco sin explicación es un hallazgo.

### 3. Comprensión

Leer la pantalla como alguien que no vio el código nunca:

- ¿Cada rótulo dice lo que el número realmente es? "Objetivo" no puede ser el doble de la distancia al stop
  presentado como ganancia esperada.
- ¿El color miente? Verde tiene que significar a favor. Si todo se pinta igual, una buena noticia parece una
  advertencia.
- ¿Un número sin contexto invita a una conclusión falsa? Un múltiplo calculado sobre una ganancia
  extraordinaria no mide el negocio, y hay que decirlo ahí mismo.
- ¿Se entiende qué hacer con el dato? Si no cambia ninguna decisión, sobra.

### 4. Coherencia entre pantallas

Ninguna pantalla puede contradecir a otra. El ejemplo que dio el dueño: **si en una pantalla una acción
figura como compra, en otra no puede figurar como venta.** Lo mismo vale para el precio, el stop, el momento
de entrada y el veredicto.

```bash
pnpm --filter @thesis/api exec tsx src/auditar.ts
```

Pide a la API lo mismo que pide el navegador y compara las pantallas entre sí. Sale con código 1 si hay algo
grave. **Antes de confiar en un verde, verificar que las reglas tengan datos que evaluar**: si Cartera y
Radar no comparten ningún símbolo, la regla de compra contra venta nunca se ejecuta y el verde no significa
nada. El comando imprime cuántos elementos cargó de cada pantalla justamente para poder mirarlo.

### 5. Coherencia de cada fila con sus fuentes

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts consistencia
```

Compara cada fila guardada contra sus propias velas, su verificación y sus reglas. Cero graves es el piso
para dar una pantalla por terminada.

### 6. Cerrar el hallazgo

Por cada cosa encontrada:

1. Arreglarla.
2. Agregar el caso como test o como chequeo automático, con el símbolo y la fecha reales en el comentario.
3. **Volver a correr los pasos 4 y 5.** Un arreglo puede romper otra pantalla.

## Reglas duras

- **Un número que el sistema no usa para decidir no puede estar destacado en la pantalla.** Si se muestra
  igual, va apagado y con su motivo.
- **Nunca borrar un dato para que la pantalla quede linda.** Se deja de calcular encima de él y se explica
  por qué. El dato crudo tiene que seguir disponible: fue mirando los objetivos con su fecha y su firma que
  el dueño detectó el split.
- **Una regla nueva solo puede quitar premios, nunca castigos.** Si se equivoca, el costo es ignorar algo
  bueno, no aceptar algo malo.
- **Antes de declarar que algo está bien, probar que la verificación tiene dientes.** Una comparación mal
  hecha da verde y no prueba nada. Pasó dos veces: el chequeo de precio comparaba una fila de ayer contra la
  vela de hoy y marcaba 14 errores inexistentes, y el de ROE dio falso positivo en NVIDIA, que tiene 110%
  con patrimonio real.
- **Verificar en la web lo que la base no puede confirmar.** Cuatro datos de la fuente de fundamentales
  estaban mal y solo se vieron contrastando contra balances y comunicados.

## Errores de esta clase que ya pasaron

Cada uno tiene su chequeo automático. Si alguno deja de fallar sin que se haya arreglado la causa, el chequeo
dejó de servir.

- Precio guardado distinto del cierre de su propia vela.
- Stop arrastrado del día anterior mientras el cierre sí se actualizaba.
- Verificación web guardada sin su bandera, así que no restaba convicción.
- Franja de compra con el piso arriba del techo.
- Objetivos de analistas de otra escala por un split sin ajustar.
- Línea del plan sin stop: plata que entra y no sale.
- Fila fechada mañana por calcular la fecha en UTC.
- Contador de residente crónico que contaba corridas en vez de semanas.
- Comparable sin ingresos corriendo la escala del grupo.
- Tarjeta que dice "2 a 1" al lado de porcentajes medidos desde otro precio (NVDA +9,1% / −1,6%, HIPO 97 a 1;
  13/9). Chequeo `dos_a_uno_falso`.
- Dos objetivos para la misma compra: el plan tomaba el stop del Radar y el objetivo de Cartera (TSM 472,46
  contra 498,44; 13/9). Chequeo `objetivo_distinto`.
- Stop de una compra nueva pegado al precio: el de seguimiento usado como stop inicial después de un retroceso
  (NVDA a 0,44 ATR, STNG a 0,00; 13/9). Chequeo `stop_dentro_del_ruido`.
- Crecimiento de ingresos de Finnhub inflado en bancos (NBN +124% contra +4% del comunicado; 13/9). Chequeo
  `crecimiento_sin_bandera`. La primera regla (umbral de 100% sin estados) marcaba crecimientos reales: correr
  cada regla contra la base antes de adoptarla.
- Prefiltro de noticias sin patrón para antimonopolio: los titulares del DOJ sobre NVDA estaban guardados y
  NVDA figuraba sin eventos (13/9).

**Y el que más importa:** la app se había calibrado a una respuesta mía de un día (la cartera del 10/9) y al
volver a verificar le cambié líneas. Empatar una salida no empata los chequeos. Cada diferencia entre lo que yo
concluyo verificando y lo que la app muestra se convierte en una regla con su test, antes de que el dueño
ejecute; si no se puede escribir como regla, se dice que es criterio mío.
