# Lo que la app no ve (17/9): preselección más ancha, ofertas en toda la preselección, hechos externos

## Por qué

El informe de `/mercado` del 17/9 ([docs/mercado/2026-09-17.md](../../mercado/2026-09-17.md)) midió lo que la app no
llega a ver, con las reglas de la propia app:

- **133 acciones en COMPRAR que el Radar no muestra**: 13 dentro de la preselección de 150 y 120 más allá. Ocho de
  los diez finalistas del informe están entre los puestos 177 y 238; el arreglo del 16/9 (hasta 80 filas) no los
  alcanza porque solo rescata COMPRAR que ya estaban dentro de las 150.
- **FIVE en el puesto 412**: subió la guía dos veces, comparables +14% por tráfico, y la app no tiene forma de
  enterarse. Un hecho hoy solo puede sacar del plan (verificación web), nunca hacer que la app mire a alguien.
- **Seis empresas bajo contrato de venta con franja, stop y objetivo calculados** (AES, WTRG, ROKU, DV, BZH, BWMN).
  La regla `bajoOfertaDeCompra` existe desde el 16/9, pero solo recibe formularios para el universo de ingesta de
  EDGAR (posiciones, seguimiento, plan y COMPRAR del Radar). Ninguna de las seis está ahí, y el comando `mercado`
  no pide formularios.
- **RNR, PGR, ESNT y HG con riesgo 1 a 3** mientras su ganancia publicada se sostiene con liberación de reservas o
  con un fondo externo. El riesgo mide volatilidad; la app no distingue una ganancia real de una que no se repite.

Reglas del dueño que mandan acá:

- 16/9: el informe **no modifica nada**; el producto es que la app llegue sola al mismo resultado, y cada diferencia
  se vuelve un cambio en la app con su test y su caso real ([[feedback-no-cambiar-sin-regla]]).
- 14/9: COMPRAR tiene un solo significado; si una pantalla lo dice, él compra ([[feedback-comprar-un-solo-significado]]).
- 17/9, sobre el cron de hechos: **el agente escribe hechos, no veredictos**. Si guardara "FIVE: COMPRAR" habría dos
  varas. Guarda "FIVE: guía anual subida el 2/9 de 8,65-9,05 a 9,83-10,31, fuente 8-K en sec.gov", y la app decide.
- 17/9, orden aprobado: primero P2 y P5b (código, sin agente), después el cron con dos tipos de hecho (guía y
  reservas) en modo semanal; medir costo antes de subir la frecuencia.

## Medido antes de decidir

| Qué | Medido el 17/9 | Consecuencia |
|---|---|---|
| Estados de la SEC que pide el ranking (preselección ∪ pares) | 150 → 2.090 símbolos; 300 → 2.404; 600 → 2.592. Con 300, el primer día pide ~250 estados más que hoy; después quedan en caché 7 días | El costo de los estados **no** es lo que frena subir la preselección |
| Velas | 600 símbolos sin caché: 3,5 minutos | +150 velas por día es menos de un minuto |
| Ficha por fila (modelo) y verificación web (Gemini) | una ficha por fila guardada el día del ranking; 6 verificaciones por corrida; cuota de 20 pedidos por día por proyecto | `maxRows` se queda en 80: cada fila más es una ficha más |
| Cadencia | el ranking corre los **domingos a las 20:00** (barrido + ranking); las 07:50 de lunes a viernes son el refresco, que rehace las filas que ya están | todo lo que cambia el corte se ve el domingo siguiente, no al día siguiente |
| Filas COMPRAR con preselección de 300 | 57 (13 dentro de 150, 44 entre 151 y 300) | con `top` 40 y `maxRows` 80 entran las 40 mejores de esas 57 por puntaje |

## Piezas

### 1. Preselección de 300 (P2)

- `config/radar-policy.json`: `candidates.preselect` pasa de 150 a 300. `top` (40) y `maxRows` (80) no cambian.
- El comando `mercado` ya toma la preselección de la política: sin `--preselect` corre con 300.
- Test con el config real (como el de `maxRows` del 16/9): `preselect` ≥ 300, con el caso escrito: RNR 178, HG 183,
  ARW 185, GL 204, ESNT 212, IOSP 221, ARGX 238 al 17/9 quedaban afuera con 150.
- Lo que NO hace: no sube `maxRows`. Con 300 preseleccionadas y 57 COMPRAR, entran al Radar las 40 mejores por
  puntaje más las COMPRAR siguientes hasta 80 filas. Si el dueño quiere más filas, es una decisión de cuota de
  Gemini, aparte.

### 2. Oferta de compra en toda la preselección y en `mercado` (P5b)

