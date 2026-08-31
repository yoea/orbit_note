CREATE TABLE "prompt_stats" (
	"prompt_id" text PRIMARY KEY NOT NULL,
	"show_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
