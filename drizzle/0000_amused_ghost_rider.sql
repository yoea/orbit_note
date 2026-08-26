CREATE TABLE "credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "credentials_credential_id_unique" UNIQUE("credential_id")
);
--> statement-breakpoint
CREATE TABLE "diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"latitude" double precision,
	"longitude" double precision,
	"location_accuracy" double precision,
	"timezone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "key_wrappers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wrapper_type" text NOT NULL,
	"credential_id" text,
	"encrypted_dek" text NOT NULL,
	"salt" text NOT NULL,
	"encryption_version" integer DEFAULT 1 NOT NULL,
	"recovery_key_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
