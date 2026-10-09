# Iteraciones de confianza

Registro de los defectos encontrados y arreglados hasta que la app pueda decir, con el dato de hoy y
mostrando el por qué, **qué comprar y qué vender**. Uno por línea, con cómo se comprobó.

Regla de este registro: un defecto no se marca hecho con "el código cambió". Se marca hecho con **la salida
verificada** — un test que falla antes y pasa después, y cuando se puede, la corrida real.

Línea de base (7/10/2026, antes de empezar): `pnpm typecheck` limpio, `pnpm test` 1.334 en verde.
Y con eso, todos los defectos de abajo estaban vivos. Eso es el punto: la suite no mira si la salida dice la verdad.

---

## Iteración 1 — el barrido puede estar truncado y nadie lo ve

Lo más grave, porque envenena todo lo que viene después: si el universo está a medias, el ranking y el plan
salen de medio mercado y **igual se publican como si fueran el mercado entero**.

- [x] **La fase A del barrido no era reanudable.** Corría solo si el barrido estaba vacío (`listed === 0`).
  Dos formas de truncar el universo para siempre sin que nada lo notara: (1) `scanUpsert` escribe por tandas de
  500, así que un corte a medio escribir dejaba filas a medias y la fase A no volvía a correr nunca para ese
  `scanDate`; (2) `assets.snapshots` devolviendo menos símbolos que los elegibles los dejaba **sin fila**, o sea
  afuera del barrido. En los dos casos la fase B drenaba `alpaca_ok` a 0 y el barrido **parecía completo**.
  *Arreglo*: la fase A compara el listado contra las filas ya escritas y completa solo lo que falta, así que al
  terminar hay una fila por símbolo listado, siempre. Los elegibles sin snapshot quedan excluidos **con motivo**.
  *Comprobado*: 2 tests nuevos en `packages/pipeline/test/radar.test.ts`. El segundo fallaba con 2 filas de 14.
  *Archivos*: `packages/pipeline/src/radar.ts`, `packages/pipeline/src/store.ts`, `packages/db/src/repo.ts`
  (método `scanAllSymbols`).

- [x] **Faltaba la puerta que mide el barrido contra algo de afuera.** `pendientes` (los `alpaca_ok`) solo ve una
  fase B cortada. `prefiltrado` no sirve de denominador porque se cuenta de las filas escritas: **el denominador se
  achica junto con el numerador y el cociente da ~1**, así que la puerta `UNIVERSO_MINIMO` no podía frenar nunca un
  barrido incompleto. Un barrido *completo de una lista truncada* pasaba las dos puertas con el cociente perfecto.
  *Arreglo*: `coberturaDelBarrido` compara las filas del barrido contra el listado de Alpaca y exige 99%
  (`COBERTURA_MINIMA`); por debajo, ni `rankRadar` ni `sumarNuevasDelDia` tocan el Radar. Si no se puede preguntar
  el listado, no frena (no inventa un motivo para bloquear).
  *Comprobado*: test con barrido completo de 2 símbolos contra un listado de 14 → antes rankeaba, ahora frena.
  *Archivos*: `packages/pipeline/src/radar.ts`.

- [x] **Un test simulaba un barrido imposible.** `rankRadar solo con el último barrido` escribía filas para 12 de
  los 14 símbolos listados, algo que un barrido real no puede producir. Pasaba igual. Se completó el fixture sin
  tocar la aserción que al test le importaba.
  *Archivos*: `packages/pipeline/test/radar.test.ts`.

**Verificado en la corrida real** (solo lectura, contra Postgres): el barrido vivo es del 4/10 con 14.388 filas
contra 14.391 listados hoy — los 3 de diferencia son listados nuevos de estos días. O sea **hoy el universo está
sano**; lo que estaba roto era la capacidad de darse cuenta si no lo estuviera.

Estado al cerrar la iteración: `pnpm test` 1.338 en verde (1.334 + 4 nuevos), `pnpm typecheck` limpio.

---

## Iteración 2 — `pnpm frenos` comparaba poblaciones distintas

El comando que mide si los frenos cuidan o cuestan estaba restando una sola base —las COMPRAR que ningún freno
tocó— a grupos que no eran esa población. Lo encontré solo porque me pediste que te explicara qué hacía.

- [x] **Un AVISO se comparaba en parte contra sí mismo, y arrastraba filas que nunca fueron comprables.**
  `verificacion_apta/reservas/evitar` no son frenos, son etiquetas de la verificación. Al medirse sobre todos los
  veredictos, el grupo metía OBSERVAR que no iban al plan por otros motivos; y como la etiqueta no es un freno, sus
  propias filas también estaban en la base. Por eso "apta" aparecía peor que la base **midiendo otra cosa**.
  *Arreglo*: los avisos se miden solo entre veredictos COMPRAR y contra una base que excluye esa etiqueta.
- [x] **Las listas de líderes se comparaban contra la base equivocada.** Se miden a propósito sobre todas las filas
  (incluyen `no_perseguir`), pero se les restaba la base de COMPRAR: **ventaja inventada de +4,99 puntos** en la
  corrida real del 7/10.
  *Arreglo*: base propia ("todas las filas sin freno"), y cada grupo ahora dice contra qué base se comparó.
- [x] **Regla uniforme y auditable**: la base de un grupo es su misma población, sin freno y sin la etiqueta del
  grupo. Cada grupo expone `base` y `alfaBase`, y el comando los imprime, así que la resta se puede verificar a mano.
- [x] **Un test codificaba el defecto**: `banco_sin_estados` con una fila OBSERVAR contra base de COMPRAR. Se dejó
  (para los frenos esa comparación es correcta: que el veredicto baje **es** el efecto del freno) y se documentó
  la distinción entre freno y aviso.

*Comprobado*: 3 tests nuevos en `packages/core/src/radar/frenos.test.ts`, los 3 fallaban antes.
*Archivos*: `packages/core/src/radar/frenos.ts`, `apps/api/src/radar-cli.ts`.

**Lo que cambió en la medición real (7 días, filas del 7 al 29/9), ya corregida:**

| Grupo | Antes | Ahora | Símbolos | ¿Ruido? |
|---|---|---|---|---|
| `verificación apta` | −1,08 | **−1,53** | 21 | no |
| `con reservas` | −0,28 | **+0,71** | 60 | no |
| `con reservas, solo del agente` | +1,00 | **+1,51** | 41 | no |
| `dice evitar` | −1,37 | **sin datos** (0 filas) | 0 | — |
| `líder en retroceso` | +4,99 | +5,3 | 8 | **sí** |
| `consenso_en_precio` | −1,49 | −1,49 | 32 | no |

- `dice evitar` queda en 0 filas: **ninguna fila "evitar" llega a COMPRAR**, o sea ese aviso bloquea del todo. El
  −8,51% que se reportaba venía de una fila OBSERVAR que nunca era comprable.
- **PENDIENTE DE DECISIÓN, con la evidencia arriba**: la señal de verificación corre **al revés** entre las COMPRAR
  ("apta" −1,53, "con reservas" +0,71/+1,51), y las dos puntas están arriba de la barra de ruido. El 25/9 se mergeó
  que *una reserva por "falta verificar" resta la mitad de convicción*: esa regla penaliza al grupo que rindió mejor.
  No la toco todavía porque la única ventana disponible es 7 días sobre un mes, y toda la muestra pierde contra el
  S&P. Se decide con los 30 días, que recién maduran ahora.

Estado al cerrar la iteración: `pnpm test` 1.341 en verde, `pnpm typecheck` limpio.

---

## Iteración 3 — dos pantallas, dos niveles de salida para la misma posición

Esta es la peor de todas para la confianza, porque afecta **vender**, que es la mitad del objetivo.

Cómo apareció: dejé de adivinar y corrí el chequeo de consistencia contra la base real. Dio 0 graves y 16 avisos.
Dos de esos avisos los miré de cerca.

- [x] **`verificacion_desfasada` avisaba de lo normal (falso positivo).** FIVE tenía una verificación guardada
  "con_reservas" del 23/9 y la fila mostraba "ninguna". Es **correcto**: una verificación vale 7 días y esa tenía 14.
  El chequeo comparaba la fila contra la última guardada **sin mirar vencimiento**, así que toda fila con la
  verificación vencida salía como contradicción. Un chequeo que avisa de lo normal se vuelve ruido y tapa a los que
  importan.
  *Arreglo*: la regla solo corre si la guardada todavía vale. Sin `today` no se puede juzgar y se reporta igual
  (preferir ruido antes que callar una contradicción real). `VERIFY_FRESH_DAYS` se movió de pipeline a core, que es
  donde vive el chequeo, y pipeline la reexporta: una sola fuente para la vigencia.
  *Comprobado*: 2 tests nuevos; en la corrida real los avisos bajaron de 16 a 15 y FIVE desapareció.
  *Archivos*: `packages/core/src/radar/consistency.ts`, `packages/core/src/radar/candidate.ts`,
  `packages/pipeline/src/radar-verify.ts`.

- [x] **Una sospecha mía que era infundada, y lo digo**: pensé que el objetivo de analistas fuera de escala (APH:
  mediano 190 contra precio 88,62, split sin ajustar) envenenaba el freno `consenso_en_precio`. Falso:
  `consensusTargetOf` ya descarta el objetivo fuera de la banda `CONSENSUS_SCALE` y cae al consenso de la
  verificación web, que sí está ajustado. Estaba cubierto desde el 13/9.

