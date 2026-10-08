# Mercado — los cinco proveedores de reductores y rodamientos — 2026-09-30

Cinco nombres preguntados a mano: **Harmonic Drive, Moog, Nabtesco, Regal Rexnord y Timken**. Son la "pala" del
trade de robótica: quien vende el reductor, el actuador y el rodamiento en vez del robot.

Continuación de la corrida temática del 28/9 ([2026-09-28-robotica.md](2026-09-28-robotica.md)), que ya había
tocado a las cinco. Acá se las vuelve a pasar por la vara con datos de hoy, y se agrega **lo que esa corrida no
midió: la liquidez**, que en dos de los cinco es la que decide.

**Nada de este informe dice COMPRAR.** El plan vigente de hoy, armado a las 11:56 UTC —VTI, VEA, VWO, APH, AER,
LLY, SHC por 40.000 USD— **no tiene ninguno de los cinco** ([[feedback-comprar-un-solo-significado]]).

---

## El resultado en una línea

**Las dos que tienen la tecnología no se pueden comprar, y las dos que se pueden comprar no dicen robótica.**
Timken es la única de las cinco que sostiene la conversación, y hoy cierra por debajo de su franja de entrada y
sale 8ª de 11 contra sus pares.

---

## 1. La vara de la app, con datos de hoy

Corrida de sólo lectura (`mercado TKR RRX MOG.A HSYDF NCTKF`, sin `--guardar`), 30/9/2026:

| Símbolo | Veredicto | Riesgo | Puesto | En su grupo | Banderas | Cierre |
|---|---|---|---|---|---|---|
| **TKR** Timken | COMPRAR | 2 | 1.662 de 2.649 | 8 de 11 | `resultado_extraordinario` | 117,26 |
| **RRX** Regal Rexnord | **DESCARTADA** | — | 1.454 | — | `bajo_sma200` | 155,01 |
| **MOG.A** Moog | COMPRAR | 5 | fuera del universo | — | `sin_estados` | 387,59 |
| **HSYDF** Harmonic Drive | OBSERVAR | **7** | fuera del universo | — | `no_perseguir`, `sin_estados`, `subio_mucho_12m`, `lider_esperando` | 42,02 |
| **NCTKF** Nabtesco | OBSERVAR | 5 | fuera del universo | — | `sin_estados`, `stop_dentro_de_la_entrada` | 30,61 |

Las tres razones de exclusión, dichas por la app (`porque SÍMBOLO`):

- **TKR**: puesto 1.662, *"fuera de la preselección de 300, así que no se evalúa"*. El Radar no lo muestra.
- **RRX**: puesto 1.454, misma causa, y además lo descarta la etapa técnica por `bajo_sma200`.
- **MOG.A**: *"no está en el universo del barrido (sin fundamentales frescas, o no pasó el filtro de calidad)"*.

**TKR no está en zona.** La franja de entrada es 119,92 – 122,32 y cierra en 117,26. El boleto del 28/9 decía
"si cierra arriba de 119,92": no lo hizo en dos ruedas.

**La fila de Nabtesco está rota, no sólo fea.** `stop_dentro_de_la_entrada`: el stop (30,16) queda **arriba** de
la franja de entrada (28,71 – 29,00). No es ejecutable ni en el papel, y por eso sale sin objetivo ni tamaño.

---

## 2. Lo que la corrida del 28/9 no midió: la liquidez

Es el dato nuevo de este informe y el que decide dos de los cinco casos. Volumen mediano de las últimas 64 ruedas
(Yahoo, medido el 30/9/2026), llevado a dólares por día:

| Símbolo | Ruedas con volumen | Volumen mediano | USD por día | Posición que dimensionó la app | % del volumen de un día |
|---|---|---|---|---|---|
| **TKR** | 65 de 65 | 846.100 | **98.900.000** | 14.434 USD | 0,01% |
| **MOG.A** | 65 de 65 | 236.800 | **90.800.000** | 14.142 USD | 0,02% |
| **RRX** | 65 de 65 | 1.152.800 | **179.700.000** | — | — |
| **HSYDF** Harmonic Drive | 64 de 64 | 2.804 | **117.800** | 7.843 USD | **6,7%** |
| **NCTKF** Nabtesco | **9 de 64** | **0** | **0** | — | **no cotiza** |
| **NCTKY** ADR de Nabtesco | 64 de 64 | 1.987 | **30.700** | (14.800 típica) | **48%** |

