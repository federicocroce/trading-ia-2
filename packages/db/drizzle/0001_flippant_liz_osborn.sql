CREATE TYPE "public"."layer" AS ENUM('riesgo', 'nucleo', 'cobertura');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('us', 'adr', 'ar');--> statement-breakpoint
CREATE TYPE "public"."tx_type" AS ENUM('BUY', 'SELL', 'DIVIDEND', 'TRANSFER');--> statement-breakpoint
CREATE TYPE "public"."verb" AS ENUM('VENDER', 'REVISAR', 'MANTENER', 'SUMAR');--> statement-breakpoint
CREATE TABLE "portfolio_risk" (
	"snapshot_date" date PRIMARY KEY NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_verdicts" (
	"verdict_date" date NOT NULL,
	"symbol" text NOT NULL,
	"verb" "verb" NOT NULL,
	"reason" text NOT NULL,
	"narrative" text,
	"warning" text,
	"close" numeric(14, 4) NOT NULL,
	"spot" numeric(14, 4),
	"stop" numeric(14, 4),
	"target" numeric(14, 4),
	"gain_pct" numeric(10, 4) NOT NULL,
	"weight_pct" numeric(8, 4) NOT NULL,
	"spy_close" numeric(14, 4),
	"degraded_by" text,
	"prompt_version" text,
	"close_7d" numeric(14, 4),
	"spy_7d" numeric(14, 4),
	"alpha_7d_pct" numeric(10, 4),
	"close_30d" numeric(14, 4),
	"spy_30d" numeric(14, 4),
	"alpha_30d_pct" numeric(10, 4),
	"measured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portfolio_verdicts_verdict_date_symbol_pk" PRIMARY KEY("verdict_date","symbol")
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"symbol" text PRIMARY KEY NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"avg_cost" numeric(14, 4) NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"market" "market" NOT NULL,
	"layer" "layer" DEFAULT 'riesgo' NOT NULL,
	"notes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "symbol_meta" (
	"symbol" text PRIMARY KEY NOT NULL,
	"name" text,
	"country" text,
	"industry" text,
	"market_cap" numeric(20, 0),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"type" "tx_type" NOT NULL,
	"quantity" numeric(18, 8) NOT NULL,
	"price" numeric(14, 4) NOT NULL,
	"fees" numeric(14, 4) DEFAULT '0' NOT NULL,
	"date" date NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"platform" text,
	"external_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_dedupe" ON "transactions" USING btree ("date","symbol","type","quantity","price");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_external" ON "transactions" USING btree ("external_id");