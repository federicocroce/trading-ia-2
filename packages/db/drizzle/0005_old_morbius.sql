CREATE TABLE "macro_ar_daily" (
	"date" date PRIMARY KEY NOT NULL,
	"oficial" numeric(14, 4),
	"mep" numeric(14, 4),
	"ccl" numeric(14, 4),
	"blue" numeric(14, 4),
	"mayorista" numeric(14, 4),
	"brecha_pct" numeric(10, 4),
	"riesgo_pais" integer,
	"merval" numeric(18, 4),
	"merval_usd" numeric(14, 4),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