**Nabtesco no tuvo una sola operación en 55 de las últimas 64 ruedas.** Su volumen mediano es cero. El ADR que sí
opera (NCTKY) mueve 30.700 USD por día: una posición del tamaño que usa el plan sería **la mitad del volumen
diario entero**.

**Harmonic Drive negocia 2.804 acciones por día** en un pink sheet. La posición que la propia app dimensionó
—7.843 USD, ya recortada por el riesgo 7— es el 6,7% del volumen de un día completo, con el spread que tiene una
hoja rosa. En la corrida de hoy el sistema directamente **no encontró rueda** para ninguna de las dos:

```
[history] NCTKF: sesiones vacías en el primario (2026-09-30) que el respaldo tampoco tiene: no hubo rueda
[history] HSYDF: sesiones vacías en el primario (2026-09-30) que el respaldo tampoco tiene: no hubo rueda
```

**La exclusión de la app por `exchange OTC` / `no operable` es correcta, y ahora está medida.** El 28/9 se dijo
"no son ejecutables"; hoy hay un número atrás.

---

## 3. Lo que cada empresa dice de sí misma

Todo este bloque viene del informe del 28/9, que lo sacó de documentos primarios. **No se re-verificó hoy**: lo
que cambió en dos ruedas es el precio, no el 8-K.

