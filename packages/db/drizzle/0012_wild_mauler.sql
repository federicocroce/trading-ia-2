CREATE TABLE "external_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"step" text NOT NULL,
	"purpose" text,
	"symbol" text,
	"endpoint" text NOT NULL,
	"model" text,
	"key_index" integer,
	"status" integer,
	"result" text NOT NULL,
	"tokens_in" integer,
	"tokens_out" integer,
	"tokens_think" integer,
	"ms" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "external_calls_at_idx" ON "external_calls" USING btree ("at");--> statement-breakpoint
CREATE INDEX "external_calls_source_at_idx" ON "external_calls" USING btree ("source","at");