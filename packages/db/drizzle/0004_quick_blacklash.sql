CREATE TABLE "candles_daily" (
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"open" numeric(14, 4) NOT NULL,
	"high" numeric(14, 4) NOT NULL,
	"low" numeric(14, 4) NOT NULL,
	"close" numeric(14, 4) NOT NULL,
	"volume" numeric(18, 0) NOT NULL,
	CONSTRAINT "candles_daily_symbol_date_pk" PRIMARY KEY("symbol","date")
);
--> statement-breakpoint
CREATE TABLE "news" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"date" date NOT NULL,
	"headline" text NOT NULL,
	"source" text,
	"url" text NOT NULL,
	"summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "long_name" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "employees" integer;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "exchange_name" text;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "first_trade_date" date;--> statement-breakpoint
ALTER TABLE "symbol_meta" ADD COLUMN "description_updated_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "news_symbol_url" ON "news" USING btree ("symbol","url");--> statement-breakpoint
CREATE INDEX "news_symbol_date" ON "news" USING btree ("symbol","date");