# Auditoría de pantallas del 15/9: una sola fuente, un solo discurso

El dueño pidió llegar al jueves 17/9, día del primer tramo, con cada cálculo, pantalla y valor controlado dos veces, sin
doble discurso y con una sola fuente de información.

Cuatro auditorías de solo lectura sobre datos reales:
- Radar;
- Cartera, Hoy y barra lateral;
- ficha, Uso y Corridas;
- un recálculo independiente.

**Los cálculos de base están bien.** Stops, franjas, objetivos, tamaños, medias, convicción, el reparto del plan y los
pesos de Cartera dan lo mismo recalculados desde las velas: 87 filas, sin diferencias.

Los problemas están en tres lugares:
- **qué base usa cada número**;
- **qué fecha dice**;
- **que la misma cosa se calcula en dos lugares**.

## Reglas que quedan como fuente única

1. **Una orden, una base.** Sin posición, el % al stop, el % al objetivo, el riesgo en USD y la cantidad se miden desde
   el precio que vas a pagar: el techo de la franja, o el nivel de disparo si hay que esperar confirmación. El texto dice
   la base. Con posición se mide desde el precio actual, y el texto también lo dice.
2. **El motivo definitivo va primero.** Las reglas fijas (convicción negativa, banderas que bloquean, stop en el ruido, no
   diversifica) se evalúan antes que la verificación web. Así el motivo que se muestra es el que vale y no se gasta cuota
   verificando lo que igual queda afuera.
3. **La instrucción manda.** Ninguna pantalla dice "comprar" (tampoco "Comprar ahora" en la entrada) si el plan no
   compra. La cabecera de la ficha lleva la misma etiqueta que el Radar y Cartera.
4. **Fechas.** Los precios dicen de qué cierre son. Las horas van en hora de Argentina. Una fecha UTC nunca se muestra
   como local.
5. **El mismo objetivo en todas partes.** Lo que ya tenés tiene el objetivo de la posición. El objetivo de una compra
   nueva se rotula "si sumás desde X".

## Hallazgos por paquete

### Paquete A: órdenes y plan (sesión principal)
Archivos: `plan.ts`, `conviction.ts`, `pipeline/src/radar.ts`, `Radar.tsx`, `RadarHelp.tsx`, `Entry.tsx`,
`instruccion.ts`, `flagLabels.ts`, `Sidebar.tsx`, `Novedades.tsx`, `argentina.ts`, más la migración 0023.

- A1. Bases de % distintas en la misma fila. Se arregla con un helper único desde el techo o el disparo, con la base escrita.
- A2. El control de ruido y el piso "no por debajo de" se miden al precio de la orden, no al cierre. Hoy PAM tiene piso
  84,22 contra techo 82,79: una orden imposible.
- A3. El tamaño del Radar ignora lo que ya tenés (PAM sumaría 15.700 sobre un 20%).
- A4. "Esperar confirmación" dice "orden limitada", pero el nivel está arriba del precio: tiene que decir "compra si cierra
  arriba de X".
- A5. La entrada dice "Comprar ahora" en verde aunque el plan no la compra (SNDK).
- A6. El orden de los motivos: la verificación se evalúa antes que las banderas (SNDK por `subio_mucho_12m`, bancos por
  `banco_sin_estados`). El plan tiene que guardar `verificationsPending` y los reintentos tienen que leer eso.
- A7. "verificación web: apta" aparece como "suma a la convicción" y no suma. Lo mismo `dividendo`. Una verificación
  apta con el cuestionario anterior no puede verse en verde.
- A8. TSM tiene dos motivos (QQQ en OBSERVAR y verificación con reservas) y el texto muestra el código crudo `bajo_stop`.
- A9. Los datos de entrada y la lista de lo que quedó afuera tienen distinto orden de verificación (LNC, DEC).
- A10. Tramos: "3 × 13.333" suma 39.999. Cada línea tiene que decir el primer tramo, su cantidad y la fecha. La nota de
  tramos es una instrucción. La tabla de ETFs dice "24.000 en el plan de hoy".
- A11. El motivo del núcleo dice "60%" y recibe el 100%. La nota de lugares vacíos no se escribe si no entró ninguna
  acción. El pie y la ayuda describen reglas viejas.
- A12. Dos objetivos para lo que tenés: PAM 84,61 en el Radar contra 96,19 en Cartera.
- A13. Varios: "2 avisos" sin decir cuáles, "$40,000" contra "USD 24.000", el texto fijo "Los 26 COMPRAR", el retorno
  de 12 meses pintado de color, y la ayuda de convicción sin régimen de tasas ni solapamiento.