- [x] **EL GRAVE: el trinquete del stop estaba en Cartera y no en el Radar.** El 6/10 se arregló que el stop de
  seguimiento de una posición no baje (`computeTrailingStop` es una ventana móvil de 22 velas: cuando un máximo sale
  de la ventana, el stop baja sin que el precio haga nada; medido, bajaba en 236 de 512 transiciones, 46,1%). Pero el
  trinquete se puso en el veredicto de Cartera y **no** en la fila del Radar, que seguía usando la ventana cruda.
  Resultado en la base real del 7/10: **GGAL con stop 41,34 en el Radar y 41,53 en Cartera, estando en VENDER.**
  VIST, YPF y PAM coincidían solo porque su ventana todavía no había bajado.
  *Arreglo*: `decideCandidate` recibe `prevStop` y, solo para lo que está en cartera, aplica `ratchetStop` — la
  misma función y la misma fuente (`latestVerdicts`) que usa Cartera, así los dos números no pueden diferir. Para una
  compra nueva no cambia nada: ahí la ventana de hoy es justamente lo que se quiere saber.
  *Comprobado*: 2 tests nuevos en `candidate.test.ts` (incluido que una compra nueva nunca hereda el trinquete de
  nadie) + la corrida real.
  *Archivos*: `packages/core/src/radar/candidate.ts`, `packages/pipeline/src/radar.ts`.

- [x] **Y la regla que faltaba para que no vuelva callado**: `stop_en_desacuerdo`, grave, compara el stop de la fila
  del Radar contra el de Cartera para toda posición. Ningún chequeo miraba eso, y por eso el defecto de arriba vivió
  un día entero con 0 graves en el tablero.
  *Comprobado*: con el código ya arreglado pero la base todavía vieja, el chequeo pasó a **1 grave** y nombró a GGAL
  con los dos números. Es la prueba de que la regla agarra el caso real, no solo el de laboratorio.
  *Archivos*: `packages/core/src/radar/consistency.ts`, `packages/pipeline/src/consistency.ts`.

Estado al cerrar la iteración: `pnpm test` 1.347 en verde, `pnpm typecheck` limpio.

---

## Iteración 4 — el arreglo de la iteración 3 no alcanzaba, y la corrida real lo demostró

Esto es lo que me reclamaste y acá está crudo: en la iteración 3 los tests pasaban, el typecheck estaba limpio, y
**la salida seguía mintiendo**. Lo supe solo porque corrí el refresco real y volví a mirar.

- [x] **Las ADR y los ETF pasan por `decideEtf`, que no toqué.** `decideCandidate` (acciones) ya llevaba el trinquete,
  pero GGAL es `kind=adr` y su fila la escribe `refreshArgentina` → `decideAdr` → `decideEtf`, que calculaba la
  ventana cruda. Después del refresco completo, GGAL **seguía** con 41,34 en el Radar contra 41,53 en Cartera.
  *Arreglo*: `decideEtf` recibe `prevStop` y aplica el trinquete solo cuando `newEntry === false`, o sea cuando el
  símbolo ya es una posición. Cableado en el camino de las ADR y en los dos de los ETF.
  *Comprobado*: 3 tests nuevos en `etf.test.ts` + `pnpm radar:argentina` real.
  *Archivos*: `packages/core/src/radar/etf.ts`, `packages/core/src/radar/argentina.ts`,
  `packages/pipeline/src/argentina.ts`, `packages/pipeline/src/radar.ts`.

- [x] **Y entonces apareció el mismo defecto con el signo al revés.** Con GGAL arreglado, el chequeo marcó TSM:
  456,51 en el Radar contra 456,27 en Cartera. No era un error de regla sino **de momento**: cada pantalla anclaba su
  trinquete solo a su propia fuente, así que la que corría última quedaba más arriba y los dos números no coincidían
  nunca.
  *Arreglo*: `stopsPrevios` ancla al **máximo entre el veredicto de Cartera y la fila del Radar**, y las dos pantallas
  usan el mismo helper. Así convergen sin importar el orden de las corridas, y el trinquete sigue siendo monótono.
  `latestCandidates` se declaró opcional en `CarteraStore` en vez de confiar en que exista en runtime.
  *Archivos*: `packages/pipeline/src/radar.ts`, `packages/pipeline/src/cartera.ts`, `packages/pipeline/src/store.ts`.

- [x] **El chequeo ahora distingue la dirección, porque las dos no son igual de graves.**
  - Radar **por debajo** de Cartera → **grave**: la pantalla muestra una salida más baja que la real y te hace
    aguantar la posición más de lo que corresponde. Bajo un trinquete correcto no puede pasar.
  - Radar **por encima** → **aviso**: Cartera está atrasada y se iguala cuando corra. No es un error de regla, pero
    no puede quedar callado mientras haya dos números a la vista.
  *Archivos*: `packages/core/src/radar/consistency.ts` + 2 tests.

- [x] **Un detalle de método que casi me hace cantar victoria en falso**: el primer `POST /cartera/run` después del
  arreglo devolvió los números viejos porque **la API estaba corriendo el código anterior** (el proceso había
  arrancado antes de mis ediciones). Reiniciada con `launchctl kickstart`, recién ahí el arreglo se aplicó.

**Verificación final de la iteración, contra la base real:**
- `pnpm radar:argentina` y `POST /cartera/run` con el código nuevo → TSM quedó en 456,51 en las dos pantallas;
  HUT pasó de 88,97 a 89,17 y PAM de 81,54 a 81,55, los dos tomando el máximo correcto.
- `pnpm consistencia`: **0 graves y 15 avisos** sobre 184 filas, sin ningún `stop_en_desacuerdo`.
- `pnpm test` 1.351 en verde, `pnpm typecheck` limpio.

---

## Iteración 5 — auditar la salida, no el código

Las dos herramientas de la app (`pnpm consistencia`, `pnpm auditar`) dieron limpio: 0 graves, 15 avisos, "las
pantallas no se contradicen". Eso no alcanza, porque solo chequean lo que saben chequear. Así que miré la salida.

**Lo que resultó estar BIEN, y lo digo porque sospeché de las tres:**
- *El stop del trinquete no sostiene ninguna ancla vieja.* Contrasté los 8 stops mostrados contra las velas: en todos,
  el valor mostrado está a centavos de la ventana de hoy y el máximo de 22 ruedas está muy por encima. O sea cada
  stop se puede derivar del gráfico. Los VENDER son quiebres reales: GGAL de 45,72 a 37,05; MARA de 13,98 a 10,36;
  VIST de 79,77 a 65,43.
- *`totalUsd 40000` no es un error de escala.* Es un plan de 6 aportes pedido explícitamente, y el propio plan lo dice
  y lo parte en 3 tramos de ~13.333.
- *El objetivo de analistas fuera de escala de APH* ya estaba neutralizado desde el 13/9 (ver iteración 3).

**Lo que es diseño tuyo y NO toqué:**
- `reviewsPending: ["MUSA"]` con MUSA en el plan y USD 3.822 asignados. `reviewCaution` dice explícitamente "nunca
  frena": es tu decisión del 18/9 (la IA avisa en vez de bloquear; solo frena "evitar"). No la reverti sin tu palabra.
  **Pero queda el dato**: de las tres revisiones que sí corrieron, **las tres encontraron objeción** (TD Cowen bajó el
  objetivo de SEZL; la OIR de Florida aprobó bajas de tarifa que pegan en HCI; California promulgó la AB 1795 que pega
  en MCY). Una revisión pendiente no es "probablemente limpia", y MUSA es la única línea con plata cuyo control no corrió.

**El defecto que sí encontré:**

- [x] **Un CEO nuevo no producía ninguna bandera.** El patrón `gestion` de `EVENT_PATTERNS` solo reconocía **salidas**
  (`resigns|steps down|departs|exits`). Una sucesión anunciada como **nombramiento** —que es la forma normal de una
  transición planificada— no matcheaba nada. Eso explica lo que marcaste el 5/10: DHR y AAPL con riesgo 2/10 "sin
  banderas" teniendo CEO nuevo. Un cambio de mando es exactamente lo que invalida una tesis armada sobre la gestión
  anterior.
  *Arreglo*: el patrón reconoce nombramientos, sucesiones, interinatos y el español, en los dos órdenes (cargo→verbo y
  verbo→cargo), exigiendo que el cargo **y** un verbo de cambio estén en el titular para no marcar "el CEO dice que la
  demanda sigue fuerte".
  *Comprobado, contra las noticias ya guardadas de los 184 símbolos del Radar*: el patrón viejo agarraba **1** titular
  de gestión; el nuevo agarra **12 más**. Entre ellos:
  - **USAR** (está en tu watchlist): *"USA Rare Earth Appoints Thras Moraitis As CEO, Replacing Barbara Humpton,
    Effective October 1"* — CEO nuevo hace 6 días, sin bandera.
  - **CTS**: *"Appoints COO Pratik Trivedi As President And CEO"*.
  - **KLIC**: *"Appoints Dr. Raj Talluri as President and CEO"*.
  - **ALL**: *"Appoints Chris Lown As CFO"*.
  *Archivos*: `packages/core/src/radar/news.ts` + 2 tests en `news.test.ts`.
  *Límite honesto*: 4 de los 12 titulares hablan de **otra** empresa mencionada en el titular (AMZN con Boston
  Dynamics y Pinterest; CPA con Republic Airways). Eso es atribución del proveedor de noticias, no del patrón, y el
  prefiltro es amplio a propósito: el clasificador separa grave / moderado / ruido. Queda anotado, no arreglado.

