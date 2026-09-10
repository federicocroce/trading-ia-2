ALTER TABLE "job_runs" ADD COLUMN "last_error" text;--> statement-breakpoint
ALTER TABLE "job_runs" ADD COLUMN "last_error_at" timestamp with time zone;