CREATE TABLE "passkey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"aaguid" text,
	"createdAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "preferencias_usuario" ADD COLUMN IF NOT EXISTS "extrato_note_as_column" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "preferencias_usuario" ADD COLUMN IF NOT EXISTS "lancamentos_column_order" jsonb;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