**Adaptador.** `EdgarOfferForms` en `@thesis/adapters` (misma familia que `EdgarIngestor`): `offerFilingTitles(ticker)`
baja el JSON de submissions (un pedido por símbolo, CIK resuelto con la tabla que ya se cachea) y devuelve los
títulos de DEFM14A, PREM14A, SC 14D9 y 425 de los últimos 400 días, en el mismo formato que guarda el ingestor
(`"<formulario> — <empresa>"`). Cachea por símbolo dentro del proceso. Respeta el límite de la SEC (10 pedidos por
segundo) con el mismo cliente HTTP que usan los estados.

**Contenedor.** `filingsDeOferta` pasa a ser: lo guardado en `raw_events` si hay; si no, la consulta en vivo. Nunca
escribe. Sirve igual al Radar y al comando `mercado` (que corre con el almacén en modo sin escribir).

**Núcleo.** En `decideCandidate`, `bajo_oferta_de_compra` pasa a ser motivo de **OBSERVAR**, no solo bloqueo del
plan. Motivo: una fila que dice COMPRAR se compra (regla del 14/9), y un precio fijado por contrato no es una compra.
La entrada en `PLAN_BLOCKERS` se queda como segunda defensa. Los niveles se siguen calculando (las pantallas y el
control de consistencia los esperan); la etiqueta de la bandera ya dice que el precio lo fija el acuerdo.

**Ranking.** `rankRadar` pide `filingsDeOferta` para **todas** las filas de la preselección con velas, antes del
primer `decideCandidate`, para que una empresa bajo oferta no cuente como COMPRAR al elegir las filas que se guardan.
Son hasta 300 consultas por ranking semanal (la mayoría resueltas desde `raw_events` o en vivo en menos de un minuto).
`refreshRadar` ya lo pide por fila: no cambia.

**Comando `mercado`.** `explorarMercado` pide `filingsDeOferta` para cada símbolo con velas y se lo pasa a
`decideCandidate`. En la pasada ancha de 600 son unos dos minutos más; en la angosta, segundos.

**Tests.**
- Adaptador: un JSON de submissions con un DEFM14A de hace 120 días devuelve su título; un `DEF 14A` (asamblea anual)
  no; un 425 de hace 20 días sí; uno de hace 500 días no.
- Núcleo: `decideCandidate` con `filings: ["DEFM14A — ROKU"]` devuelve OBSERVAR con la bandera; sin filings,
  COMPRAR.
- Pipeline: `rankRadar` con `filingsDeOferta` que devuelve un DEFM14A para un símbolo de la preselección deja la fila
  en OBSERVAR y el plan no la lista; `explorarMercado` lo mismo en su fila.
- Casos reales que se verifican con el comando después de mergear (`mercado ROKU WTRG AES DV BZH BWMN`): los seis en
  OBSERVAR con `bajo_oferta_de_compra`. ROKU: DEFM14A del 1/9/2026; WTRG: 425 del 9/9/2026; AES: DEFM14A del
  15/5/2026; DV: PREM14A del 11/9/2026; BZH: PREM14A del 3/9/2026; BWMN: 8-K del 14/9/2026 (si no tiene formulario de
  oferta todavía, queda como caso que la regla no cubre y se dice).

### 3. Hechos externos: tabla, importador y reglas (P6 chica, reservas, ofertas con precio)

**Qué es un hecho.** Un dato con fecha y fuente que la app no puede sacar de sus proveedores, en un formato que las
reglas puedan leer. Tres tipos en esta etapa; cada uno con su forma (validada con zod en `@thesis/core`):

| tipo | valor | quién lo usa |
|---|---|---|
| `guia` | `{ direccion: "sube" \| "baja" \| "reafirma", metrica, periodo, antes: string \| null, despues: string \| null }` | convicción y la puerta de entrada (abajo) |
| `ganancia_por_reservas` | `{ trimestre, montoUsd, puntosCombinado: number \| null, epsPublicado, epsSinReservas, epsConsenso: number \| null }` | convicción |
| `oferta_de_compra` | `{ comprador, efectivoUsd: number \| null, ratio: { acciones, de } \| null, etapa, cierreEsperado: string \| null, formulario: string \| null }` | veredicto y el texto de la fila |

Campos comunes: `symbol`, `tipo`, `fecha` (la del hecho, no la de la carga), `valor`, `fuente: { url, titulo }`,
`primaria` (lo calcula el importador), `estado: "verificado" | "no_verificado"`, `origen: "agente" | "manual"`,
`detectadoAt`, `vigenteHasta` (opcional).

**Tabla** `hechos_externos` (migración 0024): una fila por hecho, única por (símbolo, tipo, fecha, url de la
fuente). Es la **única** tabla que este mecanismo escribe. El Radar, el plan, las fundamentales, las velas y los estados
no se tocan.

