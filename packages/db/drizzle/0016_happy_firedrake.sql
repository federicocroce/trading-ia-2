ALTER TABLE "contribution_plans" ADD COLUMN "left_out" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "contribution_plans" ADD COLUMN "tranches" integer;