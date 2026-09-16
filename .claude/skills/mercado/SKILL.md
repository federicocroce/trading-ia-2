---
name: mercado
description: Propone tickers recorriendo TODO el mercado, no las 40 filas del Radar. Embudo con las reglas de la app sobre el universo entero, más búsqueda en internet para lo que la app no ve (temas, resultados, riesgos), y análisis profundo de los finalistas. Usar cuando el dueño escribe /mercado o pide ideas más allá del Radar.
---

# /mercado — el embudo del mercado entero

## Por qué existe

El Radar muestra 40 acciones porque el ranking preselecciona 150 por fundamentales y corta ahí. En la base hay 2.724
empresas con fundamentales y 10.389 que pasaron el barrido. Y hay cosas que la base no ve nunca: qué tema tiene viento
a favor, qué reportó ayer, qué juicio se viene, qué empresa acaba de listar.

Este comando recorre todo eso con un embudo: **barato y ancho al principio, caro y angosto al final**. La app hace la
parte de los números; la búsqueda, la parte de los hechos.

## Reglas duras

1. **Una sola vara.** El puntaje contra pares, el filtro técnico, el stop, la franja de compra, el objetivo 2 a 1, el
   momento de entrada y el tamaño salen SIEMPRE del comando de la app. La búsqueda no produce precios ni niveles: si un
   artículo dice "objetivo 120", eso es la opinión de un analista, con su fecha y su firma, no el objetivo de la app.
2. **Nada de acá dice COMPRAR.** /mercado propone candidatas. COMPRAR lo dice el plan, con monto ([[feedback-comprar-un-solo-significado]]).
3. **Cada descarte con su motivo.** El comando ya devuelve `descartadas` con la etapa y la razón. Lo que descartes por la
   búsqueda también va escrito, con su razón.
4. **Sin fuente no se afirma.** Cada hecho del informe lleva enlace y fecha. Lo que no se pudo verificar se escribe como
   "no verificado" y no entra en la tesis.
5. **No se toca el Radar ni el plan.** `mercado` es de solo lectura sobre el Radar (guarda velas y estados, que son
   caché). Nunca correr `rank` ni `refresh` para esto, y menos con el mercado abierto.
6. **Lo que ya tenés no es una idea nueva.** El comando lo marca (`enCartera`): se mide contra tu posición, no como
   compra nueva. Lo que ya está en el Radar (`enElRadar`) tampoco es un hallazgo: decilo.
7. **La cuota de Gemini no se toca.** Las búsquedas de este comando las hacés vos con tu buscador. Los 20 pedidos
   diarios por proyecto son de la verificación de la app ([[gemini-cuota-registro]]).

## El embudo

### Paso 0 — la foto del mercado (5-8 búsquedas)

Antes de mirar papeles: qué está pasando. Tasas y la Fed, qué sectores lideran y cuáles se rompieron en la semana, qué
factor manda (valor, crecimiento, tamaño), qué viene en el calendario (resultados, datos, decisiones). Con fecha y
fuente. Esto define qué temas mirás en el paso 2 y qué riesgos pesan en el paso 5.

La app ya calcula el régimen de tasas: mirá `regime` en `GET /radar/top` antes de buscar, y usalo como ancla.

### Paso 1 — el embudo barato (1 comando, 0 búsquedas)

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado --preselect 600 --sin-estados --top 120 --salida /tmp/mercado-ancho.json
```

Devuelve, con las reglas de la app: universo, cuántas rankearon, cuántas pasaron el filtro técnico, las que quedan
ordenadas por puntaje contra pares (con franja, stop, objetivo, tamaño, riesgo y momento de entrada) y **cada descarte
con su motivo**. `--sin-estados` saltea los estados de la SEC: pedirlos para 600 símbolos y sus pares son miles de
pedidos solo para elegir a quién mirar. La pasada angosta del paso 3 sí los pide.

Leé el JSON y quedate con las que no estén ya en el Radar (`enElRadar: false`): eso es lo que el Radar no te muestra.

### Paso 2 — lo que la app no ve (agentes en paralelo)

Lanzá agentes en paralelo, uno por frente, cada uno con búsqueda web. Frentes típicos: tecnología e IA, energía,
salud, financiero, industriales y defensa, materiales y oro, consumo, ETFs sectoriales y temáticos, Argentina (ADR y
BYMA), cripto y mineras. Ajustá los frentes a la foto del paso 0.

Cada agente devuelve, **con fuente y fecha**, hasta 10 símbolos: qué pasó (resultados, guía, contrato, aprobación,
cambio regulatorio), por qué podría importar, y el riesgo principal. Nada de precios ni de niveles: eso lo pone la app.

Instrucción para cada agente: "no me traigas listas de recomendaciones de portales; traeme el hecho y la fuente
primaria (comunicado, presentación, filing) o la nota que lo reporta, con fecha".

### Paso 3 — cruce: las mismas reglas para todos

Juntá los símbolos nuevos y pasalos por la misma vara:

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado SYM1 SYM2 SYM3 --salida /tmp/mercado-nuevos.json
```

