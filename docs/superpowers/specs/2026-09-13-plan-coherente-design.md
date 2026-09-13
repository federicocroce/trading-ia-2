# Plan coherente con la verificación manual (2026-09-13)

## Por qué

El 13/9 el dueño pidió mi criterio sobre el plan de 40k. Verifiqué cada línea en la web y la app no coincidió
conmigo en tres cosas: NBN (1° por convicción con un dato roto), el stop de NVDA y V (dentro del ruido) y el
objetivo de TSM (dos números en dos pantallas). Su reclamo: la app se había calibrado a mi cartera del 10/9 y
yo le cambiaba líneas. La causa es que el 10/9 congelamos una salida, no los chequeos. Esta enmienda convierte
cada diferencia en una regla, con el caso real como test.

Casos reales del 13/9 (cierre del 11/9):

| | Cierre | ATR14 | Stop de seguimiento | Distancia | Techo de franja | Objetivo |
|---|---|---|---|---|---|---|
| NVDA | 218,29 | 7,69 | 214,89 | 0,44 ATR | 222,66 | 238,20 |
| V | 370,45 | 5,67 | 368,15 | 0,41 ATR | 377,86 | 397,28 |
| TSM (en cartera) | 433,24 | 9,88 | 413,63 | 1,98 ATR | 441,90 | 498,44 en el Radar, 472,46 en el plan |
| NBN | 132,64 | 3,34 | 127,72 | 1,47 ATR | 135,29 | 150,43 |

Con 2 años de velas, un stop a esa distancia se tocó en las 5 ruedas siguientes el 71% (NVDA) y el 76% (V)
de las veces. NBN: Finnhub da ingresos +124% TTM y +133% trimestral; el comunicado dice +4%.

## Reglas

### 1. Stop de una compra nueva
- `entryStop(candles, entryLow) = min(stop de seguimiento, entryLow − 2,5 × ATR14)`, redondeado a centavos.
- El stop de seguimiento (máximo de 22 ruedas − 3 ATR) sigue siendo el FILTRO: `bajo_stop` y
  `stop_dentro_de_la_entrada` se evalúan con él, igual que hoy. Ninguna fila cambia de veredicto por esta regla.
- Si el símbolo ya está en cartera (`held`), el stop es el de seguimiento: una posición tiene un solo stop.
- Objetivo y tamaño se calculan con el stop que corresponda, desde el techo de la franja (sin cambios).
- ETFs: el motor lo aplica solo si el llamador lo pide (`newEntry: true`). Los ETFs del Radar lo piden; los
  ADR argentinos no (quedan como están, pendiente aparte).
- `stop_guardado` (consistencia) acepta el stop de seguimiento o el de compra nueva calculados con las velas
  de la fila; un stop viejo sigue siendo grave.
- Chequeo nuevo `stop_dentro_del_ruido` (grave): un COMPRAR que no está en cartera con el stop a menos de
  2,5 ATR del piso de la franja.

### 2. Un solo objetivo por símbolo
- La línea SUMAR del plan toma stop Y objetivo de la fila del Radar cuando el símbolo está en la corrida.
- Cartera, en SUMAR, calcula el objetivo desde el techo de la franja de compra (`entryTiming`), igual que el
  Radar. MANTENER/VENDER no cambian: el objetivo de una posición que no se compra es otra cosa.
- Chequeo nuevo `objetivo_distinto` (grave) en `auditar`: plan contra Radar, y SUMAR de Cartera contra Radar.

### 3. Ganancia y pérdida en la tarjeta "lo que más recomienda"
- `gainPct` y `lossPct` se miden desde el techo de la franja (`entryHigh`), el mismo precio que el objetivo:
  el texto "(2 a 1)" pasa a ser verdad. La tarjeta dice desde qué precio se mide.
- Se muestra el consenso de analistas (`consensusUpsidePct`, mismo precio base) y, si el objetivo lo supera,
  una salvedad informativa sin penalidad.
