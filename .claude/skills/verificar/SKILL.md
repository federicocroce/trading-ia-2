---
name: verificar
description: Verifica y revisa antes de comprar las acciones que el plan y el Radar necesitan hoy, leyendo fuentes primarias (comunicado de resultados, 10-Q/10-K, Form 4). Escribe HALLAZGOS con fuente en un JSON y lo carga con el importador de la app, que decide por regla. Reemplaza a Gemini para la verificación y la revisión (22/9).
argument-hint: "[SÍMBOLOS...]"
disable-model-invocation: true
---

# /verificar — lo que la app no puede leer sola, todos los días

## Reglas duras

1. **Hallazgos, no veredictos.** Nunca escribas "apto", "comprar" ni "evitar" como conclusión. Escribís lo que encontraste,
   con dato, fecha y URL. La app decide con la regla.
2. **Sin URL no se escribe.** Lo que no encontraste va a `faltantes`. Nunca se inventa un número.
3. **Fuente primaria primero**: 8-K con exhibit 99 o 6-K en sec.gov, 10-Q/10-K, Form 4, el comunicado en prnewswire,
   globenewswire o businesswire. Un "evitar" sin fuente primaria la app lo baja a reserva.
4. **El comunicado de un estudio de abogados buscando demandantes no es un hecho.** No lo escribas.
5. **No tocás la base.** Dejás un JSON y corrés el importador: es el único que escribe.
6. **No corras `rank` ni `refresh`.** Topes: los que da `--pendientes` (8 verificaciones y 5 revisiones por día).

## Pasos

Si `node` no está en el PATH (una sesión a mano), cargá nvm antes de empezar con `. ~/.nvm/nvm.sh`; el cron ya lo tiene.

### 1. Qué verificar y revisar (sin búsqueda)

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts verificar --pendientes --salida docs/verificaciones/pendientes.json
```

Con símbolos como argumento, agregalos al final del comando (`… --pendientes --salida docs/verificaciones/pendientes.json SEZL SMCI`):
van esos, en las dos listas, sin topes. Si `verificar` y `revisar` vienen vacías, escribí el resumen del paso 4 diciendo
"nada que verificar hoy" y terminá.

### 2. Agentes (búsqueda)

Leé `docs/verificaciones/pendientes.json`. Lanzá agentes en paralelo, **de a 2 símbolos**, cada uno con búsqueda web y
esta tarea: el texto de `cuestionario` del JSON **palabra por palabra**, más los símbolos que le tocan de `verificar` (con
su `nombre` y `contexto`) y de `revisar` (con su `verificacion` y su `linea`), más la fecha de `hoy`. Cada agente devuelve
solo JSON: `{ "verificaciones": [...], "revisiones": [...] }`, y en una línea aparte fuera del JSON cuántas búsquedas hizo.

### 3. Juntar e importar

Uní todo en `docs/verificaciones/<hoy>.json` como `{ "verificaciones": [...], "revisiones": [...] }` y corré:

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts verificar --importar docs/verificaciones/<hoy>.json
```

Si te pidieron ensayo, agregá `--ensayo` (decide y muestra, no guarda). El importador dice qué entró, con qué dictamen, y
qué rechazó y por qué. Si rechazó algo por forma (una URL vacía, un tipo que no existe), corregí ESE ítem y volvé a
importar el archivo entero: lo ya guardado se pisa con lo mismo.

### 4. Registrar

Escribí `docs/verificaciones/<hoy>.md` con: cuántos símbolos se verificaron y revisaron, el dictamen de cada uno como lo
imprimió el importador, lo rechazado y por qué, y el costo (agentes lanzados, búsquedas declaradas, tokens si los tenés).
