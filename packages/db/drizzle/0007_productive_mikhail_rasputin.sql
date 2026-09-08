CREATE TABLE "watchlist" (
	"symbol" text PRIMARY KEY NOT NULL,
	"note" text,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
