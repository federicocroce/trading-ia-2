-- Veredicto del analista sobre cada línea del plan (2026-10-10). Decisión del dueño: "la app siempre tiene que tener tu
-- último veredicto". Uno por símbolo y por día; un "no" cita un criterio de una lista fija (ver core/radar/analista.ts)
-- y queda guardado para medir después si acertó.
CREATE TABLE IF NOT EXISTS "veredictos_analista" (
  "fecha" date NOT NULL,
  "symbol" text NOT NULL,
  "veredicto" text NOT NULL,
  "criterio" text,
  "motivo" text NOT NULL,
  "fuente" jsonb,
  "version" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "veredictos_analista_fecha_symbol_pk" PRIMARY KEY ("fecha", "symbol")
);