- Chequeo nuevo `dos_a_uno_falso` (grave) en `auditar` sobre `/radar/top`.

### 4. Crecimiento de ingresos no confiable en bancos
- Primera versión, descartada al correrla contra la base: "más de 100% sin estados de la SEC no entra". Marcaba
  además a NBIS (+488%), APLD (+365%) y ASTS, que crecen de verdad.
- Lo que muestran los datos: en la industria "Banking" Finnhub infla el crecimiento de ingresos en general (TFC
  +58%, AMTB +78%, MBWM +59%, JPM +109%, NBN +124%), cuando un banco crece de 0 a 15%.
- Regla: en bancos, el crecimiento de ingresos de Finnhub (TTM y trimestral) no entra al ranking; el de 5 años y
  el de EPS siguen. La fila lleva la bandera informativa `crecimiento_no_confiable`. Fuera de los bancos no cambia
  nada. Chequeo `crecimiento_sin_bandera` (grave) si un banco no la lleva.

### 5. Verificación web
- El cuestionario pide el EPS limpio contra el consenso (¿la sorpresa sobrevive sin extraordinarios?),
  ingresos contra el consenso, valuación contra la historia propia de 5 años y, en bancos, inmobiliario
  comercial sobre capital y fondeo mayorista. Criterio: si la sorpresa desaparece sin extraordinarios, o si
  la valuación está en su máximo de 5 años sin aceleración del crecimiento, o si es un banco con inmobiliario
  comercial > 300% del capital y fondeo mayorista creciendo → CON RESERVAS.
- La verificación guarda la versión del cuestionario (`promptVersion` en el resumen de la fila).

### 6. Quién entra al plan y adónde va la plata que sobra
- Una acción (comprar o seguimiento) entra solo con verificación `apto` hecha con el cuestionario vigente. Con
  el cuestionario anterior queda afuera con el motivo "verificación pendiente con el cuestionario nuevo".
- Un SUMAR cuyo símbolo tiene verificación en el Radar sigue la misma regla.
- Si una acción del tope queda afuera por la verificación, su lugar lo puede ocupar la siguiente SOLO si
  también está verificada y apta con el cuestionario vigente. Un lugar que ninguna acción llena no lo toma un
  ETF ni se reparte entre las demás: su parte va al núcleo, y la nota lo dice.

### 7. Noticias
- El prefiltro reconoce antimonopolio: DOJ, Justice Department, FTC, antitrust, "regulators … investigating",
  Comisión Europea y SAMR. El clasificador los trata como `moderado` (investigación a la empresa o a una
  operación suya) salvo que la noticia sea de un tercero.
- El barrido vuelve a pasar el prefiltro por las noticias ya guardadas de la ventana de 90 días: un cambio de
  prefiltro alcanza a lo ya leído (los 5 titulares de NVDA–Groq del 10/9).

### 8. Reunión de la Fed
- `config/fomc.json` con las fechas publicadas por la Fed (2026 y 2027). Si hay una decisión dentro de los
  próximos 3 días hábiles, el plan dice que el primer tramo va después (`firstTrancheFrom`). Sin probabilidad
  de mercado: la app no tiene una fuente gratuita confiable, y esperar ≤ 3 días cuesta poco con o sin cambio.

## Aceptación
Con los datos del 13/9: NVDA stop ≈ 199,07 y V ≈ 356,28; TSM stop 413,63 y objetivo 498,44 en Radar, plan y
Cartera; NBN con `crecimiento_sin_confirmar`; los 5 titulares de NVDA–Groq clasificados; el plan sin NBN y
con su parte en el núcleo si su verificación no sale apta; nota de la Fed del 16/9. `pnpm auditar` y
`pnpm consistencia` sin graves, y cada chequeo nuevo probado con el caso que lo motivó (tiene dientes).
Antes de adoptar las reglas 1, 4 y 6 se corren contra las filas guardadas y se lista a quién tocan.
