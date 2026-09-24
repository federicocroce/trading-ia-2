-- Moneda de reporte en las fundamentales (2026-09-24): los montos por acción de `metrics` vienen en esa moneda y el
-- precio en dólares. Sin esto, el dividendo de PBR en reales daba "15%" y el de KB, "3.600%".
ALTER TABLE "fundamentals" ADD COLUMN IF NOT EXISTS "currency" text;
--> statement-breakpoint
-- Las filas existentes la toman del perfil ya guardado; las próximas las escribe el barrido.
UPDATE "fundamentals" f SET "currency" = sm."currency" FROM "symbol_meta" sm WHERE sm."symbol" = f."symbol" AND f."currency" IS NULL AND sm."currency" IS NOT NULL AND sm."currency" <> '';
