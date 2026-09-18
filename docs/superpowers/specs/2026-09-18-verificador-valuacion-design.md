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