- A14. Fechas: "candidatos del 15/9" con cierres del 14/9; `builtAt.slice(0,10)` da la fecha UTC (también en `pantallas.ts:117`).
- A15. Hoy: "Nuevas en el Radar" deja afuera el seguimiento y no dice "ya la tenés". Seguimiento dice "sin datos
  todavía" y es falso. La barra no pone chip a APH y TSM. Hay textos con "..".
- A16. Argentina: el objetivo se mide desde el cierre, los tooltips dicen SPY cuando es el Merval, y TEO no usa la regla
  de compra nueva.

### Paquete B: Cartera, curva, medición y tesis (agente 1)
Archivos: `Cartera.tsx`, `CurveChart.tsx`, `App.tsx` (solo `ThesisList` y `Calibration`), `core/src/cartera/*`,
`pipeline/src/cartera.ts`, las tesis y la corrida diaria (`dailyRun`), `routes/cartera.ts`.

- B1. Riesgo dice "valor al cierre del 15/9" con el cierre del 14/9. Tiene que decir la fecha de la última vela.
- B2. TSM dice MANTENER con el objetivo, el motivo y la narración de SUMAR. Hace falta un objetivo de mantener
  (`close + 2 × (close − stop)`) y el motivo del plan en vez de "Candidata a aporte".
- B3. Curva: "valdría hoy" es del 14/9 y cuenta 901 GGAL en vez de 920 (no toma el traspaso ni la reinversión de dividendos).
- B4. Peso contra valor con bases distintas (cierre contra precio en vivo). Criterio de "precio viejo" distinto: 3 días
  contra 30 horas.
- B5. Volatilidades sin la ventana en el rótulo. La medición cuenta como pendientes a las que ya están medidas a 7 días.
- B6. Propuestas: un mismo evento genera varias tesis vivas con números distintos. Falta la fecha de creación. Historial
  corta en 200 sin avisar. El edge figura como "%" en un lado y "puntos" en otro.

### Paquete C: ficha, Uso y Corridas (agente 2)
Archivos: `Ticker.tsx`, `PriceChart.tsx`, `niveles.ts`, `Verification.tsx`, `Peers.tsx`, `Uso.tsx`, `Corridas.tsx`,
`core/src/usage/*`, `apps/api/src/prices-hub.ts`, `pipeline/src/ticker.ts`, `routes/ticker.ts`.

- C1. Cabecera sin instrucción: tiene que llevar `RadarVerdict`/`CarteraVerdict`, y VTI no puede tener "NUCLEO" fijo.
- C2. Relación con posición pegada al stop (TSM 67,8 : 1): con posición no va la relación, va la distancia al stop con
  aviso. En OBSERVAR, "stop de compra" es en realidad el stop dinámico.
- C3. P/E núcleo de SNDK en 0,1 (acciones diluidas absurdas): hay que aplicar la banda del núcleo.
- C4. Los comparables de bancos usan un crecimiento que el ranking excluye: hay que pasar las fundamentales completas del par.
- C5. Verificación: la del cuestionario anterior aparece en verde, no se muestra cuántas fuentes tuvo, y el texto sobre
  qué se verifica es falso. Los comparables muestran 7 de las 12 métricas y dicen "de eso sale el score".
- C6. El cambio del período no dice su base (apertura contra cierre). Hay dos "cierres de ayer" (IEX contra Yahoo): el
  cambio del día tiene que medirse contra el cierre guardado.
- C7. Uso: falta la columna "límite", los avisos salen duplicados ("100% de null"), dice "agotada hoy" aunque después
  hubo respuestas buenas, los días sin registro aparecen como 0, y el día se corta a medianoche cuando la cuota se
  reinicia a las 04:00.
- C8. Corridas: horas en "—" porque `job_runs` quedó viejo hasta el 15/9; la "última corrida" es solo la de tesis.
- C9. Seguimiento: "VIVA" medido con el stop del alta (77,81) mientras la cabecera dice 77,67. Hay que rotularlo.

## Cómo se cierra

Cada hallazgo:
- se arregla con un test que usa el caso real;
- corre `pnpm verificar`;
- vuelve a pasar `pnpm auditar` y `pnpm consistencia`.

Los paquetes B y C trabajan en ramas propias y yo los integro. Nada llega a master sin el hook.
