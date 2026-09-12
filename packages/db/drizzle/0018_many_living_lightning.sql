ALTER TABLE "theses" ADD COLUMN "p_market_from_options" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "radar_verifications" DROP COLUMN "p_market_from_options";