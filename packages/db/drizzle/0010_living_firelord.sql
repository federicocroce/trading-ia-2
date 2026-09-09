CREATE TABLE "analyst_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"firm" text NOT NULL,
	"action" text NOT NULL,
	"rating" text,
	"target" numeric(14, 2),
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"headline" text NOT NULL,
	"url" text NOT NULL,
	"source" text,
	"why" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"prompt_version" text
);
--> statement-breakpoint
CREATE TABLE "radar_news_scans" (
	"symbol" text PRIMARY KEY NOT NULL,
	"scanned_to" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD COLUMN "events" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "radar_candidates" ADD COLUMN "analyst_targets" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "analyst_actions_symbol_url" ON "analyst_actions" USING btree ("symbol","url");--> statement-breakpoint
CREATE INDEX "analyst_actions_symbol_date" ON "analyst_actions" USING btree ("symbol","date");--> statement-breakpoint
CREATE UNIQUE INDEX "radar_events_symbol_url" ON "radar_events" USING btree ("symbol","url");--> statement-breakpoint
CREATE INDEX "radar_events_symbol_date" ON "radar_events" USING btree ("symbol","date");