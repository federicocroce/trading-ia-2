---
name: hechos
description: Busca hechos externos con fecha y fuente (guía, ganancia por reservas, oferta de compra) para las acciones que pasan el filtro técnico del Radar, arma un JSON y lo carga con el importador de la app. El agente escribe HECHOS, no veredictos; la app decide con reglas. Lo corre el dueño con /hechos o el cron de los sábados.
argument-hint: "[SÍMBOLOS...]"
disable-model-invocation: true
---

# /hechos — lo que la app no puede leer sola

## Reglas duras

1. **Hechos, no veredictos.** Nunca escribas "COMPRAR", "apta", ni un precio objetivo. Escribís lo que pasó, con cifra, fecha y URL.
2. **Sin URL con fecha no se escribe.** Lo que no encontraste se omite. Nunca se inventa un número para completar.
3. **Fuente primaria primero**: 8-K con exhibit 99 en sec.gov, DEFM14A/PREM14A/425, comunicado en prnewswire, globenewswire o businesswire. Un portal solo si no hay primaria, y el importador lo va a marcar `no_verificado`.
4. **No tocás la base.** Dejás un JSON y corrés el importador. El importador es el único que escribe, y en una sola tabla.
5. **Tope**: 60 símbolos y 6 agentes por corrida. Con símbolos como argumento, solo esos.
6. **No corras `rank` ni `refresh`.**

## Pasos

Si `node` no está en el PATH (una sesión a mano), cargá nvm antes de empezar con `. ~/.nvm/nvm.sh`; el cron ya lo tiene en el PATH.

### 1. Candidatas (sin búsqueda)

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts mercado --preselect 300 --sin-estados --top 300 --salida /tmp/hechos-candidatas.json
```

Del JSON, tomá `filas` (las que pasan el filtro técnico). Sacá las que en `hechos` ya tienen un hecho del mismo tipo con fecha en los últimos 60 días. Quedate con hasta 60, por `score` descendente. Si recibiste símbolos como argumento, usá esos y salteá este paso.

### 2. Agentes (búsqueda)

Lanzá agentes en paralelo, de a 10 símbolos, cada uno con búsqueda web y esta única tarea, palabra por palabra:

> Para cada símbolo, buscá el ÚLTIMO comunicado de resultados trimestrales (8-K con exhibit 99 en sec.gov, o el comunicado en el cable) y de ahí: (a) si la guía cambió: dirección (sube/baja/reafirma), métrica, período, rango anterior y nuevo; (b) SOLO en aseguradoras, reaseguradoras, aseguradoras hipotecarias y bancos: el desarrollo de reservas de años anteriores del trimestre, en dólares, cuántos puntos del ratio combinado, y la ganancia por acción publicada, la ganancia sin ese desarrollo (calculala: monto × (1 − tasa) ÷ acciones, y decí que es cálculo propio en el título de la fuente) y el consenso si lo hay; (c) cualquier DEFM14A, PREM14A, SC 14D9 o 425 presentado en los últimos 400 días: comprador, precio en efectivo o ratio de canje, etapa regulatoria, cierre esperado. Devolvé SOLO un arreglo JSON con objetos de esta forma exacta, sin texto alrededor:
> `{ "tipo": "guia" | "ganancia_por_reservas" | "oferta_de_compra", "symbol": "...", "fecha": "AAAA-MM-DD", "valor": {...}, "fuente": { "url": "...", "titulo": "..." } }`
> Formas de `valor`: guia `{ direccion, metrica, periodo, antes, despues }`; ganancia_por_reservas `{ trimestre, montoUsd, puntosCombinado, epsPublicado, epsSinReservas, epsConsenso }`; oferta_de_compra `{ comprador, efectivoUsd, ratio: { acciones, de } | null, etapa, cierreEsperado, formulario }`. Sin URL con fecha, no escribas el hecho. Nada de opiniones, precios objetivo ni veredictos. Al final, en una línea aparte fuera del JSON: cuántas búsquedas hiciste.

### 3. Juntar, importar, registrar

Uní los arreglos en `docs/hechos/<fecha>.json` como `{ "hechos": [...] }` y corré:

```bash
pnpm --filter @thesis/api exec tsx src/radar-cli.ts hechos --importar docs/hechos/<fecha>.json --origen agente
```

La ruta del archivo se toma desde la raíz del repo (el CLI la resuelve contra el directorio desde el que se invocó pnpm).

Escribí `docs/hechos/<fecha>.md` con: cuántos símbolos se miraron, cuántos hechos entraron (verificados / no verificados), cuántos se rechazaron y por qué (el importador lo imprime), y el costo: agentes lanzados, búsquedas declaradas por cada uno, tokens si el entorno los muestra. Nada más: el informe no propone compras.
