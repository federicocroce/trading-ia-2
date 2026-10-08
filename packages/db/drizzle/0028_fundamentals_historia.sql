-- Histórico punto-en-el-tiempo de fundamentales (2026-10-08).
--
-- Por qué. La tabla `fundamentals` tiene el símbolo como clave y se SOBREESCRIBE en cada barrido: guarda "las
-- fundamentales de hoy". Por eso el ranking de la app no se puede backtestear: rankear septiembre con los balances
-- de octubre es mirar el futuro. Medido lo que sí era punto en el tiempo (el puesto guardado en `radar_evaluadas`),
-- el tramo de MEJOR puesto rindió −1,74% de alfa a 7 días con 34% de acierto, peor que los de abajo. Para saber si
-- eso es el método o los pesos hace falta poder re-rankear el pasado, y para eso hay que guardar cada versión.
--
-- Aditivo a propósito: ninguna lectura existente cambia. `fundamentals` sigue siendo "lo de hoy"; esta tabla es
-- append-only y una fila por (fecha, símbolo). `peers` se guarda porque el grupo de pares es parte del puntaje.
CREATE TABLE IF NOT EXISTS "fundamentals_historia" (
  "as_of" date NOT NULL,
  "symbol" text NOT NULL,
  "metrics" jsonb NOT NULL,
  "peers" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "industry" text,
  "mcap_usd" numeric(20, 0),
  "dollar_volume_usd" numeric(20, 0) NOT NULL,
  "price_usd" numeric(14, 4) NOT NULL,
  "currency" text,
  "guardado_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "fundamentals_historia_pk" PRIMARY KEY("as_of","symbol")
);
CREATE INDEX IF NOT EXISTS "fundamentals_historia_symbol" ON "fundamentals_historia" ("symbol","as_of");
