-- Deduplicación de raw_events (2026-09-13).
--
-- El índice único era (ticker, event_type, event_date, source_ref). Todos los eventos de la SEC llegan con
-- event_date NULL, y en Postgres dos NULL NO son iguales para un índice único: el índice nunca frenó un
-- duplicado de la SEC. Cada corrida re-ingresaba todo lo de su ventana. Medido el 13/9: 345 de las 452
-- filas de la SEC eran copias, y 168 de las 206 tesis eran llamadas a Gemini sobre presentaciones que ya
-- se habían evaluado. Las mismas 30 compras de insiders de TSM del 9/9 estaban guardadas siete veces.
--
-- Respaldo previo: respaldos-thesis-engine/respaldo-eventos-tesis-2026-09-13.sql (568 eventos, 206 tesis).
--
-- 1. Las tesis que apuntan a una copia pasan a apuntar al evento original (el más viejo de su grupo). No se
--    borra ninguna tesis: son lo que el sistema realmente propuso o rechazó, aunque haya sido dos veces.
UPDATE "theses" t
SET "raw_event_id" = o."original"
FROM (
  SELECT "id", first_value("id") OVER (
    PARTITION BY "ticker", "event_type", "event_date", "source_ref" ORDER BY "created_at", "id"
  ) AS "original"
  FROM "raw_events"
) o
WHERE t."raw_event_id" = o."id" AND o."id" <> o."original";
--> statement-breakpoint
-- 2. Se borran las copias. Son el mismo registro de la fuente guardado más de una vez: no es información.
DELETE FROM "raw_events" r
USING (
  SELECT "id", row_number() OVER (
    PARTITION BY "ticker", "event_type", "event_date", "source_ref" ORDER BY "created_at", "id"
  ) AS "n"
  FROM "raw_events"
) d
WHERE r."id" = d."id" AND d."n" > 1;
--> statement-breakpoint
-- 3. La unicidad ahora trata dos NULL como iguales (Postgres 15+). Con esto el ON CONFLICT DO NOTHING de la
--    ingesta vuelve a funcionar para los eventos sin fecha. Es una RESTRICCIÓN y no un índice suelto porque
--    drizzle solo sabe expresar NULLS NOT DISTINCT en restricciones: con un índice, la próxima migración
--    generada lo habría "corregido" de vuelta al comportamiento que causó el problema.
DROP INDEX IF EXISTS "raw_events_dedupe";
--> statement-breakpoint
ALTER TABLE "raw_events" ADD CONSTRAINT "raw_events_dedupe" UNIQUE NULLS NOT DISTINCT("ticker","event_type","event_date","source_ref");
