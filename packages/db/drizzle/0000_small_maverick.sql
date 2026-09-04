CREATE TYPE "public"."close_reason" AS ENUM('event_resolved', 'invalidation', 'target', 'risk_stop', 'manual');--> statement-breakpoint
CREATE TYPE "public"."confidence" AS ENUM('low', 'med', 'high');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."event_source" AS ENUM('edgar', 'fda', 'earnings_calendar', 'alpaca_market', 'courtlistener', 'news', 'ar_official', 'manual');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('fda', 'earnings', 'legal', 'macro_ar', 'operational');--> statement-breakpoint
CREATE TYPE "public"."instrument" AS ENUM('stock', 'call', 'put');--> statement-breakpoint
CREATE TYPE "public"."order_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('pending', 'submitted', 'filled', 'partially_filled', 'cancelled', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."rejection_reason" AS ENUM('edge_below_threshold', 'risk_rule', 'human');--> statement-breakpoint
CREATE TYPE "public"."thesis_status" AS ENUM('proposed', 'rejected', 'approved', 'open', 'closed');--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thesis_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"instrument" "instrument" NOT NULL,
	"symbol" text NOT NULL,
	"side" "order_side" NOT NULL,
	"qty" integer NOT NULL,
	"limit_price" numeric(12, 4) NOT NULL,
	"notional_usd" numeric(14, 2) NOT NULL,
	"broker_order_id" text,
	"status" "order_status" DEFAULT 'pending' NOT NULL,
	"filled_qty" integer DEFAULT 0 NOT NULL,
	"avg_fill_price" numeric(12, 4),
	"paper" boolean DEFAULT true NOT NULL,
	"submitted_at" timestamp with time zone,
	"filled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"thesis_id" uuid PRIMARY KEY NOT NULL,
	"predicted_outcome_happened" boolean NOT NULL,
	"pnl_usd" numeric(14, 2) NOT NULL,
	"pnl_pct" numeric(8, 4) NOT NULL,
	"close_reason" "close_reason" NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_versions" (
	"version" text PRIMARY KEY NOT NULL,
	"hash" text NOT NULL,
	"content" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"source" "event_source" NOT NULL,
	"event_date" date,
	"source_ref" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"filter_passed" boolean,
	"filter_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_event_id" uuid NOT NULL,
	"ticker" text NOT NULL,
	"event_type" "event_type" NOT NULL,
	"event_date" date,
	"direction" "direction" NOT NULL,
	"p_estimate" numeric(5, 4) NOT NULL,
	"p_market" numeric(5, 4) NOT NULL,
	"edge" numeric(6, 4) NOT NULL,
	"instrument" "instrument" NOT NULL,
	"entry_max" numeric(12, 4) NOT NULL,
	"target" numeric(12, 4) NOT NULL,
	"invalidation" text NOT NULL,
	"confidence" "confidence" NOT NULL,
	"reasoning" text NOT NULL,
	"sources" jsonb NOT NULL,
	"status" "thesis_status" DEFAULT 'proposed' NOT NULL,
	"rejection_reason" "rejection_reason",
	"human_decision" text,
	"human_decided_at" timestamp with time zone,
	"prompt_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_thesis_id_theses_id_fk" FOREIGN KEY ("thesis_id") REFERENCES "public"."theses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_raw_event_id_raw_events_id_fk" FOREIGN KEY ("raw_event_id") REFERENCES "public"."raw_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "theses" ADD CONSTRAINT "theses_prompt_version_prompt_versions_version_fk" FOREIGN KEY ("prompt_version") REFERENCES "public"."prompt_versions"("version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orders_thesis" ON "orders" USING btree ("thesis_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_events_dedupe" ON "raw_events" USING btree ("ticker","event_type","event_date","source_ref");--> statement-breakpoint
CREATE INDEX "raw_events_event_date" ON "raw_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "theses_status" ON "theses" USING btree ("status");--> statement-breakpoint
CREATE INDEX "theses_event_type" ON "theses" USING btree ("event_type");