Estado al cerrar la iteración: `pnpm test` 1.353 en verde, `pnpm typecheck` limpio.

---

## Iteración 6 — validación final y el número que hay que decir

**Validación de todo junto** (7/10/2026, con la API reiniciada y el código final):
- `pnpm test`: **1.353 en verde** (base 1.334 + 19 tests nuevos), `pnpm typecheck` limpio.
- `pnpm consistencia`: **0 graves y 15 avisos** sobre 184 filas; precio vivo 66 de 66 con hub y testigo.
- `pnpm auditar`: "las pantallas no se contradicen entre sí".
- Los 15 avisos que quedan son todos de proveedor y ya están neutralizados en la fila: dividendos en otra moneda
  (ARS, TWD, KZT), dividendos donde el proveedor se contradice solo, objetivos de analistas sin ajustar por split, y
  un patrimonio cercano a cero (CCSI). Ninguno decide nada.

**El dato que importa más que todos los arreglos de arriba.** `pnpm frenos 30` sobre la única cohorte que ya maduró
a 30 días (las filas del 7/9, 33 símbolos distintos, o sea por encima de la barra de ruido):

> **Las COMPRAR que ningún freno tocó rindieron −8,23% contra el S&P, y solo el 21% le ganó al índice.**

Qué significa y qué no:
- Es **una sola cohorte**, un solo día de candidatas. Un draw, no una serie.
- Los grupos de frenos salen vacíos a 30 días porque **los frenos no existían el 7/9**: casi todos se agregaron entre
  el 10 y el 17/9. O sea esta medición no dice nada sobre los frenos, solo sobre el acierto base del Radar.
- A 7 días, con 460 filas de 111 símbolos, la base es −0,73% con 45% de acierto: mal, pero no −8%.
- **1.300 filas siguen sin medir a 30 días**, simplemente porque la ventana no se cumplió todavía. La app arrancó a
  medir el 7/9: hoy hay exactamente una cohorte madura.

Conclusión honesta del estado: las pantallas ahora **no se contradicen** y cada número se puede derivar de su fuente.
Eso es lo que estos arreglos compraron. Lo que **no** está demostrado es que las COMPRAR del Radar ganen plata: la
única evidencia fuera de muestra que existe apunta en contra, y hacen falta más cohortes maduras para saber si fue
el mercado de septiembre o es el método.

---

## Pendiente, con la evidencia que ya hay

1. **La señal de verificación corre al revés** (iteración 2): "apta" −1,53 puntos, "con reservas" +0,71 / +1,51, las
   dos puntas arriba de la barra de ruido. La regla del 25/9 (una reserva por "falta verificar" resta la mitad de
   convicción) penaliza al grupo que rindió mejor. **Se decide con 30 días, no antes.**
2. **Revisión pendiente que no frena** (iteración 5): es tu decisión del 18/9 y no la toqué, pero 3 de 3 revisiones
   que corrieron encontraron objeción. MUSA está en el plan con USD 3.822 y su control no corrió.
3. **Atribución de noticias** (iteración 5): 4 de los 12 titulares de gestión nuevos hablan de otra empresa
   mencionada en el titular (AMZN con Boston Dynamics y Pinterest; CPA con Republic Airways). Es del proveedor.
4. **Las noticias ya guardadas no se reclasifican**: el patrón de CEO arreglado agarra 12 titulares que están en la
   base, pero las banderas se producen al clasificar. **USAR cambió de CEO el 1/10 y está en la watchlist sin bandera.**

---

## Iteración 7 — los temas pasados por las reglas de la app

La pregunta era qué hacer con el barrido de tendencias. La respuesta correcta no era agregarlos a mano a ningún
lado: era **pasarlos por las reglas de la app**, que es lo único que decide. `radar-cli mercado SÍMBOLOS…` sin
`--guardar` evalúa cualquier lista con las mismas reglas del Radar y no toca el plan ni la watchlist.

24 símbolos elegidos para tapar los agujeros del informe temático (plata, red eléctrica, óptica, herramientas de
HBM, municiones, bancos japoneses, inyectables, nuclear con ingreso). Universo del barrido: 2.659 con fundamentales,
2.551 rankeadas. **Pasan 15, descartadas 9.**

**Lo que la app compraría (6 de 24):**

| Símbolo | Score | Tema | Banderas |
|---|---|---|---|
| KLAC | 0,657 | metrología de HBM | insiders_venden, consenso_compra |
| NVT | 0,350 | red eléctrica | — |
| WST | 0,280 | inyectables GLP-1 · **riesgo 1/10**, el más bajo del set | — |
| COHR | 0,104 | óptica de datacenter | sin_estados, subio_mucho_12m |
| ETN | 0,057 | red eléctrica | — |
| ONTO | −0,551 | inspección de HBM | subio_mucho_12m |

**Lo que la app RECHAZA, y contradice mi informe:**
- **La plata entera**: PAAS, AG y HL quedan afuera por `bajo_sma200`; WPM por `bajo_stop`. Yo había escrito que era
  "el agujero más grande de tu app". El metal se movió y las mineras no lo acompañaron, o ya corrigieron: a precio de
  hoy no son comprables con tus reglas.
- **La mitad de la red eléctrica**: HUBB y POWL por `bajo_sma200`; PWR en OBSERVAR con el stop dentro de la entrada.
  De mi tema "más fuerte" solo sobreviven ETN y NVT.
- **Nuclear con ingreso**: LEU y BWXT por `bajo_sma200`. Eran justo las dos que yo prefería del tema.
- **Municiones**: OLN por `bajo_sma200`.
- **Bancos japoneses**: MUFG y SMFG caen por `banco_sin_estados`, la regla que salió del caso NBN. La app no puede
  leer sus estados, así que no los compra. La regla funcionó exactamente como está escrita.

**Lo importante de esto**: no hace falta meter ninguno a mano. Los 2.551 símbolos **ya estaban rankeados** — estos 24
simplemente no habían entrado al corte de 184 filas del Radar. KLAC con score 0,657 queda apenas por debajo de MUSA
(0,6914), que es la última línea del plan. O sea la app ya los había considerado y los puso en la cola. Forzarlos por
la watchlist sería reemplazar su ranking por mi relato, que es lo contrario de lo que corresponde.

**El único hueco real que dejó el barrido temático**: `HECHO_TIPOS` solo admite eventos **de una empresa** (guía,
reservas, extraordinarios, oferta de compra, investigación regulatoria, evento de capital). No hay tipo para un
**hecho de sector**, y por eso ninguno de estos entra a la app por ningún lado:
- tarifas de reaseguro de catástrofe −14,7% en enero y otro −16% hasta julio (pega en RNR, que está en tu watchlist);
- la Corte Suprema tumbó los aranceles IEEPA el 20/2 con hasta 175.000 M en reintegros (pega en importadores: HAS,
  CROX, FIVE están en el Radar);
- exceso de gas a 2027 con Henry Hub recortado a 3,25 (pega en productores y favorece a generadoras);
- fertilizante +35% contra granos −15% (pega en AGRO.BA y CRESY, las dos en el Radar);
- vencimientos con fecha: controles chinos de tierras raras el **10/11** y medio término el **3/11**.

Eso es lo que valdría construir, y es una decisión tuya porque toca la ruta de decisión: un `hecho de sector` con
fuente primaria, ventana de vigencia y una lista de símbolos afectados, que produzca salvedad —no freno— igual que
los hechos de empresa. No lo hice sin tu palabra.

**Y una tesis que no se puede romper porque no existe**: RNR está en la watchlist desde el 18/9 con `entryAction`
"manual", sin stop, sin objetivo y **con la tesis vacía**. Lo mismo MP, SQM y USAR. Es el pendiente "B6 tesis" de tu
auditoría del 15/9, todavía abierto. Mi afirmación de ayer de que "la tesis de RNR está dada vuelta" estaba mal: no
hay tesis escrita que dar vuelta.

---

## Iteración 8 — una simulación, y por qué el ranking NO se puede backtestear

Antes de ensanchar nada había que entender el −8,23%. Lo primero que encontré es una limitación de la base que hay
que decir en voz alta: **las fundamentales se guardan "de hoy"**, una fila por símbolo sin versión por fecha. Así que
cualquier backtest del ranking rankearía 2025 con los balances de 2026, o sea mirando el futuro. **El ranking de la
app no se puede backtestear.** Lo que SÍ es punto en el tiempo son las velas.

- [x] **Comando nuevo `pnpm simular [ruedas]`** (`packages/core/src/radar/simulacion.ts`, puro, 6 tests). Mide, solo
  con precios, si las condiciones del motor separan ganadores de perdedores: alfa a N ruedas contra el S&P, agrupado
  por compuerta técnica, régimen de tasas (calculado con la serie del 10 años **recortada a cada fecha**, nunca con el
  futuro), tramo de capitalización y tramos de retorno. Dice "POCOS SÍMBOLOS: es ruido" abajo de 20 símbolos distintos.
  *Corrida real*: 38.710 observaciones, 745 símbolos, 256 fechas del 24/7/2025 al 25/8/2026.
  *Archivos*: `packages/core/src/radar/simulacion.ts`, `.test.ts`, `apps/api/src/radar-cli.ts`,
  `packages/pipeline/src/store.ts`, `packages/db/src/repo.ts` (`symbolsConVelas`, `mcapsPorSimbolo`).

