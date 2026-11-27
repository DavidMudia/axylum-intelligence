CREATE TABLE "user_strategies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"rules" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "paper_orders_client_order_id_uidx";--> statement-breakpoint
DROP INDEX "trading_decisions_strategy_symbol_interval_candle_uidx";--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD COLUMN "session_status" text DEFAULT 'stopped' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD COLUMN "account_id" text;--> statement-breakpoint
ALTER TABLE "risk_configurations" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "strategies" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "trading_decisions" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF (SELECT count(*) FROM "users" WHERE "role" = 'owner') <> 1 THEN
		RAISE EXCEPTION 'Ownership migration requires exactly one provisioned platform owner';
	END IF;
	IF NOT EXISTS (SELECT 1 FROM "paper_accounts" WHERE "id" = 'btc-paper-usdt') THEN
		RAISE EXCEPTION 'Ownership migration requires the existing BTC paper account';
	END IF;
END $$;--> statement-breakpoint
UPDATE "paper_accounts" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
UPDATE "paper_accounts" SET "session_status" = CASE
	WHEN (SELECT "value" FROM "system_state" WHERE "key" = 'paper_trading_state') = 'running' THEN 'running'
	WHEN (SELECT "value" FROM "system_state" WHERE "key" = 'paper_trading_state') = 'paused' THEN 'paused'
	ELSE 'stopped'
END;--> statement-breakpoint
UPDATE "risk_configurations" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
UPDATE "paper_orders" SET
	"account_id" = 'btc-paper-usdt',
	"owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
UPDATE "paper_positions" SET "account_id" = 'btc-paper-usdt';--> statement-breakpoint
UPDATE "backtest_runs" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
UPDATE "strategies" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
UPDATE "trading_decisions" SET "owner_user_id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' LIMIT 1);--> statement-breakpoint
INSERT INTO "user_strategies" ("user_id", "slug", "name", "description", "version", "active", "rules", "created_at", "updated_at")
SELECT u."id", s."slug", s."name", s."description", s."version", s."active", s."rules", s."created_at", s."updated_at"
FROM "users" u CROSS JOIN "trading_strategies" s;--> statement-breakpoint
ALTER TABLE "backtest_runs" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_accounts" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" ALTER COLUMN "account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "risk_configurations" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "strategies" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trading_decisions" ALTER COLUMN "owner_user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_positions" DROP CONSTRAINT "paper_positions_pkey";--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_pkey" PRIMARY KEY("account_id","symbol");--> statement-breakpoint
ALTER TABLE "user_strategies" ADD CONSTRAINT "user_strategies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "user_strategies_user_slug_uidx" ON "user_strategies" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "user_strategies_user_active_idx" ON "user_strategies" USING btree ("user_id","active");--> statement-breakpoint
ALTER TABLE "backtest_runs" ADD CONSTRAINT "backtest_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD CONSTRAINT "paper_orders_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "paper_positions" ADD CONSTRAINT "paper_positions_account_id_paper_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."paper_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_configurations" ADD CONSTRAINT "risk_configurations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strategies" ADD CONSTRAINT "strategies_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_decisions" ADD CONSTRAINT "trading_decisions_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_runs_owner_created_idx" ON "backtest_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_accounts_owner_uidx" ON "paper_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_accounts_id_owner_uidx" ON "paper_accounts" USING btree ("id","owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_orders_account_client_order_id_uidx" ON "paper_orders" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE INDEX "paper_orders_owner_created_idx" ON "paper_orders" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_orders_account_created_idx" ON "paper_orders" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "paper_positions_account_opened_idx" ON "paper_positions" USING btree ("account_id","opened_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_configurations_owner_uidx" ON "risk_configurations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "strategies_owner_created_idx" ON "strategies" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_decisions_owner_strategy_symbol_interval_candle_uidx" ON "trading_decisions" USING btree ("owner_user_id","strategy_slug","symbol","interval","candle_open_time");--> statement-breakpoint
CREATE INDEX "trading_decisions_owner_created_idx" ON "trading_decisions" USING btree ("owner_user_id","created_at");--> statement-breakpoint
ALTER TABLE "paper_accounts" ADD CONSTRAINT "paper_accounts_session_status_check" CHECK ("paper_accounts"."session_status" in ('stopped', 'running', 'paused'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_check" CHECK ("users"."status" in ('active', 'suspended'));