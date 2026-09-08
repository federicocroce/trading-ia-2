ALTER TABLE "watchlist" ADD COLUMN "entry_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "entry_action" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "target_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "stop_loss" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "thesis" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "horizon_days" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "status" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_return" numeric(10, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "resolution_price" numeric(14, 4);--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "resolution_return" numeric(10, 4);