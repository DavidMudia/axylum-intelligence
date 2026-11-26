ALTER TABLE "exchange_connections" ADD COLUMN "api_secret_nonce" text NOT NULL;--> statement-breakpoint
ALTER TABLE "exchange_connections" ADD COLUMN "api_secret_tag" text NOT NULL;