-- Controles y cambios del plan (2026-09-15).
--
-- El 15/9 la corrida de las 7:50 no rearmó el plan y siguió diciendo "comprar NVDA" con NVDA en OBSERVAR; el
-- control que lo detecta existía pero nadie lo corría. Desde acá cada versión del plan guarda con qué datos
-- entró cada símbolo, qué cambió respecto de la anterior y el resultado de los controles automáticos. Con un
-- grave, o sin controles sobre esta versión, el plan no se ejecuta.
ALTER TABLE "contribution_plans" ADD COLUMN "inputs" jsonb;
--> statement-breakpoint
ALTER TABLE "contribution_plans" ADD COLUMN "changes" jsonb;
--> statement-breakpoint
ALTER TABLE "contribution_plans" ADD COLUMN "previous_built_at" text;
--> statement-breakpoint
ALTER TABLE "contribution_plans" ADD COLUMN "controles" jsonb;
