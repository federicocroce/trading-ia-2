-- Registro diario de las líneas del plan (2026-10-10). `contribution_plans` guarda UN plan por mes y se pisa en cada
-- rearmado, así que no había historia de qué recomendó la app cada día. Esto la guarda, para medir "si hubieras
-- comprado lo que dijo la app" contra el S&P.
CREATE TABLE IF NOT EXISTS "registro_plan" (
  "fecha" date NOT NULL,
  "symbol" text NOT NULL,
  "kind" text NOT NULL,
  "monto_usd" numeric(14, 2) NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "registro_plan_fecha_symbol_pk" PRIMARY KEY ("fecha", "symbol")
);
