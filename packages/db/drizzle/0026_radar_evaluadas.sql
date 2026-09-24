-- Evaluadas que no entraron al Radar (2026-09-24): el Radar guardaba solo las filas que entraban, y "¿por qué no está
-- GLXY?" no tenía respuesta. La escriben el ranking del domingo y el refresco diario, una fila por fecha y símbolo.
CREATE TABLE IF NOT EXISTS "radar_evaluadas" (
  "fecha" date NOT NULL,
  "symbol" text NOT NULL,
  "posicion" integer,
  "veredicto" text,
  "motivo" text NOT NULL,
  "origen" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "radar_evaluadas_fecha_symbol_pk" PRIMARY KEY("fecha","symbol")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "radar_evaluadas_symbol" ON "radar_evaluadas" USING btree ("symbol");