**Diagnóstico del −8,23%.** La cohorte del 7/9 (54 filas) promedió −6,79% de alfa con 13 positivas, mientras el S&P
subía 1,71% (765,96 → 779,09). O sea cayó ~5,1% en absoluto con el índice en alza. El gradiente por tamaño era
monótono (−8,63% abajo de 2.000 M, −4,85% arriba de 50.000 M) y parecía un shock de tasas por tamaño.
**La simulación lo refutó**: en los 13 meses, las chicas rindieron MEJOR (+1,68% contra −0,29% del tramo de 10 a
50 mil millones). El gradiente de la cohorte era un artefacto de un mes.

**Y el ranking es ciego al régimen**: `ranking.ts` no usa `MacroRegime` en ningún lado, el peso de valuación es 0,35
fijo, y el régimen solo produce una salvedad en `conviction.ts` para sectores {Inmobiliario, Servicios públicos} y el
tema {oro_mineria}. El comentario dice "Financiero no: gana con tasas", pero en la cohorte HSBC cayó 13,4%, ALL 14,6%
y LNC 10,7%.

**Lo que midió la compuerta técnica** (agregado): pasa +0,59% contra no pasa +1,38% → **la compuerta resta 0,79
puntos**. Y el umbral de `no_perseguir` (15% en 21 ruedas) está justo en el fondo de una **U**:

| Retorno 21 ruedas | Alfa | Símbolos |
|---|---|---|
| cayó más de 10% | +3,48% | 658 |
| −10% a 0% | +0,42% | 745 |
| 0% a 10% | +0,19% | 745 |
| **10% a 15%** (se permite) | **+0,15%** | 707 |
| **15% a 25%** (se frena) | **+1,26%** | 620 |
| **25% a 40%** (se frena) | **+2,76%** | 381 |
| **más de 40%** (se frena) | **+5,47%** | 200 |

**El sesgo que me frenó.** Los 773 símbolos con velas son los que llegaron hasta hoy: una acción bajo su media de 200
que todavía tiene velas es, por definición, una que se recuperó. Control: el alfa de TODAS las observaciones es
+0,95%, cuando en una muestra sin sesgo la acción promedio debería estar en cero o levemente negativa contra el
índice. **La muestra está inflada ~1 punto, y sobre todo en los grupos de caídos.** Por eso NO toqué `bajo_sma200`,
aunque es el número más grande del estudio (+2,08% en restrictivo, +4,12% más de 20% abajo): el sesgo apunta
exactamente en la dirección del hallazgo. Lo que lo resolvería es guardar fundamentales con versión por fecha y un
universo que incluya a los que desaparecieron. Queda anotado, no hecho.

---

## Iteración 9 — el cruce que me salvó de un error serio

Estuve a punto de aflojar los frenos de momento con el agregado. Antes hice el cruce por régimen, y da vuelta todo:

| Grupo | Restrictivo (el de HOY) | Neutral |
|---|---|---|
| 21 ruedas 0-15% (se permite) | −1,09% | +0,31% |
| 21 ruedas >15% (se frena) | −0,95% | **+2,94%** |
| 12 meses 0-100% (se permite) | −0,20% | +0,74% |
| **12 meses >100% (se frena)** | **−1,77%** | **+2,66%** |
| **media 200 >25% arriba** | **−2,36%** (acierto 40%) | **+2,84%** |

El "el momento funciona" venía **entero** del régimen neutral: 30.515 de 38.710 observaciones. **Con tasas altas o
subiendo, los frenos de momento están acertando.** Si hubiera cambiado los umbrales con el agregado, el plan de
mañana habría empujado nombres extendidos justo el día en que la medición dice que son el peor grupo.

- [x] **`no_perseguir` ahora depende del régimen.** Techo angosto (15%) con tasas altas o subiendo; ancho (40%) en
  neutral o expansivo. **Sin régimen conocido se usa el angosto**: no se afloja una regla por no saber.
  *Archivos*: `packages/core/src/radar/candidate.ts` (`MAX_RETORNO_21D_NEUTRAL`), `packages/pipeline/src/radar.ts`
  (`regimenDeLaCorrida`, que lee ^TNX de lo guardado para no gastar un pedido). 4 tests.
- [x] **`subio_mucho_12m` frena solo en restrictivo.** En neutral la bandera sigue puesta y avisa, pero no deja la
  candidata afuera del plan — la misma forma que aprobaste el 18/9 para la IA. Sin régimen conocido, frena.
  *Archivos*: `packages/core/src/radar/plan.ts` (`BLOCKERS_SOLO_RESTRICTIVO`, `blockersVigentes`). 3 tests.
- **Efecto en el plan de mañana: NINGUNO.** Hoy el régimen es restrictivo (10 años 5,28%, +74 pb en 3 meses), así que
  los dos frenos siguen aplicando igual. El cambio paga cuando el régimen gire, y entonces paga 1,9 a 2,6 puntos.

---

## Iteración 10 — el espectro, ensanchado donde no cuesta calidad

Medí dónde se pierde el universo antes de aflojar nada. De 14.391 listados: 6.000+ son fondos y ETF, ~900 no
operables, ~1.300 warrants, units, preferidas y derechos, 309 OTC. La barra de calidad saca 1.607 por precio abajo de
5, 1.259 por volumen y **solo 229 por capitalización**. O sea la barra de calidad **no es el cuello**.

El cuello era `preselect: 300`: de 2.551 rankeadas, solo 300 recibían estados, velas y evaluación completa. La 350ª
nunca se miraba.

- [x] **Medido antes de cambiar**, mismo universo y mismo día, con `radar-cli mercado`:

  | | Filas | COMPRAR | Score mediana |
  |---|---|---|---|
  | preselect 300 / top 40 | 40 | 25 | 1,002 |
  | preselect 900 / top 120 | 120 | **64** | 0,777 |

  **Estrictamente aditivo: no se perdió ninguna COMPRAR** y aparecieron 39, entre ellas KLAC (la que había señalado
  el barrido temático), RNR, TEL, LLY, VRSN, DLO, CPA.

- [x] **Distinción que importa para la cuota**: `preselect` gasta pedidos de Finnhub y EDGAR; **la ficha del modelo
  solo se escribe para las filas que quedan** (`top`/`maxRows`), y una vez por símbolo, porque después persiste. Por
  eso la preselección se duplica y el tope se mueve con cuidado.
  *Cambio*: `preselect` 300 → **600**, `top` 40 → **50**, `maxRows` 80 → **110**.
- [x] **El guardián se actualizó, no se borró.** `policy-real.test.ts` fijaba 40 y 80 con el motivo "cada fila más es
  una ficha del modelo". Ahora fija 600/50/110 con la medición que lo justifica y conserva la advertencia: cada
  símbolo nuevo necesita su ficha, y con la cuota agotada la fila entra sin que el narrador la haya podido degradar.
  *Archivos*: `config/radar-policy.json`, `packages/core/src/radar/policy-real.test.ts`, `apps/api/src/config.test.ts`.

---

## Iteración 11 — el canal que faltaba: hechos de sector

Era el hueco real que había dejado el barrido temático: `HECHO_TIPOS` solo admitía eventos de UNA empresa, así que lo
que mueve una cartera entera no tenía por dónde entrar.

- [x] **Tipo `sector`**, con `ambito`, `titulo`, `detalle` y **`sesgo`** (a favor / en contra), ventana de 180 días.
  Se carga **una fila por símbolo afectado**, con el mismo texto y la misma fuente: repetitivo a propósito, para
  reusar el importador, la vigencia, la verificación por fuente primaria y la auditoría que ya existen, sin tabla
  nueva ni ruta de decisión nueva. `sesgo` existe porque el mismo hecho va para los dos lados según el símbolo.
  **No frena**: produce salvedad que resta convicción (0,3, lo mismo que una salvedad de empresa). Un hecho a favor
  **no suma** convicción: informa, porque sumar por contexto sería pagar dos veces el mismo relato.
  *Archivos*: `packages/core/src/radar/hechos.ts`, `conviction.ts` + 4 tests.

- [x] **Cargados 7 hechos, los 7 verificados con fuente primaria** que fui a buscar y a confirmar una por una. No
  cargué nada con un link que no hubiera abierto:
  - **USDA ERS, Farm Sector Income Forecast del 3/9/2026**: el gasto en fertilizante, cal y acondicionadores sube
    5.300 millones (+15,3%) a 39.600 millones; el ingreso neto agropecuario 2026 queda en 158.400 millones, −4.300
    millones (−2,6%) nominal y −9.100 millones (**−5,5% real**). → **AGRO.BA** y **CRESY** en contra, **CF** a favor.
  - **EIA, Short-Term Energy Outlook de octubre 2026**: Henry Hub 3,48 en 2026 y **3,16 en 2027**; producción seca de
    112,20 a 116,13 Bcf/d contra exportaciones de GNL de 17,6 a 18,6 Bcf/d, o sea la oferta crece más rápido que la
    demanda de exportación. → **VST** a favor (combustible más barato para quien quema gas).
    *Corrección de lo que te dije antes*: el 3,25 que mencioné era de una firma privada; el dato primario es **3,16**.
  - **Orden Ejecutiva 14389, "Ending Certain Tariff Actions", firmada el 20/2/2026** (GPO): termina los derechos ad
    valorem adicionales bajo IEEPA de nueve órdenes previas, y dice explícitamente que **no afecta la sección 232 ni
    la 301**. → **HAS**, **CROX** y **FIVE** a favor, con ese límite escrito en el detalle.
