# /mercado argentina — lunes 5 de octubre de 2026

Corrida **enfocada en Argentina**, pedida así: *"argentino, qué está ocurriendo, se está levantando, qué acciones
puedo adquirir"*. Tres frentes de búsqueda (macro, ADRs, panel local), dos pasadas del comando de la app y la
verificación de cada número de pantalla contra su fuente.

No reemplaza al informe ancho de hoy (`2026-10-05.md`), lo complementa: ese miró el mercado entero con el universo a
medio construir; este mira Argentina con el barrido **terminado**.

> **Las tres respuestas, arriba y sin vueltas.**
>
> **¿Qué está ocurriendo?** El riesgo país pasó de 485 pb el 11/9 a 655 el 2/10: **+170 pb en 15 ruedas**. No es un
> evento de crédito argentino. Es la Fed subiendo la tasa el 16/9 (primera vez desde 2023) con el Treasury a 10 años
> en 5,28%, más tres datos reales malos y seguidos entre el 18 y el 24/9, que encendieron el riesgo de la elección
> presidencial del **24 de octubre de 2027**.
>
> **¿Se está levantando?** **No.** El último dato publicado es el peor de la serie. Hoy hay rebote intradía en los
> ADRs (+2,5% a +4,9%) y los dólares aflojan, pero **ninguna de las cuatro posiciones argentinas recuperó su stop**.
> Un día verde no es una vuelta de tendencia.
>
> **¿Qué podés adquirir?** **Nada argentino, según la app.** De 48 instrumentos argentinos, **46 OBSERVAR**. Los dos
> que pasan el filtro técnico son locales de BYMA, y la pantalla los muestra como CANDIDATA, no COMPRAR, porque el
> plan en dólares no compra papeles argentinos. Pero el hallazgo es otro: **los dos pasan por una compra de control en
> curso, no por su negocio.** METR.BA tiene a Edenor comprándole el 70% a YPF por USD 780 M, con el regulador sin
> fecha y **sin OPA lanzada**; BOLT.BA tiene una OPA de ARS 70 por una sucesión familiar, con el papel ya en 63,60
> —**+10% de upside**— y **USD 14.000 de volumen por día**. Son arbitraje de fusión, no posiciones de cartera.
>
> Esta corrida destapó además **dos defectos reales** y **cuatro huecos de datos**. El más grande: `hostsPrimarios`
> tiene 14 fuentes primarias y **ninguna es argentina**, y el módulo de hechos dice que *"sólo lo VERIFICADO mueve
> algo"*. O sea: con la cartera 73% argentina, **ningún hecho de la CNV, del Boletín Oficial, del BCRA o del INDEC
> puede mover una decisión de la app.** Están todos en el punto 6.

---

## 1. La foto

El ancla es el régimen que calcula la app: **restrictivo**, 10 años en 5,28%, +80 pb en tres meses
(`GET /radar/top`, al 2/10). Todo lo argentino se lee contra eso.

### La macro, medida

