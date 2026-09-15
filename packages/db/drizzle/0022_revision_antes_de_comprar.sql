-- Revisión antes de comprar (2026-09-15).
--
-- Una segunda búsqueda, independiente de la verificación, sobre lo que el plan compraría: razones para NO comprarla
-- hoy. El 14/9 la verificación dio "apto" a GFI sin ver que la licencia de Tarkwa vence en abril de 2027. Una por
-- símbolo y por día; el plan guarda lo que todavía espera la suya.
CREATE TABLE IF NOT EXISTS "pretrade_reviews" (
  "symbol" text NOT NULL,
  "review_date" date NOT NULL,
  "verdict" text NOT NULL,
  "reason" text NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "research_text" text,
  "model" text,
  "prompt_version" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "pretrade_reviews_symbol_review_date_pk" PRIMARY KEY("symbol","review_date")
);
--> statement-breakpoint
ALTER TABLE "contribution_plans" ADD COLUMN "reviews_pending" jsonb;
