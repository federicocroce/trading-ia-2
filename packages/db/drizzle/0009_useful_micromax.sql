CREATE TABLE "statements" (
	"symbol" text PRIMARY KEY NOT NULL,
	"cik" text,
	"as_of" date NOT NULL,
	"quarters" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"core" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fundamentals" ADD COLUMN "metrics_raw" jsonb;--> statement-breakpoint
ALTER TABLE "fundamentals" ADD COLUMN "statements_as_of" date;