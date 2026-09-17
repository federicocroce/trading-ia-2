-- Hechos externos (2026-09-17): guía, ganancia por reservas y ofertas de compra con fecha y fuente.
-- La única tabla que escribe el importador de hechos; sólo lo verificado (fuente primaria) produce banderas.
CREATE TABLE IF NOT EXISTS "hechos_externos" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "symbol" text NOT NULL,
  "tipo" text NOT NULL,
  "fecha" date NOT NULL,
  "valor" jsonb NOT NULL,
  "fuente_url" text NOT NULL,
  "fuente_titulo" text NOT NULL,
  "primaria" boolean NOT NULL,
  "estado" text NOT NULL,
  "origen" text NOT NULL,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "vigente_hasta" date
);
CREATE UNIQUE INDEX IF NOT EXISTS "hechos_externos_unico" ON "hechos_externos" ("symbol", "tipo", "fecha", "fuente_url");
CREATE INDEX IF NOT EXISTS "hechos_externos_symbol" ON "hechos_externos" ("symbol");