| Qué | Dato | De dónde |
|---|---|---|
| Riesgo país, último publicado | **655 pb, viernes 2/10** | [argentinadatos](https://api.argentinadatos.com/v1/finanzas/indices/riesgo-pais) (la fuente de la app) |
| Mínimo del tramo | **485 pb, 11/9** | ídem |
| Movimiento | **+170 pb en 15 ruedas**, subiendo 13 de ellas | ídem |
| Mínimo de 2026 | 402-403 pb, 10/7 | [Infobae 27/9](https://www.infobae.com/economia/2026/09/27/riesgo-pais-arriba-de-600-puntos-dos-factores-externos-y-tres-locales-detras-de-la-caida-de-los-bonos-argentinos/) |
| Contexto del nivel | 646 de cierre el 2/10, máximo intradía 655: **el más alto desde el 25/11/2025** | [Infobae 3/10](https://www.infobae.com/economia/2026/10/03/semana-financiera-el-riesgo-pais-se-disparo-6-y-las-acciones-argentinas-cayeron-hasta-12-en-wall-street/) |
| Merval en dólares | 1.976 (11/9) → **1.698 (2/10)**: −14,1% | app, serie `/radar/argentina` |
| Dólares, ahora | oficial 1.540 · mayorista 1.516 · MEP 1.541,9 · CCL **1.611,5** · blue 1.555 | [dolarapi](https://dolarapi.com/v1/dolares), 5/10 14:57 UTC |
| Brecha CCL/oficial | **4,64%** ahora (era 3,48% el 8/9) | calculada sobre lo anterior |
| Soberanos hard-dollar | rinden **más de 11% anual** | [Infobae 3/10](https://www.infobae.com/economia/2026/10/03/semana-financiera-el-riesgo-pais-se-disparo-6-y-las-acciones-argentinas-cayeron-hasta-12-en-wall-street/) |

### Por qué subió: dos shocks externos y tres datos locales

Lo externo, con fecha:

- **La Fed subió 25 pb el 16/9/2026** a 3,75%-4,00%, **primera suba desde 2023**, por 12-0. Doce de dieciocho
  participantes esperan otra suba en 2026 ([CNBC, 16/9](https://www.cnbc.com/2026/09/16/fed-rate-decision-september-2026.html)).
- **El Treasury a 10 años llegó a 5,25%-5,28%** en la semana del 29/9 al 2/10, máximo de dos décadas. Es el mismo
  5,28% que la app usa como régimen: el ancla de la app y la causa de la caída argentina son el mismo número.

Lo local, en seis días:

- **18/9 — PIB del 2T: −0,6% trimestral** desestacionalizado, primera caída desde 2024. Consumo privado −2,4%,
  inversión −11,1% interanual ([Ámbito](https://www.ambito.com/economia/el-pbi-cayo-06-el-segundo-trimestre-deterioro-el-consumo-y-la-inversion-n6323646)).
- **24/9 — EMAE de julio: −2,9% mensual**, la mayor caída desde la pandemia y **más de tres veces** lo que esperaban
  las consultoras (~0,8%) ([INDEC, primaria](https://www.indec.gob.ar/uploads/informesdeprensa/emae_09_26FE154D8FFE.pdf)).
- **24/9 — Pobreza al 32,3%** desde 28,2%: +4,1 puntos, ~15,5 millones de personas
  ([INDEC, primaria](https://www.indec.gob.ar/uploads/informesdeprensa/eph_pobreza_09_2670733F4C4D.pdf)).

Y el ministro lo atribuyó explícitamente al calendario: *"el riesgo de que vuelva el kirchnerismo genera
preocupación"* ([La Nación, 3/10](https://www.lanacion.com.ar/economia/el-riesgo-pais-supero-los-650-puntos-las-razones-detras-de-la-escalada-que-lo-llevaron-a-un-nuevo-nid03102026/)).
**No hay elección en 2026.** Las generales son el **domingo 24 de octubre de 2027**.

El dato que confirma que es electoral y no de caja: **las probabilidades implícitas de default subieron más para los
años posteriores a 2027** ([Infobae, 30/9](https://www.infobae.com/economia/2026/09/30/mercados-las-acciones-y-los-bonos-argentinos-se-estabilizan-pero-completan-un-mes-de-septiembre-con-amplias-perdidas/)).
El mercado no duda de que se paga este año. Duda de quién gana en octubre de 2027.

### El otro lado, que es real y conviene no tapar

| Hecho | Dato | Fuente |
|---|---|---|
| Superávit comercial | **33 meses consecutivos**; agosto USD 2.187 M, exportaciones +12,4% | [INDEC, primaria](https://www.indec.gob.ar/uploads/informesdeprensa/ica_09_266E5973E036.pdf) |
| El BCRA **compra**, no vende | USD 369 M en la semana del 28/9 al 2/10, la mayor desde julio. Reservas USD 48.653 M | [Infobae 5/10](https://www.infobae.com/economia/2026/10/05/tras-el-paso-del-fmi-el-banco-central-acelero-la-compra-de-reservas-a-que-poder-de-fuego-aspira-caputo-para-las-elecciones/) |
| Meta de reservas del FMI | **cumplida por primera vez** desde la firma del programa (corte 30/6) | [Ámbito 29/9](https://www.ambito.com/economia/el-fmi-cerro-su-mision-la-argentina-y-resta-el-aval-desembolsar-us900-millones-n6328594) |
| Banda cambiaria | mayorista 1.516-1.520 contra techo 1.920: **~21% por debajo**. Nada que defender | [BCRA, primaria](https://www.bcra.gob.ar/en/exchange-rate-band-regime/) |
| RIGI aprobado | Pluspetrol + GyP, **USD 12.400 M** en Vaca Muerta, 30/9, >92% a exportación | [iProfesional](https://www.iprofesional.com/energia/465752-caputo-anuncio-un-nuevo-rigi-en-vaca-muerta-por-12500-millones-de-dolares) |

**La contradicción es el punto.** El frente externo y cambiario está mejor que en años; el precio cae igual. Eso es
porque el problema no es 2026: es el **muro de USD 20.000-21.000 millones de 2027** —USD 12.000 M a privados, 7.500 M
al FMI, pico de ~4.500 M en enero— con el mercado internacional **cerrado de hecho** a rendimientos de 11%, y con
Caputo diciendo que no emiten antes de las elecciones
([Infobae, 28/9](https://www.infobae.com/economia/2026/09/28/la-deuda-soberana-enfrenta-vencimientos-por-usd-20000-millones-en-2027-en-medio-de-la-incertidumbre-electoral/)).
El Presupuesto 2027 **no incluye ninguna colocación de bonos Globales** en sus fuentes de financiamiento.

Una reserva que hay que anotar: **la meta fiscal del primer semestre se incumplió** (superávit primario ~0,6% contra
meta de 0,7%) y el Gobierno no descarta pedir un *waiver*. La tercera revisión del FMI —desembolso de ~USD 869-900 M—
**cerró la misión el 29/9 y al 5/10 no tiene fecha de Directorio ni comunicado**. Es el catalizador binario del mes y
nadie le puso fecha.

### Qué le hace esta foto a tu cartera

La app marca **Argentina 73,07%** y **petróleo y gas 49,78%**, con el núcleo en 0%. Las caídas de la semana fueron
**en bloque**: Cresud −11,6%, IRSA −9,1%, Telecom −9%, Supervielle −8%, Edenor −6,3%, Vista −6,3%, TGS −5,9%,
YPF −5,8%, Galicia −5,7%.

Eso no es nueve decisiones. Es una, y la toma la tasa de Estados Unidos y un calendario electoral de 2027. Ninguna de
esas nueve empresas decide nada de eso.

---

## 2. El embudo, con sus números

### El barrido, esta vez completo

A diferencia del informe de esta mañana, **el barrido terminó**:

| Etapa | Cuántas |
|---|---|
| Listadas | 14.388 |
| Prefiltradas | 3.018 |
| **Con fundamentales** | **2.659** |
| Excluidas | 330 |
| Errores | 29 |
| Estado | `listo`, barrido del **4/10** |

Esta mañana el universo iba por 1.131 y solo llegaba de la A a la H. Ahora cubre de la A a la Z. **Lo que sigue no
tiene la advertencia de alcance que tenía el informe ancho.**

### Pasada angosta sobre los 15 símbolos argentinos y latam

```
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado SUPV CEPU GGAL BMA BBAR TGS TEO YPF PAM EDN LOMA CRESY IRS GLOB MELI
```

| Etapa | Cuántas |
|---|---|
| Universo del barrido | 2.659 |
| Rankeadas | 2.623 |
| Evaluadas | 15 |
| **Pasan el filtro técnico** | **1** |
| Descartadas | **14** |

VIST, corrido aparte: **descartado también, por `bajo_sma200`**.

**Los 14 descartes son todos el mismo descarte:**

| Motivo | Cuántas |
|---|---|
| `bajo_sma200` | **14 de 14** |

No hay matices. Ni `sin_pares`, ni `ejes_insuficientes`, ni `serie_con_salto`. Catorce de catorce empresas argentinas
están debajo de su media de 200 ruedas. Eso es el régimen hablando, no catorce historias distintas.

**Y el único que pasa, tampoco se compra.** YPF:

| Campo | Valor |
|---|---|
| Veredicto | **OBSERVAR** |
| Puntaje contra pares | **−0,0637** (negativo) |
| Puesto global | **1.404 de 2.623** |
| Puesto en su grupo | **76 de 152** energéticas |
| Riesgo | 5/10 |
| Banderas | `sin_estados`, `subio_mucho_12m`, `bajo_stop` |
| Estado de entrada | `esperar_confirmacion` |
| Por qué | *"cerró en 49.67 y su stop dinámico está en 52.13: la tesis técnica ya se anuló, no se compra hasta que lo recupere"* |

### El Radar completo

| | Cuántas |
|---|---|
| Candidatas totales | 184 |
| COMPRAR | 55 |
| OBSERVAR | 126 |
| NÚCLEO | 3 |
| **Instrumentos argentinos** | **48** |
| de ellos, OBSERVAR | **46** |
| de ellos, con veredicto COMPRAR en el dato | **2** (METR.BA, BOLT.BA) |
| COMPRAR con tema argentina, sobre 55 | **2** |

---

## 3. Los 13 ADRs, uno por uno

**Los trece están en OBSERVAR. Los trece están debajo de su stop.** Doce de trece, también debajo de su media de 200.

| Símbolo | Cierre | vs SMA200 | FR 3m | FR 6m | Stop | Hay que recuperar |
|---|---|---|---|---|---|---|
| YPF | 49,67 | **+10,67%** | +4,9% | −6,9% | 52,13 | +4,9% |
| CRESY | 11,34 | −2,91% | −0,7% | −23,6% | 11,40 | +0,5% |
| TEO | 11,72 | −6,24% | −12,3% | −15,4% | 12,53 | +6,9% |
| PAM | 76,39 | −8,24% | −9,7% | −27,4% | 81,68 | +6,9% |
| IRS | 13,36 | −13,25% | −19,2% | −32,0% | 14,68 | +9,9% |
| LOMA | 9,16 | −17,10% | −24,4% | −29,8% | 9,62 | +5,0% |
| TGS | 25,01 | −17,32% | −17,8% | −40,0% | 28,34 | +13,3% |
| BMA | 64,55 | −22,56% | −33,4% | −27,6% | 72,78 | +12,8% |
| CEPU | 11,68 | −22,44% | −23,4% | −42,0% | 13,32 | +14,0% |
| GGAL | 35,89 | −24,22% | −33,9% | −32,6% | 41,75 | +16,3% |
| EDN | 19,94 | −24,47% | −23,5% | −44,7% | 22,68 | +13,7% |
| BBAR | 12,38 | −25,91% | −41,7% | −33,7% | 14,23 | +14,9% |
| SUPV | 6,86 | −27,94% | −34,1% | −38,3% | 8,11 | +18,2% |

Y el ETF, que sería la forma limpia de expresar una vuelta argentina: **ARGT en 84,52, OBSERVAR**, 8,7% debajo de su
media de 200, fuerza relativa a 6 meses −23,4%, stop en 93,92. Hay que verlo recuperar **+11,1%** antes de que la
regla lo habilite.

La columna "hay que recuperar" es la que contesta tu pregunta de verdad: **para que el papel más golpeado de tu
cartera vuelva a ser comprable según la app, GGAL tiene que subir 16,3%.** Hoy subió 4,9% y sigue abajo.

### Los hechos de los ADRs que sí importan

**Lo que hay que corregir en cualquier ficha que lo diga distinto:**

- **La sentencia de USD 16.100 M contra YPF está VACADA desde el 27/3/2026.** El Segundo Circuito la revocó 2 a 1,
  sosteniendo que el compromiso de hacer una oferta pública *"no era exigible por los accionistas que confiaron en
  él"* ([Burford, 27/3](https://investors.burfordcapital.com/news/news-details/2026/Burford-Capital-Statement-Re-YPF-Appeal-Decision/default.aspx)).
  El riesgo hoy es otro y más chico: **certiorari presentado el 30/9/2026** (Petersen v. Argentina, No. 26-442, en
  docket el 2/10, **respuesta vence el 2/11/2026**, [docket SCOTUS](https://www.supremecourt.gov/search.aspx?filename=/docket/docketfiles/html/public/26-442.html)),
  **sin fecha de decisión** y sin pedido de opinión al Solicitor General en esta ronda; más un **arbitraje CIADI** que
  Burford abrió a mediados de septiembre y que empieza de cero. Cambió de foro y de plazo, no desapareció.
- **Shell ya no es socio de Argentina LNG.** El acuerdo de diciembre de 2024 fue terminado, según el
  [20-F FY2025 de YPF](https://www.sec.gov/Archives/edgar/data/904851/000119312526126363/d95578d20f.htm). Los socios
  son Eni y XRG (ADNOC).

**Los bancos: el problema es la cobertura, no la mora.**

| | Mora 2T26 | Trimestre previo | Un año antes | Cobertura | Dirección |
|---|---|---|---|---|---|
| **GGAL grupo** | **10,6%** | 9,6% | 5,5% | **93,3%** (era 117,9%) | empeora |
| GGAL banco solo | 8,3% | 7,7% | 4,4% | 92,8% | empeora |
| Naranja X | **19,7%** | 16,7% | 8,7% | 94,1% | empeora |
| BMA | 6,25% | 5,40% | 2,06% | 95,4% | empeora |
| BBAR | 6,09% | 5,60% | — | **79,9%** (era 88,4%) | empeora |
| **SUPV** | **5,5%** | 5,6% | — | — | **mejora** |

Fuente primaria de GGAL: [Financial Report 2Q2026](https://b.gfgsa.com/app/uploads/2026/08/PressRelease_GrupoGalicia_2Q2026_EN.pdf).
De BMA: [6-K en SEC](https://www.sec.gov/Archives/edgar/data/0001347426/000110465926098837/tm2623626d1_6k.htm).
De SUPV: [6-K 2T26](https://www.stocktitan.net/sec-filings/SUPV/6-k-grupo-supervielle-s-a-current-report-foreign-issuer-c1d733c888c6.html).

Lo serio de GGAL no es el 10,6%: es que **la cobertura cayó de 117,9% a 93,3% en un año**. El colchón de previsiones
ya no cubre la cartera irregular. El matiz que lo salva en parte: la mora del grupo es de **Naranja X** (19,7%), no
del banco (8,3%), y el **cost of risk ya bajó** 154 pb contra el trimestre anterior — el stock todavía empeora, el
flujo ya no.

**Tres "mejoras" que no sobreviven sin extraordinarios:**

- **BMA**: Ps.21.900 millones de cargos de reestructuración y **18 sucursales cerradas** en el trimestre.
- **SUPV**: AR$36.000 millones de indemnizaciones, **segundo trimestre consecutivo** (~AR$75.000 M combinados), y
  **guía de crédito recortada de ">20%" a 10-15%**: menos de la mitad de lo prometido.
- **IRS**: de los ARS 420.977 M de utilidad del ejercicio, **ARS 193.797 M son revaluación no-cash de propiedades**
  (contra −3.338 M el año anterior). **Es ~46% de la ganancia.** Sin eso, el +60,7% no existe.

**Lo único bueno del sector, y es del sistema, no de un banco:** la mora agregada se mantuvo en **7,7% en agosto** y
la de familias bajó de 12,9% a 12,8%. Primer mes sin deterioro agregado
([BCRA, Informe sobre Bancos](https://www.bcra.gob.ar/archivos/Pdfs/PublicacionesEstadisticas/informes/informe-bancos-2026-07.pdf)).

**Otros hechos con dientes:**

- **TEO — la fusión con Telefónica viene condicionada y con reloj.** El Tribunal de Defensa de la Competencia aprobó
  la compra imponiendo **ceder 6 millones de clientes móviles en menos de 2 años** (4 M en AMBA), **devolver 130 MHz
  de espectro** (60 MHz inmediatos) y ceder cuentas de internet fijo donde supere el 50% retail. Resolución publicada
  el **19/6/2026** ([La Nación](https://www.lanacion.com.ar/economia/el-gobierno-condiciono-la-aprobacion-de-la-compra-de-telefonica-por-parte-de-telecom-a-que-ceda-6-nid17062026/)).
  Son ~40% de la cartera móvil. **Cualquier valuación que cuente esos clientes como adquiridos y retenidos está mal.**
- **LOMA — el horno de L'Amalí sigue apagado.** El apagón declarado en mayo corre **hasta noviembre de 2026**, por
  caída de la construcción y costos de gas, con >700.000 t de clínker acumuladas
  ([Infobae 12/5](https://www.infobae.com/economia/2026/05/12/loma-negra-golpeada-por-la-caida-de-la-actividad-la-cementera-mas-grande-del-pais-apagara-su-principal-horno-hasta-noviembre/)).
  **No hay ninguna comunicación de la empresa que confirme el reencendido.** Y los despachos de cemento cayeron 5,1%
  en agosto contra julio. Es el deterioro más concreto del Radar argentino: no es precio, es un horno apagado.
- **EDN — se endeudó fuerte para comprar un activo que todavía no tiene.** Tomó **USD 750 M al 9,50% con vencimiento
  28/4/2033** más **USD 213,5 M al 7,5% a julio de 2029**, ~USD 1.700 M de financiamiento asegurado, para pagar
  Metrogas. El cierre **depende del regulador**.
- **VIST — el crecimiento es en buena parte inorgánico.** Producción 2T26 **156.061 boe/d, +32% a/a**, pero **12 de
  esos 32 puntos vienen de consolidar el 25,1% de Bandurria Sur** comprado a Equinor en mayo. El EBITDA +99% tiene la
  misma explicación. Guía subida a ~158.000 boe/d, capex USD 1.800 M y EBITDA ~USD 3.000 M — que es exactamente el
  único hecho argentino que la app tiene cargado, y **coincide**. El 22/9 reabrió **USD 400 M** de las notas 7,875%
  a 2038, cierre el 9/10 ([6-K](https://www.sec.gov/Archives/edgar/data/1762506/000119312526398099/d158957d6k.htm)).
- **Tarifas de octubre:** ENReGE Resolución 721/2026, desde el 1/10: **Edenor +2,41%**, Edesur +2,34%, gas residencial
  **+2,46% promedio**. No hubo audiencia pública ni revisión tarifaria nueva en septiembre u octubre: lo que se mueve
  son ajustes mensuales por índice dentro de revisiones ya cerradas.
- **Dato de infraestructura regulatoria, para la app:** desde **mayo de 2026 el ENReGE absorbió al ENRE y al
  ENARGAS**. Cualquier importador de hechos que busque resoluciones de "ENRE" o "ENARGAS" va a dejar de encontrar
  actos a partir de esa fecha.

**Única fecha de reporte del 3T confirmada por una empresa en todo el frente: YPF, 29/10/2026.** Para los otros doce
no hay fecha anunciada; lo que circula son estimaciones de proveedores.

---

## 4. Los dos que pasan el filtro, y por qué ninguno es una compra

| Símbolo | Cierre | vs SMA200 | FR 3m vs Merval | FR 6m | ATR | Franja | Stop | Objetivo | En USD al CCL |
|---|---|---|---|---|---|---|---|---|---|
| **METR.BA** | 2.287 | +7,71% | **+45,9%** | +30,2% | 4,30% | 2.287 – 2.332,74 | 2.217,27 | 2.426,46 | 1,4084 |
| **BOLT.BA** | 63,60 | +34,86% | **+60,1%** | +51,7% | 2,65% | 63,60 – 64,87 | 61,36 | 68,08 | 0,0392 |

Todos esos números salen del comando de la app. La búsqueda no produjo ni un precio.

**El hallazgo del día: los dos están pasando el filtro por una operación societaria, no por su negocio.** El filtro
técnico lee tendencia. Lo que hay detrás de las dos filas es una compra de control en curso. Son arbitraje de fusión
disfrazado de momentum.

### METR.BA — Metrogas: cambio de control pendiente, sin OPA lanzada

Verificado en fuente primaria, el [6-K de Edenor del 10/8/2026](https://www.sec.gov/Archives/edgar/data/0001395213/000129281426004170/edn20260810_6k1.htm):
EDENOR acordó comprarle a **YPF** el **70% de MetroGAS** (290.277.316 Clase A + 108.142.529 Clase B) y el 5% de
MetroENERGÍA por **USD 780 millones**, sujeto a *"the applicable regulatory approvals, including the approval of the
Ente Nacional Regulador del Gas y la Electricidad"*. Hecho relevante a la CNV el 11/8/2026.

**Tres eventos con fecha explican la suba, y ninguno es la tarifa:**

| Fecha | Qué pasó |
|---|---|
| 14/7/2026 | **Primer dividendo en 25 años** (ARS 100.000 M) |
| 10/8/2026 | Venta del control a USD 780 M, 39% sobre la valuación del proceso. **La acción saltó 15% ese día** |
| 29/9/2026 | **Prórroga de la licencia por 20 años más desde el 28/12/2027, o sea hasta 2047** |

La prórroga es el hecho estructural y es de la semana pasada. Metrogas informó a la CNV que firmó con el Ministerio de
Economía el Acuerdo de Prórroga, habilitado por el art. 6° de la Ley 24.076 modificado por la Ley Bases. Contrapartidas:
**desistimiento de todos los reclamos, recursos y acciones** en sede administrativa, arbitral y judicial, y
**compromiso de inversión de USD 186,8 millones en diez años**
([La Nación 29/9](https://www.lanacion.com.ar/economia/prorrogan-por-20-anos-la-licencia-de-metrogas-nid29092026/)).
Sin esa prórroga la licencia moría el 28/12/2027 y la ley obligaba a licitar en 90 días: **eso era lo que frenaba la
venta.** Antes, el 8/9, la Resolución 1469/2026 del Ministerio de Economía había suspendido la orden de desinversión
que YPF arrastraba desde 2016.

La tarifa es el piso, no el catalizador: la revisión quinquenal se aprobó en **abril de 2025** y el incremento es
**16,53% real en 31 cuotas**, ~0,5% por mes.

**Lo que falta, y es todo:**

| Condición para que cierre | Estado al 5/10 |
|---|---|
| Decreto del PEN ratificando la prórroga | **pendiente** (el acuerdo es *ad referéndum* del PEN) |
| Asamblea Extraordinaria de accionistas | **convocada para el 29/10/2026, 10:00** |
| Aprobación del ENRGE al ingreso de Edenor como controlante | **pendiente, sin fecha** |

**Y no hay OPA.** Ni lanzada, ni con precio. El 6-K de Edenor no la menciona, y la lista completa de hechos relevantes
de Metrogas de 2026 (29/1, 26/2, 20/3, 3/6, 14/7, 11/8, 29/9 — nada en octubre) no contiene ningún anuncio de oferta
pública. Lo único que existe es prensa diciendo que "sigue pendiente". **Eso es expectativa, no compromiso.**

La aritmética del hueco: USD 780 M ÷ 398.419.845 acciones = **USD 1,958 por acción** de control, o **USD 1.114 M** por
el 100% del equity. La capitalización de hoy es ~**USD 840 M**. **El mercado paga 0,75x el valor implícito del
paquete: hay un 32,6% de hueco.** Pero ese 32,6% se cobra **solo si** hay OPA y **solo si** el precio equitativo se
fija cerca del precio de control. **Ninguna de las dos cosas está confirmada**, y no se verificó si la Ley 26.831 la
vuelve obligatoria en este caso. Es la incógnita central, no un detalle.

**Liquidez: alcanza.** ~274.000-308.000 nominales/día ≈ **ARS 628-706 M ≈ USD 405-455 k por día**. Entra una posición
de cartera sin mover el precio.

**La advertencia de medición, que es la más importante para la app.** Variaciones **absolutas** de METR al 2/10:

| 1 mes | 3 meses | 6 meses | 2026 | 12 meses |
|---|---|---|---|---|
| **−4,19%** | +16,33% | +9,16% | **−10,23%** | +68,04% |

Rango de 52 semanas 1.300 – 2.890: el papel está **21% debajo de su máximo** y **cae 10,2% en el año**.

La app muestra **fuerza relativa a 3 meses de +45,9%**. El movimiento absoluto es **+16,33%**. La diferencia es el
Merval cayendo ~20% en pesos en el trimestre. **Dos tercios de ese +45,9% son el índice bajando, no METR subiendo.** Y
en el último mes METR está en rojo y debajo de su media de 21 ruedas (2.335,95).

La fila te da fuerza relativa sin el retorno absoluto al lado. Un +45,9% se lee como una tendencia potente; el papel
subió 16% en tres meses y bajó 4% en el último.

### BOLT.BA — Boldt: una OPA de ARS 70, y el papel ya está en 63,60

**No es una tesis de negocio: es una sucesión.** Murió Antonio Tabanelli el 25/6/2025 y la mayoría quedó partida casi
en mitades entre los dos herederos (45,91% y 46,36%). Antonio Eduardo le compra todo a su hermana y pasaría a
**~92,27%** del capital y los votos. Anunciado a la CNV el 13/8 y detallado el 19/8/2026.

Al resto del mercado le ofrecen dos caminos, que **hoy valen lo mismo**:

- **Efectivo, OPA voluntaria: ARS 70,00 por acción, precio fijo**, hasta 523.917.383 acciones. Prima ~60% sobre el
  promedio del semestre previo. **Sin umbral mínimo de aceptación.**
- **Canje por B-Gaming**: 0,194444 acciones de B-Gaming por cada Boldt, valuando B-Gaming en ARS 360. Y GAMI cotizaba
  exactamente **ARS 360,00** el 5/10 → 0,194444 × 360 = **70,00**.

**El upside visible es ARS 70 contra ARS 63,60: +10,06%. Eso es todo.** Y el papel ya está contra su máximo de 52
semanas (66). El mercado descontó casi toda la operación. Encima, **la autorización de la CNV no está confirmada**:
falta el prospecto definitivo.

**Liquidez: no alcanza.** ~**ARS 21-23 M/día ≈ USD 13-15 k por día**. En la rueda del 5/10, hasta las 12:40, operó
ARS 8,98 millones: **unos USD 5.800 en toda la rueda**. Una posición de USD 5.000 es un tercio del volumen diario del
papel. **METR es ~30 veces más líquido que BOLT.** Entrar y salir mueve el precio contra vos, y si la OPA se cae,
baja sin contraparte.

**Y hay dos vencimientos de concesión dentro de los próximos 15 meses**, del balance auditado al 31/10/2025
([EEFF Boldt](https://www.boldt.com.ar/wp-content/uploads/2026/02/Boldt-S.A.-EEFF-31.10.2025-Completo-Legalizado.pdf)):

| Concesión | Vence | Peso |
|---|---|---|
| Permiso de juego online en **CABA** (LOTBA) | **~diciembre de 2026** (5 años desde el inicio de operaciones, prorrogable 5; **fecha exacta sin confirmar**) | chico |
| Tres salas de PBA: **Mar de Ajó, Hotel Sasso, Sierra de la Ventana** | **31/12/2026**, a 87 días | chico |
| Online en **PBA (bplay)** | ~enero de 2036 | **~61% de los ingresos** |
| Casino de **Tigre (Trilenium)** | ~agosto de 2041 | — |
| Hermitage, Tandil, Miramar | ~2046 (contrato firmado 27/8/2026) | — |

La concentración es el dato: el juego online es el **72,8% de la facturación** y **PBA es el 84,2% de ese online**.
O sea ~61% de los ingresos cuelgan de una sola licencia, que corre a 2036. Los dos cliffs de corto plazo pesan poco
en ingresos, pero son los únicos con fecha dentro de los próximos quince meses.

### Lo que esto significa para las dos filas

**La pantalla hace lo correcto y los muestra como CANDIDATA, no COMPRAR**, con el detalle *"el plan en dólares no
compra papeles argentinos"*. La regla de que COMPRAR significa una sola cosa está respetada.

Pero conviene decir lo que la app no puede decir: **ninguno de los dos es una posición de cartera.** METR es un
arbitraje sobre una OPA que no existe todavía, con el regulador sin fecha; BOLT es un arbitraje de 10% en un papel que
mueve USD 14.000 por día. Y los dos se miden contra un índice que cayó 14% en dólares en un mes, lo que infla la
fuerza relativa que los habilitó.

---

### El resto del panel local: la liquidez es el filtro que la app no tiene

Medido sobre 66 ruedas, del 6/7 al 5/10/2026, mediana de cierre × volumen:

| Papel | Nominales/día (mediana) | ARS/día (mediana) | ≈ USD/día | % de GGAL.BA | Veredicto |
|---|---|---|---|---|---|
| **METR.BA** | ~274.000-308.000 | 628-706 M | **405-455 k** | — | **operable** |
| **VALO.BA** | 1.110.832 | 652 M | **428 k** | 4,6% | **líquido** |
| **CVH.BA** | 13.586 | 126 M | **83 k** | 0,89% | fino |
| **AGRO.BA** | 1.051.254 | 40 M | **26 k** | 0,28% | **ilíquido en pesos** |
| **BOLT.BA** | ~326.000-367.000 | 21-23 M | **13-15 k** | — | **ilíquido** |
| **MOLI.BA** | 8.474 | 20 M | **13 k** | 0,14% | **ilíquido** |
| **LEDE.BA** | 14.774 | 11,5 M | **7,6 k** | 0,08% | **muy ilíquido** |

Referencia: **GGAL.BA mueve ARS 14.113 millones por día** en la misma ventana. Los siete locales juntos no llegan a
ARS 1.500 millones.

El caso de AGRO muestra por qué la medida correcta es el ticket en pesos y no los nominales: opera más de un millón de
acciones por día y parece líquido, pero cotiza a ARS 35-37, así que son **USD 26.000 diarios**.

**Esto es lo que más le falta a la tabla local: la app no mide liquidez para los papeles argentinos.** Para los ADRs
sí lo hace —`/cartera/risk` trae `avgDollarVolume30d` y `daysToLiquidate` por posición— pero la fila de BYMA no tiene
ninguna de las dos. Una fila que dice CANDIDATA en un papel que mueve USD 7.600 por día está técnicamente bien y es
inservible en la práctica.

**Propuesta:** calcular y mostrar en la tabla local el volumen en pesos y su equivalente en dólares al CCL, con una
bandera cuando el papel no soporte el tamaño típico de una posición del plan. Caso de prueba: LEDE.BA con ARS 11,5 M
diarios debe salir marcado; VALO.BA con ARS 652 M, no.

---

## 5. Tu cartera, medida

Total **USD 141.878,47** al cierre del 2/10.

| Papel | Peso | Valor USD | Cierre | Stop | Ganancia | Veredicto | Beta vs SPY |
|---|---|---|---|---|---|---|---|
| GGAL | **23,29%** | 33.047 | 35,89 | 41,75 | +3,49% | **VENDER** | 1,01 |
| PAM | **19,77%** | 28.045 | 76,39 | 81,68 | +4,08% | **VENDER** | −0,07 |
| YPF | **19,51%** | 27.684 | 49,67 | 52,13 | +63,18% | **VENDER** | −0,75 |
| VIST | **10,50%** | 14.902 | 64,25 | 71,22 | +49,33% | **VENDER** | −1,15 |
| HUT | 9,45% | 13.414 | 89,63 | 88,39 | +34,41% | REVISAR | 2,76 |
| TSM | 8,84% | 12.542 | 472,78 | 444,20 | +25,67% | REVISAR | 1,87 |
| MARA | 5,01% | 7.102 | 11,23 | 11,48 | +42,36% | VENDER | 3,27 |
| NEM | 3,62% | 5.142 | 115,56 | 118,87 | +3,65% | VENDER | 1,70 |

Concentración, con los avisos que ya emite la app: **tema argentina 73,07%**, **petróleo y gas 49,78%**, **país AR
62,57%** (VIST cuenta como México). Los tres pasan el umbral del 40%. HHI por país 4.430.

Volatilidad de la cartera **29,11%** contra 11,03% del SPY. Peor día −4,49%. R² contra el SPY **0,052**: la cartera
casi no se explica por el mercado estadounidense, se explica por Argentina.

**Las cuatro argentinas están bajo stop al mismo tiempo.** Correlación PAM-YPF 0,70.

### El rebote de hoy no cambia ningún veredicto

Precios vivos del 5/10, 15:38 UTC:

| Papel | Precio | Día | Stop | ¿Recuperó el stop? |
|---|---|---|---|---|
| GGAL | 37,68 | **+4,90%** | 41,75 | **no**, falta +10,8% |
| PAM | 78,70 | **+3,31%** | 81,68 | **no**, falta +3,8% |
| YPF | 51,22 | **+3,12%** | 52,13 | **no**, falta +1,8% |
| VIST | 65,94 | **+2,46%** | 71,22 | **no**, falta +8,0% |

YPF es el que está más cerca: a 1,8% de volver a tener tesis técnica.

### El plan vigente de octubre: cero líneas argentinas

Armado hoy 15:30, USD 40.000 en 3 tramos.

| Línea | Tipo | USD | Tramo | Estado de entrada |
|---|---|---|---|---|
| VTI | núcleo | 14.400 | 4.800 | a mercado |
| VEA | núcleo | 6.000 | 2.000 | a mercado |
| VWO | núcleo | 3.600 | 1.200 | a mercado |
| APH | comprar | 4.486 | 1.495 | `esperar_retroceso`, orden limitada 81,91 |
| HCI | comprar | 4.030 | 1.343 | **`en_zona`** |
| MUSA | comprar | 3.759 | 1.253 | `esperar_confirmacion` arriba de 524,14 |
| LLY | comprar | 3.725 | 1.241 | `esperar_confirmacion` arriba de 1.215 |

Hoy se ejecutan **USD 28.030 de 40.000**; los otros 11.970 esperan su nivel. **USD 24.000 van al núcleo**, que está
en 0% de la cartera — que es exactamente el remedio para una cartera 73% concentrada.

Controles: 18 avisos y **2 graves**, los dos por desfase de precio vivo (ATLC y UFPT). **Ninguno es argentino ni está
en el plan**, así que no degradan esta conclusión. Revisión antes de comprar pendiente en APH, HCI, MUSA y LLY.

---

## 6. Lo que la app no ve, y lo que ve mal

### Dos defectos reales

**D1 — La serie de riesgo país está corrida un día hábil entera.**

`macroAr` en [argentina.ts](../../packages/core/src/radar/argentina.ts) guarda el valor con la fecha de la corrida
(`date: i.date`) y descarta la fecha que devuelve la fuente. Resultado: cada punto de la serie lleva la fecha
equivocada.

| Fecha en la app | Valor en la app | Fuente, misma fecha | Fuente, día hábil anterior |
|---|---|---|---|
| 2026-09-22 | 533 | 555 | **533** |
| 2026-09-25 | 578 | 609 | **578** |
| 2026-09-29 | 628 | 607 | **628** |
| 2026-10-02 | 636 | 655 | **636** |
| 2026-10-05 | 655 | — | **655** (del 2/10) |

Coincide con el día hábil anterior en **20 de 20** fechas comparables. Y la pantalla lo empeora:
[Radar.tsx:395](../../apps/web/src/Radar.tsx) muestra el número con un delta *"vs {prev.date}"*, así que hoy dice
**"655 · +3,0% vs 2026-10-02"** cuando la verdad es *655 el 2/10 contra 636 el 1/10*. **Las dos fechas están mal.**

El arreglo ya existe en la misma función, para el campo de al lado: `mervalDate` se agregó el 12/9 precisamente
porque *"el Merval en dólares del encabezado mezclaba el índice del 10 con el CCL del 11 y la pantalla lo mostraba
como un solo número del día"*. Al riesgo país le falta el mismo tratamiento.

**Propuesta:** `parseRiesgoPais` ya devuelve `{ value, date }` y el adaptador ya la trae. Guardar esa fecha en
`MacroAr` como `riesgoPaisDate`, y que la pantalla la muestre igual que `mervalDate` en vez de afirmar que es de hoy.
Test: con `date: "2026-10-05"` y un riesgo país fechado `2026-10-02`, la fila debe decir 2/10 y no 5/10.

**D2 — El objetivo queda debajo del precio en 6 de 8 posiciones, y llega a la pantalla.**

`holdTargetOf` calcula `cierre + 2 × (cierre − stop)` sin guarda. Cuando el precio está **bajo** el stop, el
resultado queda **debajo del precio**:

| Papel | Veredicto | Precio | Stop | "Objetivo" |
|---|---|---|---|---|
| VIST | VENDER | 64,25 | 71,22 | **50,31** |
| YPF | VENDER | 49,67 | 52,13 | **44,75** |
| GGAL | VENDER | 35,89 | 41,75 | **24,17** |
| PAM | VENDER | 76,39 | 81,68 | **65,81** |
| NEM | VENDER | 115,56 | 118,87 | **108,94** |
| MARA | VENDER | 11,23 | 11,48 | **10,73** |

[Cartera.tsx:227](../../apps/web/src/Cartera.tsx) renderiza la columna `objetivo` en todas las filas sin excluir las
que están bajo el stop. La fila de VIST te muestra hoy: **VENDER, stop 71,22, objetivo 50,31**, con el papel en
64,25 y +49% de ganancia. El tooltip explica la fórmula, pero una columna que dice "objetivo" con 50,31 al lado de un
precio de 64,25 se lee como un objetivo de baja.

**Este arreglo ya está escrito, en otro archivo.** `decideArStock`, misma carpeta, hace
`target: belowStop ? null : computeTarget(close, stop)` — y el comentario explica por qué: *"con el stop ARRIBA del
precio devuelve un objetivo por DEBAJO del precio, y la pantalla publica un boleto imposible"*. Se arregló el 12/9
para los papeles argentinos y quedó sin arreglar para la cartera.

**Propuesta:** `holdTargetOf` devuelve `null` cuando `close <= stop`. Test con el caso real de VIST: cierre 64,25,
stop 71,22 → `null`, y la pantalla muestra un guión, no 50,31.

### Cuatro huecos de datos

**H1 — ILF está etiquetado tema "argentina" y Argentina pesa cero.**

`config/etfs.json` lo define con `exposure: "emergentes"` y `themes: ["argentina"]`, y `config/taxonomia.json` lo
mapea a `["argentina"]`. Es el **iShares Latin America 40**: Brasil 59,10%, México 25,28%, Chile 6,79%, Perú 5,79%,
Colombia 2,36% al 31/3/2026 ([ficha oficial](https://www.ishares.com/us/literature/fact-sheet/ilf-ishares-latin-america-40-etf-fund-fact-sheet-en-us.pdf)).
**Argentina: esencialmente cero.** Si entrara a la cartera, contaría 100% como concentración argentina y el aviso de
concentración diría algo falso. Hoy ya aparece en el Radar con la etiqueta puesta.

**Propuesta:** quitarle el tema `argentina` a ILF y dejarlo en `emergentes` / latam. ARGT sí es Argentina y se queda
como está.

**H2 — Ningún hecho argentino puede mover nada, y la causa está en una línea de config.**

El síntoma: de **128 hechos cargados, 1 es argentino** (0,8%) — la guía reafirmada de VIST del 17/7, que además está
bien: coincide con lo que reportó la empresa.

La causa raíz, verificada: `config/hechos-fuentes.json` tiene **14 hosts primarios y ninguno es argentino.**

```
sec.gov · fda.gov · cms.gov · ferc.gov · nrc.gov · federalregister.gov · whitehouse.gov
justice.gov · ftc.gov · bis.gov · bis.doc.gov · prnewswire.com · globenewswire.com · businesswire.com
```

No está la CNV, ni el Boletín Oficial, ni el BCRA, ni el INDEC, ni argentina.gob.ar (donde publica el ENReGE).

Y eso no es cosmético. [hechos.ts](../../packages/core/src/radar/hechos.ts) lo dice en su propio encabezado:
*"sólo lo VERIFICADO mueve algo. Verificado = la fuente es primaria (un host de la lista de config)"*.
`clasificarHecho` asigna `estado: primaria ? "verificado" : "no_verificado"`, y hay reglas que filtran por
`estado === "verificado"`.

**Consecuencia exacta, sin exagerar:** un hecho con fuente en la CNV o en el Boletín Oficial **no se rechaza** —
`hechosVigentes` muestra lo no verificado a propósito— pero queda `no_verificado` y **por diseño no mueve ninguna
decisión.** Con la cartera 73% argentina, la CNV es el equivalente argentino de la SEC y está tratada como un portal.

**Los casos de esta corrida que un hecho habría cambiado, todos de las últimas seis semanas:**

| Papel | Hecho | Qué muestra la app |
|---|---|---|
| **METR.BA** | cambio de control por USD 780 M (6-K Edenor 10/8) y **prórroga de licencia a 2047** firmada el 29/9 | CANDIDATA por tendencia, sin un solo hecho |
| **MOLI.BA** | **cuatro hechos relevantes en seis semanas**: cierre de la compra de Bodega Etchart (31/8), venta de los activos de Santa Clara, Rosario a Eliantus con USD 100 M de compromiso (1/9), y compra del Complejo Alimenticio San Salvador para entrar al negocio de galletitas (11/9) | OBSERVAR, sin hechos |
| **BOLT.BA** | OPA de ARS 70 por una sucesión familiar (CNV 13/8 y 19/8) | CANDIDATA por tendencia, sin hechos |
| **TEO** | obligación de ceder 6 M de clientes móviles en menos de 2 años (resolución del 19/6) | OBSERVAR por precio |
| **LEDE.BA** | **pérdida de ARS 18.437 M** en el ejercicio cerrado el 31/5/2026, absorbida con reserva facultativa, sin dividendo; y remuneración al Directorio de **ARS 5.998 M en exceso del límite del art. 261 LGS** por ser ejercicio con quebranto (Acta 151 de la asamblea del 17/9) | OBSERVAR por precio |
| **AGRO.BA** | ganancia del semestre **−62,6% interanual** (ARS 703 M contra 1.880 M), golpeada por el RECPAM que se cuadruplicó; y **tres cambios de gerencia en 18 meses**, el último el 30/9 | OBSERVAR por precio |

**Propuesta, y es de una línea:** agregar a `hostsPrimarios` los hosts argentinos equivalentes —`cnv.gov.ar`,
`boletinoficial.gob.ar`, `bcra.gob.ar`, `indec.gob.ar`, `argentina.gob.ar`. Test: un hecho con fuente en
`aif2.cnv.gov.ar` debe clasificar `verificado`, igual que uno de `sec.gov`.

**Pendiente de verificar antes de implementar el barrido:** la vía que propuso la búsqueda es
`cnv.gov.ar/SitioWeb/Empresas/Empresa/<CUIT>`, que devolvería HTML server-rendered con las tablas "HECHOS RELEVANTES",
"Estados Contables" (con `FECHA CIERRE` y `PERIODICIDAD`, o sea el cierre de ejercicio real) y "Última Información
Recibida"; más `ws.bolsar.info/descarga/?id=N` para los PDF sin sesión. **No pude comprobarlo yo: la CNV no responde
desde este entorno (HTTP 000).** Hay que probarlo desde la máquina antes de construir nada encima.

Dos cuidados que la búsqueda dejó anotados y conviene respetar si se implementa:

- **Validar el CUIT contra el nombre que devuelve la ficha.** Una búsqueda devolvió un CUIT para "Cablevisión
  Holding" que resultó ser de EDEMSA.
- **No ingerir el feed de noticias de rava para LEDE.** Mezcla notas sobre el pueblo español de Ledesma (incendios en
  Salamanca, carreteras en Zamora). Son falsos positivos puros.

Y un dato que cambia una regla: **Ledesma cierra ejercicio el 31 de mayo**, no en diciembre. Cualquier regla de
"resultados cerca" que asuma cierres de diciembre se equivoca con LEDE.

**H3 — La fila local muestra fuerza relativa sin el retorno absoluto al lado.**

Caso real de hoy, METR.BA:

| Lo que muestra la app | Lo que pasó de verdad |
|---|---|
| fuerza relativa 3m **+45,9%** | retorno absoluto 3m **+16,33%** |
| fuerza relativa 6m **+30,2%** | retorno absoluto 6m **+9,16%** |
| — | último mes **−4,19%**, debajo de su media de 21 ruedas |
| — | **2026: −10,23%**, y 21% debajo de su máximo de 52 semanas |

La diferencia es el Merval, que cayó ~20% en pesos en el trimestre y 14,1% en dólares en un mes. **Dos tercios de ese
+45,9% son el índice bajando, no METR subiendo.**

El cálculo no está mal: la fuerza relativa es lo que dice ser, y comparar contra el Merval es la decisión documentada.
El problema es de lectura: **un +45,9% en una columna sin contexto se lee como una tendencia potente**, y el papel cae
en el mes y en el año. En un índice que se derrumba, la fuerza relativa de todo el panel se infla a la vez.

**Propuesta:** mostrar el retorno absoluto del período al lado de cada fuerza relativa en la tabla local, y/o una
bandera cuando la fuerza relativa es mayormente caída del índice (por ejemplo, retorno absoluto del período menor que
la mitad de la fuerza relativa). Test con el caso de METR: FR 3m +45,9% y absoluto +16,33% debe salir marcado.

**H4 — La tabla local no mide liquidez, y la de ADRs sí.**

Está desarrollado en el punto 4 con los números de las siete ruedas medidas. El resumen: `/cartera/risk` trae
`avgDollarVolume30d` y `daysToLiquidate` para cada posición, y la fila de BYMA no tiene ninguna de las dos. LEDE.BA
mueve **USD 7.600 por día** y BOLT.BA **USD 13-15 mil**; los dos aparecen en la tabla sin ninguna advertencia. Un
CANDIDATA en un papel así está bien calculado y es inservible.

### Una observación de diseño, no un defecto

La fila macro es una **foto de la mañana, no un dato vivo**. La app capturó CCL 1.623,8 y brecha 5,44%; la fuente
ahora da **1.611,5** y la brecha real es **4,64%**. La fecha está bien (la fuente marca 5/10) y los dólares se piden
en vivo por diseño; lo que envejece es el valor dentro del día. Vale saberlo antes de leer "brecha máxima del tramo"
en un número de las 11 de la mañana.

### Lo que se verifica en la corrida siguiente

- Que el riesgo país muestre la fecha de su dato, no la de la corrida.
- Que ninguna fila con el precio bajo el stop publique un objetivo.
- Que ILF no cuente como Argentina.
- Que METR.BA tenga cargado el hecho del cambio de control y la prórroga de licencia a 2047, o que la fila diga que no
  lo sabe. Y BOLT.BA, la OPA de ARS 70.
- Que la tabla local muestre el retorno absoluto junto a la fuerza relativa.
- Si para entonces el ENRGE aprobó el cambio de control de Metrogas y si se lanzó una OPA: eso convierte a METR.BA en
  una historia distinta, o en ninguna.

---

## 7. Lo descartado, con su motivo

| Qué | Cuántos | Motivo |
|---|---|---|
| ADRs argentinos | **13 de 13** | todos `bajo_stop`; 12 además `bajo_sma200`. La app: *"la tesis técnica ya se anuló"* |
| VIST | 1 | `bajo_sma200` y `bajo_stop`, pese a guía subida y consenso de compra |
| GLOB, MELI | 2 | `bajo_sma200` |
| Acciones locales de BYMA | 16 de 18 | `bajo_sma200`, `bajo_stop` o fuerza relativa negativa contra el Merval |
| ETF ARGT | 1 | `bajo_sma200`, `bajo_stop`, FR 6m −23,4% |
| ETF ILF | 1 | FR 6m negativa contra el SPY. Además **mal etiquetado** (ver H1) |
| METR.BA | — | pasa el filtro, pero es **arbitraje sobre una OPA que no existe**: ENRGE sin fecha, decreto del PEN pendiente, y dos tercios de su fuerza relativa es el Merval cayendo |
| BOLT.BA | — | pasa el filtro, pero **+10% de upside ya descontado** y **USD 13-15 k de volumen diario**: una posición de USD 5.000 es un tercio de la rueda |

Por la búsqueda, y no por la app, además descartaría hoy:

- **TEO**: la obligación de ceder ~40% de la cartera móvil en menos de 2 años no está en ningún número de la app.
- **IRS y CRESY**: el 46% de la ganancia de IRSA es revaluación no-cash, y Cresud consolida IRSA.
- **LOMA**: el horno principal apagado hasta noviembre, sin confirmación de reencendido, y despachos −5,1%.
- **GGAL**: cobertura de 117,9% a 93,3% en un año. Y ya la tenés con 23,29% de la cartera.

---

## 8. Lo que yo haría con esto

No es una recomendación de compra: **COMPRAR lo dice el plan, con monto**, y el plan de hoy no tiene nada argentino.
Es la lectura de lo medido.

1. **No agregar Argentina.** Ni un ADR, ni el ETF, ni los dos locales. Trece de trece bajo stop, el único con puntaje
   lo tiene negativo, y ya tenés 73%. Los dos locales que pasan el filtro **no son inversiones, son arbitraje de
   fusión**: METR depende de una OPA que no se lanzó y de un regulador sin fecha; BOLT ofrece 10% en un papel que
   mueve USD 14.000 por día. Ninguno de los dos justifica sumar exposición argentina sobre 73%.
2. **Las cuatro VENDER son una sola decisión y es tuya.** La app las marca por regla: las cuatro perforaron su stop.
   Lo que la app no te dice, y los hechos sí: **las cuatro cayeron por la misma causa externa**, no por sus negocios
   — y el frente externo argentino (superávit, reservas, banda) está mejor que en años. Lo que empeoró es el precio
   del riesgo de 2027. Si vendés las cuatro, realizás +63% en YPF y +49% en VIST; si no, aceptás que la decisión la
   toma octubre de 2027.
3. **El núcleo es el remedio y ya está en el plan.** USD 24.000 de 40.000 a VTI/VEA/VWO con el núcleo en 0%. Es lo
   único de hoy que baja el 73% sin tener que acertar nada.
4. **Dos fechas para anotar**: el **2/11** vence la respuesta en el certiorari de YPF, y el **28/10** es el FOMC. Y la
   aprobación de la tercera revisión del FMI **no tiene fecha** — es el catalizador binario del mes.
5. **El arreglo con mejor relación esfuerzo/resultado es agregar las fuentes argentinas a `hostsPrimarios`.** Es una
   línea de config. Hoy la app tiene 73% de la cartera en un país cuyo regulador de valores no cuenta como fuente
   primaria, y esta corrida encontró seis hechos de las últimas seis semanas que habrían cambiado lo que muestran seis
   filas distintas.

---

## Lo que no se pudo verificar

- **El cierre del riesgo país de hoy 5/10.** No está publicado. El último dato es del 2/10.
- **La aprobación del ENRGE al cambio de control de MetroGAS**: no hay resolución, ni fecha, ni plazo estimado.
- **El decreto del PEN que ratifica la prórroga de licencia de Metrogas.** Contradicción sin resolver: el hecho
  relevante de la empresa del 29/9 dice *"ad referéndum del PEN"*, pero títulos de prensa del 30/9 dicen "el Gobierno
  prorrogó". **No se puede afirmar que el decreto esté firmado.**
- **Si la OPA a los minoritarios de METR.BA es obligatoria y a qué precio.** No se verificó el texto de la Ley 26.831
  ni la normativa de la CNV sobre precio equitativo. **Todo el hueco del 32,6% depende de esto.**
- **Si la CNV ya autorizó la OPA de ARS 70 de BOLT.BA** y si abrió el plazo de aceptación. Lo último confirmado es que
  requería prospecto definitivo.
- **La fecha exacta de vencimiento del permiso de juego online de Boldt en CABA.** Del balance auditado salen el plazo
  (5 años, prorrogable 5) y el inicio de operaciones (diciembre de 2021), no la fecha del permiso. Es el único cliff
  pre-2030 y quedó abierto.
- **El balance del 3T de Boldt al 31/7/2026**: la página de inversores solo publica hasta el ejercicio al 31/10/2025.
  Las cifras de nueve meses que circulan son de medios citando la reseña, sin abrir la fuente.
- **La vía de scraping de la CNV** (`cnv.gov.ar/SitioWeb/Empresas/Empresa/<CUIT>` y `ws.bolsar.info/descarga/?id=N`):
  no se pudo comprobar desde este entorno, la CNV devuelve HTTP 000. Hay que probarla desde la máquina.
- **Que la ANC haya aprobado a Metrotel** como comprador de los 6 millones de clientes móviles de Telecom (prensa del
  9 al 11/9). **Ni Telecom ni CVH presentaron hecho relevante en la CNV**, y la propia nota aclara que la ANC no había
  publicado el expediente. El precio tampoco está acordado. **No apto para decidir nada.**
- **Los nombres** del gerente que renunció en Agrometal el 30/9 y de los directores suplentes que renunciaron en CVH
  (18/9 y 14/8). Los hechos relevantes existen y están fechados; los nombres no son públicos.
- **El resultado operativo del primer semestre de Molinos**, y los precios de sus tres operaciones de las últimas seis
  semanas: ninguno fue informado.
- **La suba de guía de EBITDA 2026 de YPF a ~USD 8.000 M** desde ~6.000 M: aparece solo en resúmenes de terceros de
  la call, no en material de la empresa. **No usar como hecho.**
- **Siete 6-K de YPF de septiembre** (8, 8, 10, 15, 17, 21 y 28/9) sin revisar.
- **El monto exacto del desembolso de la tercera revisión del FMI**: 869, 900 o 1.000 M según la fuente.
- **El reencendido del horno de L'Amalí**: ni confirmado ni desmentido desde mayo.
- **El consenso contra el que falló LOMA y BBAR** en el 2T: no cuantificado.
- **El aumento de gas de octubre**: +2,46% o +2,24% según la fuente. No se leyó la resolución en el Boletín Oficial.

**Aviso de contaminación de fuentes, para el importador de hechos:** las búsquedas sobre "el BCRA vende dólares en el
techo de la banda" devuelven notas de **septiembre y octubre de 2025**, previas a las legislativas del 26/10/2025. No
aplican a 2026: hoy el BCRA **compra** y el mayorista opera 21% debajo del techo. Si un importador levanta esas
notas, carga un hecho falso con fecha equivocada.
