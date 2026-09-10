CREATE TABLE "radar_verifications" (
	"symbol" text PRIMARY KEY NOT NULL,
	"date" date NOT NULL,
	"verdict" text NOT NULL,
	"reason" text NOT NULL,
	"last_quarter" jsonb,
	"analysts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"consensus_target" numeric(14, 4),
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"valuation" text,
	"next_earnings" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"research_text" text NOT NULL,
	"prompt_version" text NOT NULL,
	"model" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD COLUMN "verification" jsonb;