- [x] Se agregaron `govinfo.gov`, `eia.gov` y `usda.gov` a `hostsPrimarios`: son editores oficiales del gobierno de
  EE.UU., del mismo carácter que `sec.gov` o `federalregister.gov`.
  *Archivos*: `config/hechos-fuentes.json`, `docs/hechos/2026-10-07-sector.json`.

---

## Iteración 12 — ensanchar destapó un fondo cerrado en el plan

Al correr el ranking con `preselect: 600`, **BSTZ entró al plan con USD 3.132 asignados**. BSTZ es
*"BlackRock Science and Technology Term Trust"*: un **fondo cerrado**, rankeado con métricas de empresa.

Por qué tenía score 1,304, de los más altos: quedó **1° de un grupo de 15 pares donde los 15 no tienen industria**.
Ser primero de un grupo de cosas sin clasificar no significa nada.

Por qué el filtro de nombre no lo agarró: el comentario de `FUND_LIKE` dice, a propósito, que los REITs ("… Trust")
sí son empresas, así que "Trust" se dejó pasar. Y meter nombres de patrocinadores habría sido peor: "Franklin
Electric" y "Morgan Stanley" son empresas reales.

- [x] **Guarda estructural, no heurística de nombre**: el método de esta app es comparar contra PARES de la misma
  industria; **sin industria usable no hay comparación, así que no pasa la barra de calidad**. Es el mismo principio
  que ya declaraba el encabezado del módulo ("Fail-closed: sin dato, no pasa"), y agarra fondos cerrados, cascarones
  y cualquier cosa que el proveedor no clasifique. En el universo había 27 símbolos con industria `N/A`.
  *Comprobado*: 3 tests nuevos; y en la base, BSTZ quedó excluido con el motivo escrito.
  *Archivos*: `packages/core/src/radar/universe.ts`, `universe.test.ts`.

- [x] **Y un segundo defecto que apareció al arreglar el primero**: un símbolo que sale del universo **conservaba su
  fila**. `refreshRadar` solo anotaba "sin fundamentals" y seguía de largo, así que BSTZ seguía como COMPRAR con el
  veredicto de la corrida anterior. `pruneFamilias` no cubre este caso porque corre en `rankRadar`.
  *Arreglo*: `borrarCandidatas(fecha, símbolos)` — un borrado **puntual, por símbolo nombrado**. Explícitamente NO
  una poda por "lo que no se reescribió": si lo que falla son las VELAS la fila se conserva, porque una caída del
  proveedor (23/9, Yahoo) borraría el Radar entero.
  *Comprobado*: 2 tests, uno por cada lado de esa distinción. Y en la corrida real BSTZ no aparece en las filas del
  8/10.
  *Archivos*: `packages/pipeline/src/radar.ts`, `store.ts`, `packages/db/src/repo.ts`, `test/radar.test.ts`.

**Calibración final del tope, medida contra la corrida real** (no con `--sin-estados`, que infla):
`preselect` 600, `top` **40** (se probó 50 y se volvió: las 10 filas extra por puntaje eran casi todas NO
comprables, a una ficha del modelo cada una), `maxRows` **110** (mínimo 102 para no perder ninguna COMPRAR).
Resultado: **111 filas de acciones con 74 COMPRAR**, contra 80 y 52 el 6/10.

---

## Iteración 13 — correr la verificación y la revisión, que es lo que faltaba para poder comprar

El plan quedaba con **las cinco líneas de riesgo sin revisión previa y dos sin verificación**, porque es un día
nuevo y el cron de las 08:15 no había corrido. Ayer 3 de 3 revisiones encontraron objeción, así que ejecutar sin eso
era saltearse el control. Lo corrí con el mismo cuestionario del agente.

- [x] **Verificación de MMSI → apto.** 2T26 del 30/7: ventas 418,8 M y EPS ajustada 1,19 contra consenso 0,96. Tiene
  un **reintegro de aranceles de 6,9 M** dentro del costo de ventas (unos 0,09 por acción después de impuestos):
  **sin eso la EPS es 1,10, que sigue arriba del consenso**, así que la sorpresa sobrevive. Guía 2026 subida en las
  dos puntas. Verifiqué en EDGAR que **no hubo emisión de acciones** desde el 1/7. Lo regulatorio son retiros clase 2
  de la FDA publicados el 16/1/2026, fuera de la ventana. Consenso de objetivo 100,00. Próximos resultados 29/10.
  *Nota*: ese reintegro es la Orden Ejecutiva 14389 apareciendo en resultados reales — el mismo hecho de sector que
  cargué en la iteración 11.