Con símbolos, el comando evalúa solo esos, pide sus estados de la SEC y trae velas aunque no estén en el universo (sin
fundamentales, salen sin puntaje contra pares y solo con la parte técnica: decilo en el informe). Los que quedan
excluidos, quedan con su motivo.

### Paso 4 — el corte (sin búsquedas)

De la unión del paso 1 y el paso 3, quedate con 15 a 25 mirando:

- puntaje contra pares y su grupo (1 de 59 dice mucho; 1 de 5, poco);
- el filtro técnico: lo que está bajo su media de 200 o bajo su stop no es una compra hoy;
- diversificación real contra tu cartera: si se mueve como algo que ya tenés, no suma (la app lo mide con correlación
  ≥ 0,85 en el plan);
- concentración por tema: tu cartera ya es 75% Argentina;
- riesgo 1 a 10: un 9 es una apuesta, no una posición.

### Paso 5 — los finalistas, a fondo (un agente por ticker)

8 a 12 finalistas, un agente de búsqueda por cada uno. Cada uno tiene que volver con:

- **último trimestre**: ventas y ganancia contra consenso, y si la sorpresa sobrevive sin extraordinarios;
- **guía**: qué dijo la empresa para adelante, y si la cambió;
- **valuación**: múltiplo actual contra su propia historia de 5 años y contra sus pares;
- **riesgos**: juicios, regulación, deuda que vence, dilución, dependencia de un cliente o de un país;
- **analistas**: objetivo de consenso con fecha, y quién lo cambió hace poco;
- **calendario**: cuándo reporta, y qué decisión regulatoria o evento tiene cerca.

Todo con enlace y fecha. Si dos fuentes se contradicen, se dice y gana la primaria (comunicado o filing).

### Paso 6 — cuándo entrar (de la app, no de la búsqueda)

Para cada finalista, del JSON del comando: franja de compra, stop, objetivo, "no por debajo de", tamaño y estado de
entrada (`en_zona`, `retroceso`, `esperar_retroceso` con orden limitada, `esperar_confirmacion` que es comprar solo si
cierra arriba del nivel). Esos son los números que van al informe.

### Paso 7 — la salida

1. **Informe** en `docs/mercado/<fecha>.md`: la foto del mercado, el embudo con sus números (cuántas entraron y
   salieron en cada etapa), los finalistas con tesis, riesgo principal, niveles y momento de entrada, y la lista de lo
   descartado con su motivo. Corto y sin adornos.
2. **A seguimiento**: agregá los finalistas que valgan la pena con
   `curl -s -X POST localhost:3002/radar/watchlist -H 'Content-Type: application/json' -d '{"symbol":"XXX","note":"/mercado <fecha>: <tesis en una línea>"}'`.
   Desde ahí la app los evalúa todos los días con las mismas reglas, los verifica en la web y el plan puede tomar uno
   como línea de seguimiento.
3. **Decile al dueño qué va a pasar**: el plan se rearma solo; una de seguimiento puede entrar mañana con su monto.

## Cuánto cuesta

- Paso 1: gratis y rápido (2-4 min con 600 símbolos, la mayoría de las velas ya están guardadas).
- Pasos 2 y 5: entre 60 y 120 búsquedas en una corrida profunda; menos de 20 en una rápida.
- La app no gasta cuota de Gemini acá; sí la gasta después, cuando verifica lo que quedó en seguimiento.

## Errores que ya pasaron (no repetirlos)

- **Correr el ranking a mano** para "ver más": el 15/9 eso dejó el Radar con 5 acciones y un plan todo núcleo, porque el
  universo quedó viejo. `mercado` no escribe el Radar; usalo a él.
- **Dos varas**: si el informe muestra un stop o un objetivo calculado por fuera de la app, tenés dos apps. Los números
  salen del comando.
- **Creerle a un titular**: el 14/9 la verificación dio "apto" a una minera sin ver que su licencia vence en 2027. El
  hecho vale con la fuente primaria y la fecha, no con el resumen de un portal.
- **Traer ideas que ya tenés**: APH y TSM ya están en el Radar y en cartera; si aparecen, se dice que no son nuevas.
