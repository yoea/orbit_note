CREATE TABLE "user_profile" (
	"id" text PRIMARY KEY NOT NULL,
	"name_ciphertext" text,
	"name_iv" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
