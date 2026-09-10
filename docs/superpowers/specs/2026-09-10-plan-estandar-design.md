# Plan estandarizado: coherencia, régimen macro y reparto por convicción (piezas 3, 4 y 5)

Fecha: 2026-09-10. Estado: implementado en `feat/plan-estandar` (sobre `feat/verificacion-candidata`). Objetivo: que el plan de la app para USD 40.000 dé las mismas líneas y las mismas exclusiones con motivo que mi cartera del 10/9 (reserva 6.000 en letras; VTI/VEA/VWO 12.000/6.000/3.000; APH, NVDA, LNC, NBN; NEM, HRTG y GLW afuera).

## Pieza 3: coherencia y consenso

- **Sumar contra el ETF del tema.** Una posición subponderada no se suma si el ETF de su tema (por `themes` de `config/etfs.json`) está en OBSERVAR. El plan lo dice en una nota: "No se sumó NEM: el ETF de su tema (GLD) está en OBSERVAR: …". Antes NEM entraba por regla mecánica mientras el mismo Radar tenía al oro bajo la media de 200.
- **`consenso_en_precio`**: mediana de objetivos de titulares (2 o más) o, si no hay, el consenso de la verificación web, a menos de 10% sobre el precio (`PRICE_THRESHOLDS`). −0,3 de convicción y no entra como posición nueva.
- **`subio_mucho_12m`**: subida de 12 meses mayor a 100% (GLW +133%, TER +223%; APH +47% no). −0,3 y no entra como nueva. Las dos juntas cuentan como salvedades de calidad (2 o más → OBSERVAR).
- La lista de seguimiento también se verifica en la web (mitad del tope por corrida): GLW queda con su dictamen y sus banderas como cualquier candidato.

## Pieza 4: régimen macro y reserva

`assessRegime` (core, puro) lee el bono a 10 años (`^TNX` de Yahoo, cotiza ×10; lo baja el plan y lo guarda en `candles_daily`):
- restrictivo: 10 años ≥ 4,5% o +40 pb en 63 ruedas → reserva `contribution.reservePctWhenRestrictive` (default 15%) en `reserveSymbol` (default SGOV) **antes** del núcleo, y −0,3 de convicción a lo sensible a tasas (sectores Inmobiliario y Servicios públicos, tema oro_mineria; Financiero no, gana con tasas).
- expansivo: −40 pb en 63 ruedas y por debajo de 4%. Neutral el resto. Sin reserva en ambos.
El núcleo toma su 60% sobre lo que queda tras la reserva. El régimen sale en las notas del plan y en el panel "lo que más recomienda".

## Pieza 5: plan por convicción

- Posiciones nuevas: `maxNewPositions = min(5, tope base + ⌊aporte / (3 × aporte mensual)⌋)` (40.000 con 6.500 mensuales → 4; 6.500 → 2).
- Reparto: cada acción pesa `1 + convicción` (1,5 contra 0,6 reparte 62/38, sin extremos); seguimiento y ETF pesan como el promedio. Tope por línea y por posición como antes.
- Un COMPRAR que ya está en el tope por posición (PAM al 15,8%) no ocupa un lugar: queda en la fila con "ya está en el tope del 15% por posición" y entra el siguiente (NBN).

## Aceptación (test `estandar.test.ts`, caso del 10/9 con 40.000)

Reserva SGOV 6.000 · VTI 12.240 · VEA 5.100 · VWO 3.060 · APH 3.559 · NVDA 3.545 · LNC 3.412 · NBN 3.084 = 40.000. Afuera con motivo: NEM (oro en OBSERVAR), HRTG (verificación con reservas), SOLV (ídem), PAM (tope por posición), TER (subió más de 100%), GLW (verificación con reservas). Contra mi cartera: mismas ocho líneas; diferencias de montos de 240 a 412 dólares por línea por el reparto proporcional.

## Lo que sigue siendo política tuya

El 15% de reserva y el umbral de 4,5% son valores por defecto en `config/radar-policy.json`; el plan los cita en la nota del régimen para que se vea de dónde salen.
