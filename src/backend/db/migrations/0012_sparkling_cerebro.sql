ALTER TABLE "subscriptions" ADD COLUMN "provider_email_token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_email_token_nonce" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_email_token_tag" text;