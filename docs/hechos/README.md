# Hechos externos

Cada corrida de `/hechos` deja acá `<fecha>.json` (lo que entró al importador) y `<fecha>.md` (qué entró, qué se rechazó y cuánto costó). El importador es `radar-cli.ts hechos --importar`, el único camino de escritura a `hechos_externos`. Solo lo verificado (fuente primaria, ver `config/hechos-fuentes.json`) produce banderas en el Radar.

Un hecho de oferta de compra vence 400 días después de su `fecha` (la misma ventana que EDGAR, ver `VENTANAS_DIAS` en `packages/core/src/radar/hechos.ts`). La columna `vigente_hasta` existe en la base para cortar esa vigencia antes (una oferta que se cae, por ejemplo), pero el importador todavía no la completa: hoy siempre queda en `null`. Una fusión que tarda más de 400 días en cerrar tiene que volver a cargarse con una `fecha` más nueva (un filing posterior, como una prórroga o una actualización del acuerdo) para seguir contando; es una limitación conocida, no un chequeo pendiente de la app.