- [x] **Verificación de EME → con reservas**, por la moratoria de Nueva York (abajo).
- [x] **Revisiones: 3 de 5 con objeción.**
  - **HCI**: el **22/9** la OIR de Florida aprobó bajas de tarifa de hogar sobre más de 62.000 pólizas y el
    comisionado anticipó recortes más agresivos hacia 2027. Se suma a lo que su propia verificación ya marcaba: prima
    media por póliza plana con el ratio de siniestros subiendo.
  - **MCY**: el **15/9** California promulgó la **AB 1795**, que presume que el daño por humo en zona de incendio
    viene del incendio, obliga a pagar testeos y prohíbe cortar los gastos de vivienda temporal hasta que la casa sea
    habitable. Costo de siniestros más alto y más largo, sobre 75 M de catástrofes netas en el 2T26.
  - **EME**: **Orden Ejecutiva 62 de Nueva York**, verificada en la página del gobernador: pausa **hasta un año** los
    permisos ambientales a datacenters de hiperescala, y la DEC no emite permisos discrecionales que no estén ya
    completos. La cartera récord de EME (17.140 M, +43,9%) viene de ese mercado.
  - **MMSI** y **CTS**: sin objeciones. En CTS el cambio de CEO (6/7, promoción interna de Pratik Trivedi, con
    O'Sullivan quedando como presidente ejecutivo) queda fuera de la ventana de 30 días y la guía se subió el 28/7;
    lo de septiembre es Barrington iniciando cobertura con objetivo 80 y Sidoti recortando un centavo el 3T.
- [x] **Tres hechos de sector más**, con la moratoria de Nueva York verificada en `governor.ny.gov` (host agregado a
  `hostsPrimarios`): **EME**, **VRT** y **CRWV** en contra.
  *Archivos*: `docs/hechos/agente-2026-10-08.json`, `docs/hechos/2026-10-08-sector-datacenters.json`,
  `config/hechos-fuentes.json`.

**Resultado**: el plan quedó con **cero revisiones y cero verificaciones pendientes**. MMSI es la única línea limpia.

---

## Iteración 14 — validación final

- `pnpm test`: **1.375 en verde** (base 1.334 + 41 tests nuevos en toda la noche), `pnpm typecheck` limpio.
- `pnpm consistencia`: **0 graves y 24 avisos** sobre 214 filas. Los 24, clasificados: 13 `dividendo_fuera_de_escala`
  (monedas de proveedor, ya suprimidas de la fila), **9 `noticias_sin_leer`** (consecuencia esperable de ensanchar:
  filas nuevas cuyas noticias todavía no se leyeron — **ninguna es línea del plan**: DXCM, RMD, PG, EOG, GDDY, UAL,
  QGEN, SIBN, URI), 1 `patrimonio_sin_sentido` (CCSI), 1 `objetivo_fuera_de_escala` (APH, ya neutralizado).
- `pnpm auditar`: "las pantallas no se contradicen entre sí". Radar 214 candidatos, plan 8 líneas, Cartera 8
  posiciones, curva 309 ruedas.

## Lo que NO hice, y por qué

- **No toqué `bajo_sma200`**, aunque es el número más grande de la simulación (+2,08% en régimen restrictivo, +4,12%
  más de 20% abajo). El sesgo de supervivencia apunta exactamente en esa dirección y la muestra está inflada ~1
  punto. Lo que lo resolvería: guardar fundamentales con versión por fecha y un universo que incluya a los que
  desaparecieron.
- **No subí el tope de posiciones nuevas** (`maxNewPositions` tiene techo duro de 5; con 40.000 da 4). Es el cuello
  real de "más tickers", y no lo moví porque la única medición fuera de muestra que existe dice que las COMPRAR del
  Radar rinden **−6,79%** contra el S&P. Dar mecánicamente más de una señal con rendimiento medido negativo empeora
  el resultado. El trabajo de espectro mejora el **pozo de selección**, no cuánto se despliega sobre señal no probada.
- **No reverti que la revisión avise en vez de frenar**: es tu decisión del 18/9. La corrí en vez de discutirla.

---

## Iteración 15 — el tope de posiciones: me equivoqué y lo corregí

El dueño reclamó que "hay muchas oportunidades y la aplicación no recomienda nada". Tenía razón, y mi argumento de
la iteración 10 para no subir el tope **estaba mal**.

Lo que había dicho: "dar mecánicamente más de una señal con rendimiento medido negativo empeora el resultado".
Lo que está mal: **el tope no controla cuánta plata va a la señal** —el aporte es el mismo— **controla en cuántos
nombres se reparte**. Repartir lo mismo en más nombres baja la varianza con la misma media. Concentrar una señal
dudosa no la mejora: le agrega riesgo idiosincrático.

**El embudo, medido.** De 70 candidatas dejadas afuera del plan, **46 lo estaban solo por "tope de 4 posiciones
nuevas"**. No por calidad: por el tope.

- [x] **Medí si el orden justifica concentrar, con un comando nuevo `pnpm conviccion`** (puro, 5 tests). Agrupa las
  COMPRAR por tramo de convicción —el mismo orden que usa el plan— y mide el alfa. Sobre 29 fechas del 7/9 al 8/10:

  | Tramo | Convicción | Alfa 7d | Acierto | Símbolos |
  |---|---|---|---|---|
  | 1 | 1,19 | −0,24% | 45% | 36 |
  | 2 | 0,90 | **−3,07%** | 50% | 52 |
  | 3 | 0,70 | **+1,46%** | 56% | 59 |
  | 4 | 0,48 | −1,29% | 38% | 48 |
  | 5 | 0,15 | **−1,86%** | **30%** | 36 |

  **La convicción sí separa lo malo** (el último tramo es el peor y con el peor acierto) **pero NO separa lo mejor de
  lo bueno**: el tramo 1 rinde peor que el tramo 3. Tomar las 4 primeras no tiene ventaja medida sobre tomar las 10.
  *Archivos*: `packages/core/src/radar/medir-conviccion.ts`, `.test.ts`, `apps/api/src/radar-cli.ts`.

- [x] **Tope nuevo**: igual para un aporte mensual normal (2) y una posición más por cada aporte extra, con techo en
  **10** (más abajo empieza el tramo que sí mide mal). Con 40.000 pasa de **4 a 7**.
  *Archivos*: `packages/core/src/radar/plan.ts` (`maxNewPositions`, `MAX_POSICIONES_NUEVAS_TECHO`).
  *Resultado*: el plan pasó de 4 líneas de riesgo a **7**, con BLX, LLY y MUSA nuevas, misma plata total.

- [x] **Dos tests que fijaban el comportamiento viejo se actualizaron, y uno de ellos NO probaba lo que decía.**
  El de "el lugar no lo toma un ETF" comparaba montos por línea entre dos planes de **forma distinta** (uno con línea
  de ETF y otro sin ella, porque esa es la otra mitad de la misma regla): la igualdad se cumplía por una coincidencia
  aritmética del tope apretado. Se cambió por la invariante real, con el número que el propio plan declara.

**Y el defecto que mi propio cambio introdujo**, encontrado antes de dárselo:

- [x] **Líneas inejecutables en tramos.** Al repartir en 7 en vez de 4, cada línea se hizo más chica y las acciones
  CARAS dejaron de alcanzar para un lote por tramo: **LLY con USD 1.949 y la acción en 1.212 daba `trancheQty = 0`**,
  y EME también. O sea el plan sugería 3 tramos para líneas que en 3 tramos no compran nada.
  *Arreglo*: cada línea declara `tranchesLinea`, los tramos que de verdad puede (nunca 0, nunca más que el plan), y
  una nota dice cuáles no se pueden partir: "LLY en 1, EME en 2; se compran de una vez".
- [x] **El plan sobrevendía cuánto despliega.** Decía 40.000 cuando con lotes enteros a los precios de orden despliega
  **37.970**: 2.030 quedaban sin usar y en ningún lado se decía. Ahora la nota lo dice con el número y aclara que no
  es una reserva, es el resto que no alcanza para una acción más en ninguna línea.
  *Comprobado*: 4 tests nuevos.

**Validación**: `pnpm test` **1.384 en verde**, typecheck limpio, `pnpm consistencia` 0 graves / 23 avisos sobre 214
filas, `pnpm auditar` sin contradicciones, plan de 11 líneas con cero revisiones y cero verificaciones pendientes.

## Lo que la medición dice sobre el reclamo, sin maquillaje

El Radar tiene 73 COMPRAR y el plan ahora muestra 7 en vez de 4. Eso era un tope mal calibrado y está arreglado.
Lo que NO cambió es que **ninguno de esos 73 nombres tiene alfa esperada positiva medida**: la base de COMPRAR da
−0,73% a 7 días y −6,79% a 30 (una cohorte). Repartir en 7 en vez de 4 baja la varianza; no convierte una señal sin
filo demostrado en una con filo. Las dos cosas son verdad a la vez y hay que decirlas juntas.

---

## Iteración 16 — el dato estaba calculado y lo tiraba

Reclamo del dueño, textual: *"ni siquiera te fijas en los datos que ya están calculados como las líneas medias y
te lo tuve que decir yo"*. Tenía razón y era peor de lo que parecía.

- [x] **La fila de una acción tiraba la media de 200.** `technicalGate` la calcula, la devuelve en `sma200`… y
  `decideCandidate` la descarta. La fila guardaba `sma20` y `sma50` dentro de `entry`, y **la de 200 no** — que es
  justamente la única que la app usa como compuerta. Peor: **la fila de un ETF sí guarda su `distSma200Pct`**
  (`{rs3m, rs6m, rs12m, atrPct, distSma200Pct: 7}`), mientras la de una acción guarda solo los ejes fundamentales
  (`{growth, balance, quality, valuation}`). O sea un ETF podía decir "estoy 7% arriba de mi media de 200" y una
  acción no.
  *Consecuencia*: para saber si el precio estaba lejos de una media PLANA había que pedir las velas y calcularlo a
  mano. No era un dato que ninguna pantalla pudiera decir, y por eso el dueño lo tuvo que señalar.
  *Arreglo*: `EntryTiming` ahora lleva `sma200`, `distSma200Pct` y `pendSma200Pct` (pendiente de la media en 63
  ruedas, calculada con la serie **recortada**, nunca mirando adelante). Viaja en la fila, en el plan y en la ficha.
  *Comprobado*: 4 tests nuevos en `entry.test.ts`, incluido uno que falla si la pendiente mirara el futuro.
  *Archivos*: `packages/core/src/radar/entry.ts`, `entry.test.ts`, `apps/web/src/api.ts`, `apps/web/src/Entry.tsx`.

- [x] **Y se muestra**, con la distinción que importa: la ficha dice la media, a qué distancia está el precio y si
  esa media **sube, está plana o baja**, con el número.

**Medí si la pendiente debía FRENAR, antes de agregar una regla.** `pnpm simular`, 47.796 observaciones, alfa a 30
ruedas: media plana +0,93% contra media subiendo −0,12%; y en el cruce exacto (precio 5-25% arriba): plana +0,54%
contra subiendo +0,28%. En régimen restrictivo: plana −0,38% contra subiendo −0,73%. **La pendiente no predice**, y
el sesgo de supervivencia empuja a favor de los grupos planos/cayendo, así que la diferencia real es aún menor.
**Por eso se informa y no frena**: agregar un freno sin evidencia es el error que casi cometí con el momento.

**Lo que el dato nuevo destapó en el plan de hoy**, y no se podía ver antes:

| Símbolo | Media 200 | Precio vs. media | Pendiente 3 meses |
|---|---|---|---|
| **MMSI** | 76,71 | **+10,9%** | **+0,25% (plana)** |
| **HCI** | 169,40 | **+10,2%** | **−0,91% (bajando)** |
| LLY | 1.075,50 | +10,5% | +8,18% |
| MCY | 97,71 | +4,7% | +6,48% |
| CTS | 56,35 | +3,4% | +11,50% |
| BLX | 53,28 | +1,8% | +7,18% |
| EME | 775,48 | +1,2% | +5,18% |
| MUSA | 506,69 | +0,9% | +11,95% |

Dos de las ocho líneas están sobre una media de 200 muerta, y son **las dos más alejadas de ella**: MMSI (plana) y
**HCI (bajando)**. HCI es además una de las dos líneas "en zona", o sea comprable hoy a mercado. Eso no es un freno
—está medido que no predice— pero es contexto que el dueño tiene derecho a ver antes de apretar el botón, y hasta
hoy la app no se lo podía decir.

Estado: `pnpm test` **1.388 en verde**, typecheck limpio.

---

## Iteración 17 — el histórico punto-en-el-tiempo, y una skill

El dueño me señaló además que tengo varias skills y no sabe si las uso. Tenía razón: **modifiqué `Entry.tsx`,
que es una pantalla, y no corrí `auditar-pantalla`, que es obligatoria**. La corrí y encontró un defecto en mi
propio cambio de diez minutos antes.

- [x] **Hallazgo de la auditoría, sobre mi propio código**: puse "está plana" y "baja" **en negrita** en el renglón
  nuevo de la media de 200. La regla dura de la skill dice que un número que el sistema no usa para decidir no puede
  estar destacado. Yo acababa de medir que la pendiente **no predice** y de decidir que no frene: destacarla invitaba
  a la conclusión falsa de que la app la castiga. Corregido a texto apagado, con la aclaración "informativo: el nivel
  decide (bandera bajo_sma200), la pendiente no frena". Y si no hay 200 ruedas, ahora lo dice en vez de desaparecer.
- [x] **Probado que el chequeo tiene dientes** (paso obligatorio de la skill): recalculé HCI a mano desde las velas —
  169,40 / +10,23% / −0,91% — y coincide exacto con lo que guarda la fila.

**El dato que tampoco estaba usando.** Dije que el ranking no se podía backtestear. Era cierto solo para re-rankear
con otros pesos: **`radar_evaluadas` venía guardando el PUESTO de cada símbolo evaluado todos los días desde el
24/9** — 13 fechas, 748 símbolos, 3.530 puestos. Eso es punto en el tiempo y no lo miré nunca.

Medido con ese puesto, alfa a 7 días contra el S&P:

| Tramo por puesto | Observaciones | Símbolos | Alfa 7d | Acierto |
|---|---|---|---|---|
| **1-50 (mejor puesto)** | 68 | 28 | **−1,74%** | **34%** |
| 51-150 | 205 | 91 | +0,33% | 40% |
| 151-300 | 357 | 154 | −0,79% | 38% |

**El mejor puesto es el que peor rinde.** Coincide con el test por quintil de puntaje: dos cortes independientes,
la misma conclusión. El ranking fundamental no es solo no-predictivo arriba: está invertido.

- [x] **Tabla `fundamentals_historia`** (migración 0028, puramente aditiva: ninguna lectura existente cambia).
  Append-only, una fila por (fecha, símbolo), con métricas, pares, industria, capitalización, volumen, precio y
  moneda. Se escribe en cada `saveFundamentals` y **falla abierta**: un problema guardando el histórico no puede
  tirar un barrido de 20 horas.
- [x] **Semántica punto-en-el-tiempo, y acá casi me equivoco**: `as_of` es la fecha en que se PIDIÓ cada símbolo, no
  un corte uniforme (las fundamentales solo se repiden si tienen más de 7 días). Mi primera versión filtraba
  `as_of = D` y habría tomado un puñado de símbolos diciendo cualquier cosa. Corregido a "por símbolo, la última
  versión con fecha ≤ D".
  *Verificado contra la base*: al 10/9 devuelve 47 símbolos usando solo datos del 7/9; al 25/9 usa 7/9, 13/9 y 20/9;
  al 8/10, 2.811 símbolos. **Con fecha futura: 0 en los tres casos.** Sin fuga de futuro.
- [x] **Sembrada con el estado de hoy**: 2.811 filas. Hacia atrás es flaco (las versiones viejas se sobreescribieron
  y están perdidas para siempre), pero **desde hoy cada barrido deja su foto** y en unas semanas el ranking es una
  pregunta con respuesta en vez de una discusión de criterio.
  *Archivos*: `packages/db/drizzle/0028_fundamentals_historia.sql`, `packages/db/src/schema.ts`,
  `packages/db/src/repo.ts` (`fundamentalsEnFecha`, `fechasConHistoria`).

- [x] **Skill nueva `tocar-el-motor`**, obligatoria antes de cambiar cualquier regla, umbral, peso, tope o filtro que
  decida comprar o vender. No es teoría: es la lista de las seis formas concretas en que me equivoqué estos dos días,
  cada una con el caso real. Los diez pasos del procedimiento son: medir el embudo primero, cruzar por régimen
  siempre, declarar el sesgo antes de leer el número, contar símbolos y no filas, separar lo que frena de lo que
  informa, buscar el dato antes de calcularlo, buscar lo que el cambio rompió, preguntar qué probaba un test que
  falla, verificar contra la salida y reiniciar la API, y dejar la medición escrita donde vive la regla.
  *Archivo*: `.claude/skills/tocar-el-motor/SKILL.md`.

**Validación final**: `pnpm test` **1.388 en verde**, `pnpm typecheck` limpio, `pnpm consistencia` **0 graves** y 30
avisos sobre 214 filas, `pnpm auditar` sin contradicciones entre pantallas.

---

## Iteración 18 — barrido completo, y por qué ninguna COMPRAR convence

El dueño pidió un barrido de toda la app con el objetivo claro, y repitió el reclamo: de todo el espectro
mundial, ninguna de las que la app da como compra convence. **Medido, tiene razón, y la causa es precisa.**

### Qué eje del puntaje está roto

Los cuatro ejes están guardados por fila y por fecha, así que es punto en el tiempo. Alfa a 7 días por tercil
del eje (tercil 1 = puntaje más bajo), 13 fechas, 40-47 símbolos por tramo:

| Eje | Peso | Tercil 1 | Tercil 2 | Tercil 3 | Lectura |
|---|---|---|---|---|---|
| **valuation** | **0,35** | −1,02 | −0,88 | −0,94 | **plano: cero señal** |
| quality | 0,30 | −0,98 | −2,21 | +0,17 | débil, solo el tercil de arriba |
| **growth** | **0,25** | +0,43 | −1,01 | −2,36 | **invertido y monótono** |
| balance | 0,10 | −3,57 (31% acierto) | +0,69 | −0,13 | funciona **abajo** |

**El 60% del peso (valuation + growth) es ruido o va al revés.** Eso explica que el mejor quintil sea el peor
y que el mejor puesto rinda −1,74% con 34% de acierto. Lo único con señal fuerte es `balance` en el tercil
malo, y es una señal NEGATIVA (evitar balances flojos).

### No es cobertura: es selección

De 35 líderes temáticos mundiales, **34 están en el universo de la app** (solo falta RHM.DE, listado alemán) y
**21 nunca aparecieron en el Radar**: ASML, ETN, HUBB, AVGO, LMT, RTX, FCX, SCCO, NEM, FNV, PAAS, WPM, AG,
BWXT, LEU, ALB, NVO, WST, PWR, MUFG. La app tiene a ASML y a Eaton adentro y nunca los mostró, porque el
puntaje los deja fuera de la preselección de 600.

### Lo que se cambió, y lo que NO

**No se tocó ningún peso.** Re-pesar con 13 días y 40 símbolos por tramo es sobreajustar, y es exactamente lo
que la skill `tocar-el-motor` prohíbe. `fundamentals_historia` ya acumula; en unas semanas se puede probar.

- [x] **La puerta deja de depender del puntaje.** `simbolosConPuerta` se abre con un hecho de **sector**
  verificado a favor, no solo con guía subida. Un hecho con fuente primaria es una razón mecánica, con fecha y
  verificable, para que la app MIRE a una empresa; mirar no es comprar — después la deciden las mismas reglas
  que a todas. *Y había un bug de cableado*: el pipeline pedía solo hechos de tipo `guia`, así que los de
  sector nunca llegaban aunque la función ya los aceptara. 4 tests.
- [x] **El plan dice su propio acierto**, en sus notas: *"281 de 647 filas (121 símbolos, del 7/9 al 30/9) le
  ganaron al S&P a 7 días, o sea 43%, con alfa promedio −1,01%. No es un pronóstico de estas líneas: es el
  historial del criterio que las eligió."* Antes presentaba las líneas como si el criterio estuviera validado.
  3 tests.
- [x] **Un hecho de sector más, verificado contra sec.gov**: GEV, cartera de equipos de Gas Power más reservas
  de cupo de 100 a 116 GW, 125 GW esperados a fin de 2026 (8-K del 22/7/2026).
  **MU quedó afuera a propósito**: fui a buscar el comunicado del 3T en sec.gov y **no dice** que el HBM esté
  vendido — eso era prensa secundaria. Sin fuente verificada no se carga, aunque la tesis me guste.

### Lo que el barrido encontró en la corrida

`pnpm consistencia` dio **78 graves de `velas_desfasadas`**: cerró la rueda del 8/10 y las filas tenían velas
del 7/10, o sea el plan estaba armado con cierres de ayer. **No es un defecto: es el chequeo del caso del 23/9
funcionando.** Tras refrescar quedó **1 grave** (NVEC, precio vivo −2%, no es línea del plan) y 17 avisos.

**Operativo, y vale como regla**: el plan se refresca después de cada cierre o sus precios son de ayer. El
chequeo lo grita, pero grita después de que uno pregunta.

Estado: `pnpm test` **1.403 en verde**, tipos limpios, pantallas sin contradicciones.

---

## Iteración 19 — del tema al ticker: cargar los hechos que faltaban (8/10)

Pregunta del dueño: *"¿por qué no podemos analizar todos, obtener tickers y analizar los tickers?"*

La respuesta medida fue: **sí se puede, y cuando se hace, la mayoría de los temas no sobreviven al precio.**

### El embudo real, contado

| paso | símbolos |
|---|---|
| universo barrido | 14.484 |
| con fundamentales de Finnhub | 2.658 |
| preseleccionados por puntaje, por corrida | 600 |
| con velas cargadas (13 días de corridas) | 950 |
| evaluados alguna vez | 751 |
| filas del Radar | 110 |

De 177 tickers de los 19 temas del informe temático: **167 ya tenían fundamentales** (la cobertura no era el
problema), **75 tenían velas** y **55 se habían evaluado alguna vez**. Sin 200 velas no hay media de 200, ni
ATR, ni stop: `technicalGate` no puede correr y el símbolo **no puede tener veredicto nunca**.

### El hallazgo que da vuelta el informe temático

Cruzando cada tema contra los precios que la app ya tiene (variación a 6 meses y posición contra su media de
200):

| tema | var. 6 m | sobre su media 200 |
|---|---|---|
| tanqueros | +44,3% | 9 de 9 |
| memoria | +47,7% | 5 de 7 |
| patentes-farma | +11,6% | 5 de 5 |
| japón | −12,2% | 0 de 1 |
| gas-productor | −12,7% | 0 de 3 |
| **oro-plata** | **−14,3%** | 3 de 12 |
| defensa | −17,9% | 0 de 3 |
| minerales | −26,4% | 0 de 4 |
| nuclear | −31,5% | 0 de 2 |

**GLD tocó 495,90 el 29/1/2026 y vale 378,62: −23,6% desde el máximo, y plano contra hace un año.** El tema
que yo había llamado "el agujero más grande, en tu app y en mi informe" era un movimiento terminado hace ocho
meses. La encuesta LBMA que proyecta oro a 5.000 salió el 6/10, con el metal 24% abajo de su máximo.

**Los dos temas que sí confirman con precio (tanqueros y memoria) son los que la app ya había encontrado
sola.** El análisis temático por búsqueda web llega tarde; las compuertas de precio tenían razón.

### Defecto encontrado: los hechos de aranceles estaban vencidos y yo dije que la puerta estaba abierta

Reporté *"seis símbolos con la puerta abierta: CF, CROX, FIVE, GEV, HAS, VST"*. Falso: los tres hechos de
aranceles son del 20/2/2026, o sea **230 días contra una ventana de 180**. `hechosVigentes` los excluye. La
puerta real eran **tres**: CF, GEV, VST. Listé los símbolos con hecho `a_favor` sin aplicar la vigencia.

### Lo que se cargó: 36 hechos de sector, 7 temas, toda fuente primaria abierta y leída

| ámbito | sesgo | símbolos | fuente |
|---|---|---|---|
| memoria: precio y capex del ciclo | a favor | SNDK WDC STX AMKR TER ONTO CAMT KLIC ACLS | Micron, 8-K del 30/9/2026 (sec.gov) |
| tanqueros de crudo: tarifas | a favor | INSW DHT TNK NAT CMBT | Frontline, 6-K del 28/8/2026 (sec.gov) |
| tanqueros de productos: tarifas | a favor | TRMD HAFN ASC | Scorpio, 6-K del 3/9/2026 (sec.gov) |
| agro: insumos contra granos | a favor | MOS NTR | USDA ERS, 3/9/2026 |
| gas natural: exceso a 2027 | a favor | NRG | EIA STEO de octubre 2026 |
| gas natural: exceso a 2027 | **en contra** | EQT AR RRC CNX EXE | EIA STEO de octubre 2026 |
| reaseguro: tarifas de catástrofe bajando | **en contra** | RNR EG ACGL AXS MKL SPNT | RenaissanceRe, 10-Q del 2T26 |
| farma: precios fijados por Medicare | **en contra** | LLY PFE BMY GILD MRK | el 10-Q del 2T26 de cada una |

Reglas que se respetaron, y cuestan:

- **El signo lo pone el precio medido, no el titular.** Si cargaba los temas como los conté el martes, la app
  habría abierto la puerta a doce mineras de oro que están todas abajo de su media de 200.
- **Cada hecho lleva su contrapeso, dicho por la propia fuente.** Frontline avisa que el TCE del 3T completo
  va a quedar *por debajo* de lo contratado por los días en lastre; RenaissanceRe sostiene que la tarifa sigue
  en nivel de suficiencia; Pfizer aclara que a Xeljanz **no** se le va a aplicar precio máximo porque hay
  genérico real.
- **ABBV quedó afuera a propósito**: su propio 10-Q dice que el gobierno le dio *"a three-year exemption from
  tariffs and future price mandates"*. Cargarla como `en_contra` con ese párrafo en la misma fuente sería
  mentir por omisión.
- **Lo que no se cargó, y por qué**: aranceles (ventana vencida); oro, plata, defensa, minerales, nuclear y
  Japón (la única evidencia es el precio, que la app ya ve por `bajo_sma200` — cargarlo sería contar lo mismo
  dos veces); cuántica (ninguno de los 6 símbolos tiene una sola vela); robótica, software por asiento y
  salud de medio término (no encontré fuente primaria en los hosts de la lista). CTRA no está en el universo;
  GLRE, IPI y UAN están `excluded` por la barra de calidad, y la puerta **no** puede rescatar a un excluido
  porque nunca llega a tener fundamentales.

### Defecto que destapó la carga: el tope de la puerta es chico y el desempate es alfabético

`PUERTA_TOPE = 20` y quedaron **23 candidatos** `a_favor` vigentes. Ordena por fecha descendente, así que mi
propia carga **expulsó a GEV, NAT y TNK**. Y entre los cinco tanqueros de crudo, todos fechados 28/8, el corte
entre CMBT/DHT/INSW y NAT/TNK lo decide el **orden alfabético**: precisión falsa.

**No se cambió el tope.** Subir un umbral sin medir es exactamente lo que la skill prohíbe, y además es
decisión del dueño. Queda dicho: es una línea, y la puerta solo agrega candidatas a evaluar — nunca obliga a
comprar.

### Mi error al correr, y el defecto grande que destapó

Corrí `rank` sabiendo que la cuota de Gemini es de 20 pedidos por día (está escrito en mis propias notas) y que
ese paso pide una ficha por candidata. **La cuota ya estaba gastada por la corrida del cron**, así que las 48
fichas que intentó fallaron. Error mío y evitable.

Pero al mirar el daño apareció algo que no era mío y es peor. En `filaDeAccion`:

```ts
if (deps.cardWriter) {
  try {
    const w = await writeCardFor(...);
    if (w?.degrade && verdict === "COMPRAR") verdict = "OBSERVAR";   // la compuerta
  } catch (e) {
    ctx.errors.push({ symbol: sym, error: String(e) });               // y si falla, sigue como COMPRAR
  }
}
```

**La ficha no es decoración: es una compuerta que puede degradar un COMPRAR a OBSERVAR.** Cuando falla, el
error se anota y la fila sigue COMPRAR **sin haber pasado por esa compuerta**. Falla abierta, la misma clase de
defecto que el verificador del 14/9.

Y es crónico, no de esta noche:

| fecha | COMPRAR | sin ficha | filas que decían tener versión de ficha sin tenerla |
|---|---|---|---|
| 8/10 (mi corrida) | 73 | **73** | 108 |
| 7/10 | 79 | **63** | 60 |
| 6/10 | 58 | 7 | 1 |
| 4/10 | 43 | **38** | 46 |
| 30/9 | 46 | 6 | 0 |

**Al ensanchar la preselección a 600 el presupuesto de fichas dejó de alcanzar, y nadie lo vio porque nada lo
contaba.** Desde el 7/10, la compuerta del narrador está prácticamente apagada para la mayoría de las
candidatas. Eso es parte de por qué las COMPRAR no convencen: el filtro que debía atajar las historias que no
cierran no corrió.

Peor: la fila guardaba `prompt_version` igual, así que **decía tener una ficha que no tenía**. Aviso falso.

### Lo arreglado

- [x] **`prompt_version` solo cuando hay ficha**, en los dos lugares que la escriben (`filaDeAccion` y el
  relleno de `refreshRadar`). Una fila no puede decir que pasó por el narrador si no pasó.
- [x] **Chequeo nuevo `ficha_faltante`, grave**: una COMPRAR de acción sin ficha se reporta, porque COMPRAR
  significa que el dueño compra. Sobre la base real dispara **65 graves**, que es la verdad que estaba tapada.
  3 tests.
- [x] **Dos fixtures de test decían "corrida sana" con una COMPRAR sin ficha.** Les puse ficha: el caso de
  "Yahoo falló y la corrida no suma graves por eso" se apoyaba en que no existía este chequeo.

Lo que NO se tocó: el veredicto sigue sin bloquearse por falta de ficha. `refreshRadar` ya rellena las fichas
que faltan y aplica el degradado ahí (`needCards`), así que el estado es **recuperable corriendo el refresco
cuando la cuota se renueva**. Cambiar el veredicto por ausencia de ficha es una decisión del dueño, no mía.

**Consecuencia operativa, dicha sin vueltas: el plan de esta noche no se ejecuta.** Sus 10 líneas salen de
filas sin ficha, o sea COMPRAR que nunca pasaron la compuerta del narrador.

### La recuperación, y por qué el problema es de capacidad (9/10, 04:11)

El refresco corrió al renovarse la cuota. Resultado: **de 68 graves a 24**, y las fichas pasaron de 4 a 86.
El plan se rearmó con 11 líneas y **6 de las 7 líneas de riesgo tienen ficha** (MMSI, DEO, HCI, MCY, BLX,
MUSA). **FRPT no**: es la única línea del plan cuya compuerta del narrador no corrió.

VTI, VEA, VWO y EME aparecen sin ficha y está bien: los ETF y las filas de seguimiento no llevan ficha. La
diferencia es que ahora **no mienten una versión que no tienen** — antes decían `prompt_version` igual.

Pero la causa de fondo no era mi corrida ni la mala suerte. **El presupuesto de fichas no alcanza:**

| modelo | llamadas hoy | ok | 429 por cuota |
|---|---|---|---|
| gemini-2.5-flash (4 keys) | 90 | 63 | 6 |
| gemini-3.6-flash (4 keys) | 89 | 31 | 6 |
| gemini-3.8-flash (4 keys) | 31 | 4 | 0 |

**98 llamadas buenas en todo el día, agotadas a la hora de renovarse la cuota** (07:05 a 08:02 UTC), contra
83 COMPRAR que necesitan ficha, más el clasificador de titulares, más la verificación. No es transitorio: es
una cuenta que no cierra desde que la preselección subió a 600. Decidirlo es del dueño, porque es plata:
pagar cuota, angostar la preselección, o repartir el presupuesto distinto.

### Y una corrección a lo que yo mismo dije hace dos horas

Dije que la compuerta apagada era "parte de por qué las COMPRAR no convencen". **Medido, es falso o casi.**
El degradado del narrador dispara muy poco:

| fecha | filas con ficha | degradadas por el narrador |
|---|---|---|
| 9/10 | 86 | 0 |
| 7/10 | 51 | 1 |
| 6/10 | 79 | 1 |
| 2/10 | 80 | 2 |
| 30/9 | 80 | 3 |
| 28/9 | 78 | 4 |

Entre 0 y 4 de ~80, o sea 2 a 4%. Así que `ficha_faltante` importa por dos razones más chicas y honestas:
la pantalla mostraba un COMPRAR **sin tesis que leer**, y la fila **mentía** que había pasado por el
narrador. No importa porque el filtro fuera bueno: con ese porcentaje, no lo es.
