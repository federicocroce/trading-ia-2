---
name: cadenas
description: Agente diario de hechos de CADENA (tema → eslabón → acciones, config/cadenas.json). Mira el precio de cada eslabón con el CLI de la app, busca hechos nuevos con fuente primaria que muevan un eslabón (Ormuz, la Fed, moratorias de datacenters, guías de los líderes de cada cadena) y los carga por el importador, con el signo que confirma el precio. Escribe HECHOS, no veredictos. Lo corre el cron de lunes a viernes a las 07:00 o el dueño con /cadenas.
argument-hint: "[ESLABONES...]"
disable-model-invocation: true
---

# /cadenas: hechos de cadena, todos los días

## Para qué existe

El puntaje de la app elige 600 de ~2.700 acciones, y el 60% de su peso es ruido (medido el 8/10). Este agente le da a
la app una segunda puerta: un **hecho verificable** sobre un eslabón de una cadena (IA → memoria, petróleo →
tanqueros) hace que la app **evalúe** sus acciones aunque el puntaje no las elija. Mirar no es comprar: después
deciden las reglas de siempre.

Y en negativo: un hecho en contra (moratoria, precio fijado por el gobierno) resta convicción a las acciones del
eslabón, incluidas las que el dueño tiene.

Se juzga con datos: el alfa de las filas que entraron por un hecho contra las que eligió el puntaje. Si no rinde más,
se apaga.

## Reglas duras

1. **Hechos, no veredictos.** Nunca escribas "comprar", "apta" ni un precio objetivo. Escribís qué pasó, con cifra, fecha y URL.
2. **Solo fuente primaria abierta y leída.** Reguladores, gobiernos, bancos centrales, filings en sec.gov, cables de comunicados (los hosts de `config/hechos-fuentes.json`). Si no la abriste, no la cargás. Un portal no sirve: el importador lo marca `no_verificado` y no mueve nada.
3. **El signo lo pone el precio, no el titular.** Un hecho `a_favor` se carga SOLO si el eslabón tiene `lectura: "confirma"` en el CLI (la mayoría de sus acciones sobre su media de 200). Con `en_contra` o sin lectura, un hecho favorable NO se carga: se anota en el informe con el motivo. Un hecho `en_contra` se carga siempre que la fuente lo sostenga (solo resta).
4. **Un hecho por eslabón, no por acción.** Se escribe con `"eslabon": "ia.memoria"` y sin `symbol`; el importador lo expande. Si el hecho toca a una sola empresa, no es de cadena: es de `/hechos`.
5. **Cada hecho lleva su contrapeso**, dicho por la misma fuente si lo hay (ej.: "la empresa espera que el TCE del 3T completo quede por debajo de lo contratado").
6. **No tocás la base ni el código.** Dejás un JSON y corrés el importador. **No corras `rank` ni `refresh`.**
7. **Tope**: 8 hechos nuevos por corrida, 4 agentes. Lo que no entra queda para mañana.

## Pasos

Si `node` no está en el PATH, cargá nvm: `. ~/.nvm/nvm.sh`.

### 1. Estado de cada eslabón (sin búsqueda)

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts cadenas --salida /tmp/cadenas-estado.json
```

Para cada eslabón: precio (1m, 3m, 6m, % sobre su media de 200, distancia al máximo), `lectura` y los hechos vigentes.

### 2. Revisar lo vigente contra el precio

Anotá en el informe los hechos `a_favor` vigentes cuyo eslabón hoy tiene `lectura: "en_contra"`. **No los borres**:
el dueño decide. Es la contradicción que la regla 3 evita al cargar, vista después.

### 3. Buscar lo nuevo (búsqueda)

Para cada tema, buscá **lo que pasó desde el último informe** (`docs/cadenas/` más reciente; si no hay, los últimos 7
días) que mueva a un eslabón entero. Qué buscar, como guía y no como lista cerrada:

- **Petróleo**: Ormuz (flujos, ataques, negociación), producción de la OPEP, inventarios de la EIA.
- **IA**: capex de los hiperescaladores en sus 8-K; guía de los líderes de cada eslabón (NVDA, MU, VRT, GEV) en sec.gov.
- **Datacenters**: moratorias estatales o locales (sitios .gov), consultas en las urnas.
- **Tasas**: decisión y actas de la Fed (federalreserve.gov), bono del Tesoro.
- **Salud**: CMS, FDA, aranceles a farmacéuticas (federalregister.gov, whitehouse.gov).
- **Defensa, nuclear, minerales**: presupuestos y contratos (defense.gov, nrc.gov), controles de exportación (bis.doc.gov).
- **Agro**: USDA. **Gas**: EIA.

Buscá también lo que **va en contra** del tema de moda: es donde se equivoca un agente que lee titulares.

Si recibiste eslabones como argumento, buscá solo esos.

### 4. Escribir, importar, informar

`docs/cadenas/<fecha>.json`:

```json
{ "hechos": [
  { "tipo": "sector", "eslabon": "petroleo.tanqueros_crudo", "fecha": "AAAA-MM-DD",
    "fuente": { "url": "https://…", "titulo": "…" },
    "valor": { "ambito": "tanqueros de crudo: tarifas", "titulo": "… (≤120)", "detalle": "cifras, fecha y contrapeso (≤400)", "sesgo": "a_favor" } }
] }
```

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts hechos --importar docs/cadenas/<fecha>.json --origen agente
```

`docs/cadenas/<fecha>.md`: eslabones mirados, hechos cargados (verificados / no verificados / rechazados y por qué),
hechos favorables que NO se cargaron porque el precio no confirma, contradicciones del paso 2, y el costo (agentes y
búsquedas). Nada más: el informe no propone compras.
