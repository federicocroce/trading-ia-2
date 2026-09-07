CREATE TABLE "contribution_plans" (
	"plan_month" text PRIMARY KEY NOT NULL,
	"total_usd" numeric(14, 2) NOT NULL,
	"lines" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundamentals" (
	"symbol" text PRIMARY KEY NOT NULL,
	"as_of" date NOT NULL,
	"metrics" jsonb NOT NULL,
	"peers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"industry" text,
	"mcap_usd" numeric(20, 0) NOT NULL,
	"dollar_volume_usd" numeric(20, 0) NOT NULL,
	"price_usd" numeric(14, 4) NOT NULL,
	"next_earnings" date,
	"insider_buys_90d" integer,
	"insider_sells_90d" integer,
	"analyst" jsonb,
	"earnings_surprises" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "radar_candidates" (
	"candidate_date" date NOT NULL,
	"symbol" text NOT NULL,
	"kind" text NOT NULL,
	"verdict" text NOT NULL,
	"score" numeric(10, 4),
	"axes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"peer_group" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank_in_group" integer,
	"group_size" integer,
	"close" numeric(14, 4) NOT NULL,
	"entry_low" numeric(14, 4),
	"entry_high" numeric(14, 4),
	"stop" numeric(14, 4),
	"target" numeric(14, 4),
	"size_usd" numeric(14, 2),
	"size_qty" integer,
	"risk_score" integer,
	"flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nth_appearance" integer DEFAULT 1 NOT NULL,
	"summary" text,
	"why_ranks" text,
	"main_risk" text,
	"moat" text,
	"degraded_by" text,
	"prompt_version" text,
	"spy_close" numeric(14, 4),
	"close_7d" numeric(14, 4),
	"spy_7d" numeric(14, 4),
	"alpha_7d_pct" numeric(10, 4),
	"close_30d" numeric(14, 4),
	"spy_30d" numeric(14, 4),
	"alpha_30d_pct" numeric(10, 4),
	"close_90d" numeric(14, 4),
	"spy_90d" numeric(14, 4),
	"alpha_90d_pct" numeric(10, 4),
	"measured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "radar_candidates_candidate_date_symbol_pk" PRIMARY KEY("candidate_date","symbol")
);
--> statement-breakpoint
CREATE TABLE "universe_scan" (
	"scan_date" date NOT NULL,
	"symbol" text NOT NULL,
	"stage" text NOT NULL,
	"reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "universe_scan_scan_date_symbol_pk" PRIMARY KEY("scan_date","symbol")
);
--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "share_outstanding" numeric(18, 4);--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "asset_class" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "exposure" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "themes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "themes_source" text;--> statement-breakpoint
CREATE INDEX "universe_scan_stage" ON "universe_scan" USING btree ("scan_date","stage");