**Importador** `radar-cli.ts hechos --importar <archivo.json> [--origen agente|manual]`:
- valida el esquema; lo que no valida se rechaza con su motivo y no entra;
- exige `fuente.url` con fecha; `primaria` es verdadero solo si el host está en `config/hechos-fuentes.json` (sec.gov,
  fda.gov, cms.gov, ferc.gov, federalregister.gov, whitehouse.gov, prnewswire.com, globenewswire.com,
  businesswire.com: reguladores y cables de comunicados de empresa; la lista se edita a mano);
- `estado` = `verificado` si `primaria`, si no `no_verificado`. **Las reglas solo actúan sobre lo verificado**; lo no
  verificado se muestra con su estado y no cambia nada. Es la lección del 13/9: un dato inventado dentro de un
  recordatorio no puede mover un plan;
- imprime qué entró, qué se rechazó y por qué.

**Reglas** (en `buildFlags`, con `extra.hechos`; solo hechos verificados y dentro de su ventana):

| hecho | bandera | efecto | ventana |
|---|---|---|---|
| `guia` sube | `guia_subida` | +0,2 de convicción, con texto "subió la guía el {fecha}: {metrica} {antes} → {despues}" | 90 días |
| `guia` baja | `guia_recortada` | −0,3 de convicción | 90 días |
| `guia` reafirma | `guia_reafirmada` | solo informa | 90 días |
| `ganancia_por_reservas` con `epsSinReservas < epsConsenso` (o sin consenso) | `ganancia_por_reservas` | −0,3 de convicción, con texto "la ganancia del {trimestre} lleva {montoUsd} de reservas liberadas: sin eso {epsSinReservas} contra {epsConsenso} esperado" | 120 días |
| `oferta_de_compra` | `bajo_oferta_de_compra` (la misma que los formularios) | OBSERVAR; la salvedad dice "vale {acciones} acciones de {de}" o "vendida a {efectivoUsd} en efectivo ({comprador}, {etapa})" | hasta `vigenteHasta` o 400 días |

Los pesos copian los que ya existen (`sorpresa_positiva` +0,2; `sorpresa_negativa` −0,3): un hecho vale lo mismo que
el dato equivalente del proveedor, ni más ni menos.

**La puerta de entrada (P6 chica).** En `rankRadar`, la preselección es las `preselect` mejores por puntaje **más** los
símbolos del universo con un hecho `guia` sube verificado en los últimos 90 días (tope 20, los más recientes). Esos
símbolos pasan por el mismo filtro técnico, con su mismo puntaje y su misma convicción; si quedan en COMPRAR, entran a
las filas guardadas aunque el tope de 80 esté lleno (son como mucho 20 más). Un hecho verificado no cambia el puntaje ni
el filtro: **garantiza que la app la mire**. Es la puerta más angosta posible: un solo tipo de hecho, fuente primaria,
90 días, tope 20. FIVE al 17/9 (8-K del 2/9, puesto 412) es el caso.

**Dónde entran los hechos al pipeline.** `RadarDeps.hechos: (symbol) => Promise<HechoExterno[]>` (los vigentes del
símbolo). `rankRadar`, `refreshRadar` y `explorarMercado` se los pasan a `decideCandidate`, así el Radar y el
informe dicen lo mismo.

**Pantallas.** Etiquetas para las banderas nuevas. La ficha del ticker muestra una sección "Hechos externos" con tipo,
fecha, valor, fuente (enlace) y estado. Después de tocarla corre la auditoría de pantalla.

**Tests.**
- Esquema: cada tipo acepta su forma y rechaza una fecha sin formato, una URL vacía, un `direccion` inválido.
- Importador: un archivo con tres hechos (uno con host de sec.gov, uno de un portal, uno sin URL) deja dos filas, una
  `verificado` y una `no_verificado`, y rechaza el tercero con motivo.
- Reglas: `guia` sube verificada → +0,2 y el texto; la misma `no_verificado` → nada; `ganancia_por_reservas` con
  `epsSinReservas` bajo el consenso → −0,3; `oferta_de_compra` con ratio → OBSERVAR y "vale 0,305 acciones de AWK".
- Puerta: un símbolo fuera de la preselección con `guia` sube verificada entra a la evaluación y, si es COMPRAR, a las
  filas guardadas aunque el tope esté lleno; con el hecho `no_verificado`, no.
- Casos reales del 17/9 cargados a mano (`--origen manual`) y verificados con `mercado`: FIVE (guía, 8-K 2/9), PGR y
  RNR y ESNT (reservas, 8-K del 15/7, 22/7 y 7/8), WTRG (oferta, ratio 0,305 AWK), ROKU (oferta, 96 efectivo +
  0,9693 FOXA), AES (oferta, 15,00).

