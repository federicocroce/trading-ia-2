# Lo que la app no ve (2): P5c, P11, P12, P13 y P15

Aprobado por el dueño el 24/9 ("encara todas") sobre el informe [docs/mercado/2026-09-24.md](../../mercado/2026-09-24.md).
Cada cambio lleva su caso real y su test, y se hace con test primero. Rama `worktree-mercado-24-9`.

## Tarea 1 — P12: un dividendo que no se puede comprobar no se muestra

**Caso real (24/9).** MYE figura con `dividendo:27,11`: Finnhub da `dividendPerShareTTM` 8,40 y
`dividendPerShareAnnual` 0,55, y la empresa paga 0,135 por trimestre. PBR figura con `dividendo:15,01`, TSM con 4,73 y
KB, PKX y TM con rendimientos de 100% a 20.000%: esas empresas reportan en BRL, TWD, KRW o JPY, y el dividendo en moneda
local se divide por el precio del ADR en dólares.

- `Fundamentals.currency` (nueva, opcional): la moneda de reporte del perfil. Columna `fundamentals.currency`, cargada
  desde `symbol_meta` en la migración y guardada por el barrido.
- `dividendYieldPct` devuelve null si la moneda es conocida y no es USD, o si el dividendo de 12 meses y el anual
  difieren en más del doble.
- Control `dividendo_fuera_de_escala` (aviso) sobre las filas del Radar en esos dos casos.
- Tests: MYE (8,40 contra 0,55) sin bandera y con aviso; PBR (BRL) sin bandera; ABR (USD, 26%, los dos campos
  iguales) conserva la bandera; sin moneda guardada, el cálculo sigue como antes.

## Tarea 2 — P5c: la oferta se ve desde el día del anuncio

**Caso real (24/9).** MG (H.I.G., 20,35 en efectivo, 18/9) en COMPRAR con objetivo 23,32; BWIN (32,50, 14/9) en
COMPRAR; PRTH (8,05, 21/9) sin bandera. Los tres tienen solo DEFA14A y un 8-K item 1.01 del mismo día: el PREM14A
llega semanas después. El 8-K de un acuerdo con un activista también es 1.01 más DEFA14A el mismo día, y los 8-K de
fusión de MG y PRTH traen además el 5.02, así que los items no alcanzan: lo que distingue es el texto
("Agreement and Plan of Merger").

- Core: `anuncioDeFusion(filings)` puro: un DEFA14A y un 8-K con item 1.01 del mismo emisor, el mismo día o con un
  día de diferencia, dentro de 120 días; devuelve el 8-K a leer. `textoDeFusion(texto)`: el 8-K habla de un acuerdo de
  fusión y no de uno de cooperación.
- Core: `bajoOfertaDeCompra` acepta el título `ANUNCIO DE FUSION — <empresa>` como prueba sola.
- Adaptador `EdgarOfferForms`: cuando encuentra la pareja, baja ese 8-K (un pedido más, solo en ese caso) y si el
  texto lo confirma agrega el título.
- `/hechos`: el punto (c) pide también el comunicado de un acuerdo definitivo cuando la empresa es la comprada
  (fusiones en acciones y emisores extranjeros: EFSI y TECK), y se cargan esos dos casos con el importador.
- Tests: MG al 24/9 → `bajo_oferta_de_compra`; una asamblea anual (DEFA14A sin 8-K cerca) → nada; un acuerdo de
  cooperación con 1.01 + 5.02 + DEFA14A → nada, porque el texto no habla de fusión.

## Tarea 3 — P13: ganancia extraordinaria como hecho externo

**Caso real (24/9).** TAL, en el plan con USD 3.466, tiene `sorpresa_positiva` por 0,73 contra 0,29, pero 405,2 M
de los 552,3 M de ganancia antes de impuestos del 1T FY27 son "otros ingresos, principalmente por el valor razonable
de ciertas inversiones" (6-K del 30/7). Sin eso, ~0,20 por ADS: debajo del consenso. Presenta 6-K, así que la app no
tiene estados legibles y `resultado_extraordinario` no puede correr.

- Hecho `ganancia_extraordinaria` `{ trimestre, montoUsd, concepto, epsPublicado, epsSinExtraordinario, epsConsenso }`,
  ventana de 120 días. Si verificado y no sobrevive al consenso → bandera `ganancia_extraordinaria`, −0,3 (como
  `ganancia_por_reservas`).
- `/hechos`: busca esto para las filas `sin_estados` con sorpresa positiva.
- Carga del hecho de TAL con el 6-K como fuente primaria.
- Tests: TAL con el hecho pierde 0,3 de convicción y lleva la salvedad; un hecho que sobrevive no marca nada.

## Tarea 4 — P11: el Radar suma COMPRAR nuevas todos los días

**Caso real (24/9).** 13 COMPRAR con estados de la SEC dentro de la preselección de 300 y fuera del Radar. Las
COMPRAR del Radar bajaron de 52 (domingo 20/9) a 31 (jueves 24/9) sin que entrara ninguna: el refresco diario solo
rehace las filas existentes. Y no se pudo saber por qué faltaban nueve de ellas: el Radar no guarda las evaluadas
que no entraron.

- Core: `reemplazosDelDia(actuales, nuevas, { top, maxRows }, protegidas)` puro. Las `top` mejores por puntaje no se
  tocan; el lugar libre hasta `maxRows` se ocupa primero; después, cada COMPRAR nueva reemplaza a la OBSERVAR de peor
  puntaje que no esté entre las `top` ni protegida (en cartera).
- Pipeline: el refresco completo (no el parcial) reevalúa la preselección con las velas del día, con las mismas
  reglas y la misma construcción de fila que el ranking (función extraída, no copiada), agrega las que entran y poda
  las que salen.
- Tabla `radar_evaluadas` (fecha, símbolo, puesto, veredicto, motivo): la escriben el ranking y el refresco para cada
  evaluada de la preselección que no quedó en el Radar. CLI `radar-cli.ts porque SIMBOLO`.
- Tests: una fila que cruza la media de 200 a mitad de semana entra al día siguiente reemplazando a una OBSERVAR
  sobrante; las `top` y lo que está en cartera no salen; la tabla dice por qué no entró cada una.

## Tarea 5 — P15: medir los grupos de pares

**Caso real (24/9).** GLXY contra gestoras y BDC (OWL, CG, ARCC…), VRSN contra software de crecimiento (NET, CRWV,
TWLO…); las dos 1 de 11. Los pares salen de Finnhub y comparten su industria gruesa ("Financial Services",
"Technology"), así que comparar industrias no lo detecta.

- Medición, sin cambio de regla: CLI `radar-cli.ts pares` que, para cada acción del Radar, calcula la correlación de
  retornos diarios de un año contra la mediana de su grupo, con las velas guardadas, y lista las de correlación baja.
- El número va al informe y a la memoria; el cambio de regla (si hace falta) se decide con él.

## Cierre

`pnpm verificar` en verde, revisión de código, merge a master con el hook, reinicio de la API y una corrida del
comando `mercado` sobre los casos reales (MG, BWIN, PRTH, MYE, PBR, TAL) para ver que la app llega sola.
