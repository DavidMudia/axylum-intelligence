ALTER TABLE "paper_orders" DROP CONSTRAINT "paper_orders_account_id_paper_accounts_id_fk";--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_account_owner_fk" FOREIGN KEY ("account_id","owner_user_id") REFERENCES "public"."paper_accounts"("id","owner_user_id") ON DELETE cascade ON UPDATE no action;