### 4. La skill `/hechos` y el cron semanal

**Skill** `.claude/skills/hechos/SKILL.md`, que corre el dueño a mano o el cron:

1. Corre `radar-cli.ts mercado --preselect 300 --sin-estados --top 300 --salida` (no escribe) y toma las filas que
   pasan el filtro técnico; descarta las que ya tienen un hecho del mismo tipo en los últimos 60 días; se queda con
   hasta 60 símbolos, por puntaje. Con símbolos como argumento (`/hechos FIVE PGR`), solo esos.
2. Lanza agentes en paralelo, de a 10 símbolos, cada uno con búsqueda web y una sola tarea: para cada símbolo, el
   último comunicado de resultados (8-K con exhibit 99) y de ahí (a) si la guía cambió, con las cifras; (b) en
   aseguradoras, reaseguradoras, aseguradoras hipotecarias y bancos, el desarrollo de reservas del trimestre con el
   monto y la ganancia sin él; (c) cualquier DEFM14A, PREM14A, SC 14D9 o 425 vigente, con precio o ratio. Nada de
   opiniones, precios objetivo ni veredictos. Lo que no tiene URL y fecha no se escribe. Lo que no se encontró se
   omite, no se inventa.
3. Junta la salida en un JSON, corre el importador, y deja un registro en `docs/hechos/<fecha>.md`: cuántos símbolos,
   cuántos hechos entraron, cuántos se rechazaron y por qué, y el costo (tokens y búsquedas).

**Cron.** Un agente de launchd `com.thesis-engine.hechos` que corre los **sábados a las 09:00** (mercado cerrado,
antes del ranking del domingo), vía `scripts/launchd/run-hechos.sh`: carga nvm, entra al repo y ejecuta el CLI de
Claude en modo no interactivo con la skill (`claude -p "/hechos"`) y los permisos justos (el CLI del Radar, búsqueda y
lectura web, agentes, escritura del JSON y del registro), con salida a `~/Library/Logs/thesis-engine/hechos.log`. Se
instala con `scripts/launchd/install.sh` como los otros dos, sin `KeepAlive`. Si la máquina está dormida a esa hora,
launchd lo corre al despertar.

**Costo y freno.** Tope de 60 símbolos y 6 agentes por corrida; la primera corrida escribe en el registro cuánto costó.
Subir a diario o agregar tipos de hecho (escisiones, lock-ups) es una decisión aparte, con ese número a la vista.

### 5. Verificación de la salida, no solo del código

Antes de mergear: `pnpm verificar` (tests y tipos de todos los paquetes) y `pnpm test:db` (contra `thesis_test`).

Después de mergear, con el mercado cerrado o fuera de la corrida de las 07:50:

1. reiniciar la API (`launchctl kickstart -k`) para que el código nuevo sea el que corre;
2. `mercado ROKU WTRG AES DV BZH BWMN FIVE PGR RNR ESNT HG`: los seis primeros en OBSERVAR con `bajo_oferta_de_compra`;
3. cargar a mano los hechos del 17/9 (`--origen manual`) y repetir: FIVE con `guia_subida`, PGR/RNR/ESNT/HG con
   `ganancia_por_reservas`, WTRG con "vale 0,305 acciones de AWK";
4. `pnpm consistencia` y la auditoría de las pantallas tocadas;
5. el domingo 20/9 a las 20:00 corre el ranking; el lunes 21/9 el Radar tiene que mostrar las COMPRAR de la
   preselección de 300 hasta 80 filas, FIVE por la puerta, y ninguna empresa bajo oferta en COMPRAR. Se anota en la
   corrida siguiente de `/mercado`: si el informe y el Radar dicen lo mismo, el comando dejó de hacer falta para esos
   casos.

## Fuera de alcance

- **P9** (escisiones: CTVA→VYLR el 1/10) y **P10** (que cada corrida guarde el commit con el que se calculó): quedan
  como propuestas separadas. Ninguna cabe acá sin agrandar el spec.
- **P3** (ETFs fuera de la lista) y **P4** (sector que se da vuelta a 3 meses): pendientes de ayer, sin cambio.
- Ajuste de velas por escisión o por split: no.
- Una regla determinística de "calidad de la ganancia" desde los estados de la SEC: el hecho `ganancia_por_reservas`
  la reemplaza hasta tener una regla medida contra corridas guardadas.
- Cartera (stop de posiciones, tipos de hecho sobre lo que ya tenés): no.
- Subir `maxRows` o la frecuencia del cron: decisiones de cuota, aparte.