| Empresa | Lo que dice ella misma sobre su exposición a robótica | Fuente |
|---|---|---|
| **TKR** Timken | "puede direccionar **25-30% del bill of materials** de un humanoide"; automatización y robótica creció *high-single-digit*. Y textual: **"producción pre-comercial", "no son contratos escalados"** | [8-K 4/8/2026](https://www.sec.gov/Archives/edgar/data/0000098362/000009836226000048/tkrq22026exhibit991.htm). **La cita del BOM es de la conferencia Jefferies del 9/9/2026: secundaria, no verificada** |
| **RRX** Regal Rexnord | El 8-K menciona robótica **una vez**, como "frontera excitante". Lo más concreto del CEO: que se reunió con el CEO de una empresa de robótica y planea ir a Austin. Lo cuantificado del segmento de automatización es **datacenter**: switchgear 180 M USD en 2026, proyección 240-250 M en 2027 | [8-K 5/8/2026](https://www.sec.gov/Archives/edgar/data/0000082811/000008281126000226/a2q2026earningsannouncement.htm) |
| **MOG.A** Moog | Su comunicado **no menciona robótica ni automatización industrial en ninguna parte**. El +18% de su segmento industrial lo atribuye a **bombas de refrigeración para datacenters** | [8-K 31/7/2026](https://www.sec.gov/Archives/edgar/data/0000067887/000162828026051250/ex991-73126.htm) |
| **Harmonic Drive** 6324.T | Pedidos **+55,7%**, guía operativa anual subida 37%. Pero atribuye el salto a **semiconductores** además de robots, y ~12% de los pedidos fueron **órdenes médicas no recurrentes** | Resumen del *tanshin*. **No verificado contra el documento primario** |
| **Nabtesco** 6268.T | **Más del 60% del mercado mundial de reductores RV**, planta de Changzhou al 100% de utilización. Pero **puertas automáticas aportó casi tanto como los reductores de precisión** al crecimiento del semestre | Resumen del *tanshin*. **No verificado contra el documento primario** |

### 3.1 Las dos "jugadas de humanoides" no dijeron humanoide

RRX y Moog son las dos que la prensa vende como la exposición estadounidense a articulaciones de humanoides. En
sus propios documentos del 2T 2026, **ninguna de las dos menciona la palabra**. Las dos cuantifican lo mismo:
datacenter. Es el hallazgo negativo del 28/9 y sigue en pie.

### 3.2 Y donde está la tecnología, el motor declarado es semis

El matiz que desarma el relato incluso en Japón: Harmonic Drive dice **semiconductores**, Nabtesco crece por
**puertas automáticas** casi tanto como por reductores, y THK (6481.T, no preguntada acá) declara semis. **El que
compra máquina de precisión hoy es la industria de semiconductores, no la de robots.**

---

## 4. Un defecto de la app que salió mirando a Moog, y su arreglo

La corrida de la mañana dejó esta línea:

```
[history] MOG.A: primario falló (Error: HTTP 404 Not Found for https://query2.finance.yahoo.com/v8/finance/chart/), uso respaldo
```

**Causa:** el adaptador de Yahoo mandaba el símbolo tal cual. NYSE y Nasdaq separan con punto lo que Yahoo separa
con guion, y encima le cambian la letra. Comprobado contra la API el 30/9:

| Familia | Forma de NYSE/Nasdaq | Respuesta | Forma de Yahoo | Respuesta |
|---|---|---|---|---|
| Clase | `MOG.A`, `BRK.B`, `LEN.B`, `PBR.A` | **404** | `MOG-A`, `BRK-B`, `LEN-B`, `PBR-A` | 200 |
| Unidad | `AAC.U`, `AAC-U` | **404** | `AAC-UN` | 200 |
| Preferida | `ABR.PRD`, `ABR-PRD` | **404** | `ABR-PD` | 200 |
| Plaza | — | — | `GGAL.BA` (el punto es correcto) | 200 |
| Warrant | `ACHR.WS`, `ACHR-WS`, `ACHR-WT` | **404 las tres** | — | sin equivalencia |

**Alcance:** 22 símbolos de clase en el universo —BRK.A, BRK.B, MOG.A, MOG.B, LEN.B, HEI.A, PBR.A, TAP.A, GEF.B,
UHAL.B, WSO.B, BF.A, BF.B, CRD.A, CRD.B, AKO.A, AKO.B, AGM.A, BH.A, BIO.B, GTN.A, HVT.A—, más las unidades y las
preferidas. Todos caían al respaldo en silencio.

**Por qué importaba y no era cosmético:** el respaldo devuelve una serie distinta. Con el arreglo, el stop de Moog
pasó de **370,04 a 363,83** — 1,7% de diferencia en el número que define cuánto arriesgás por acción.

**Regla nueva:** `simboloYahoo()` traduce sólo lo comprobado —clase, unidad y preferida—, deja los sufijos de
plaza con el punto, y **no toca los warrants**, porque ninguna forma probada respondió y no se inventa una
equivalencia. Enchufada en los cinco puntos donde se arma una URL de Yahoo.

**Test:** `packages/adapters/test/yahoo-simbolo.test.ts`, 8 casos, incluidos dos que verifican que la traducción
esté *enchufada* y no sólo exportada (captan la URL que pide el adaptador). Se los vio fallar antes del arreglo.

---

## 5. Qué hacer

**Nada hoy.** Por nombre:

- **Nabtesco** y **Harmonic Drive**: fuera, y no por el gráfico sino por la liquidez. Aunque la tesis fuera
  perfecta, no hay cómo entrar ni cómo salir. La exclusión de la app es correcta.
- **Regal Rexnord**: fuera por `bajo_sma200` (−17,8% contra su media de 200). Y la tesis que se le atribuye no
  está en sus documentos.
- **Moog**: la app no la puede juzgar (`sin_estados`, sin puntaje, sin pares). Técnicamente está bien y es
  líquida, pero su propio comunicado dice datacenter, no robótica.
- **Timken**: la única con un número real de exposición, y la propia empresa lo acota a "pre-comercial". Hoy
  cierra debajo de la franja y sale 8ª de 11 contra sus pares. **Si cierra arriba de 119,92 vuelve a mirarse**,
  con el boleto del 28/9 recalculado.

---

## 6. Lo que queda abierto

1. **La cita del 25-30% del BOM de Timken es secundaria** (conferencia Jefferies, 9/9). Si TKR llega a entrar en
   zona, hay que verificarla contra fuente primaria antes de cualquier decisión.
2. **Las cifras japonesas siguen sin verificar** contra el *tanshin* original. Es deuda del 28/9 y como las dos
   empresas no son ejecutables, no vale la pena pagarla.
3. **Los warrants (`.WS`) siguen sin traducción** en el adaptador de Yahoo. Ninguna forma probada respondió; hay
   que averiguar la convención real antes de escribir la regla.
4. **La preselección de 300** vuelve a aparecer: TKR (1.662) y RRX (1.454) quedan fuera del Radar por puesto, no
   por mérito. Es el mismo debate abierto desde el 28/9.
