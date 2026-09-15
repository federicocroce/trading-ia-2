-- Verificaciones pendientes del plan (2026-09-15).
--
-- Lo que solo la verificación web frena, en el orden del plan. Los reintentos verificaban las de más convicción aunque
-- una regla fija las dejara afuera igual (SNDK por subir más de 100%, NBN por banco sin estados), con una cuota de 20
-- búsquedas por día. Ahora el plan anota qué verificar y los reintentos leen eso.
ALTER TABLE "contribution_plans" ADD COLUMN IF NOT EXISTS "verifications_pending" jsonb;
