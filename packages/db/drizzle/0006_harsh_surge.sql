CREATE TABLE "job_runs" (
	"step" text PRIMARY KEY NOT NULL,
	"last_date" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"detail" text
);
