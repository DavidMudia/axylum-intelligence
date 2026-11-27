CREATE TABLE "complimentary_account_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"slot_number" integer NOT NULL,
	"target_user_id" uuid,
	"target_email" text NOT NULL,
	"actor_user_id" uuid,
	"action" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_account_events_action_check" CHECK ("complimentary_account_events"."action" in ('founder_provisioned', 'assigned', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "complimentary_slots" (
	"slot_number" integer PRIMARY KEY NOT NULL,
	"founder_slot" boolean DEFAULT false NOT NULL,
	"user_id" uuid,
	"assigned_at" timestamp with time zone,
	"assigned_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "complimentary_slots_number_check" CHECK ("complimentary_slots"."slot_number" between 1 and 5),
	CONSTRAINT "complimentary_slots_founder_check" CHECK (("complimentary_slots"."slot_number" = 1 and "complimentary_slots"."founder_slot") or ("complimentary_slots"."slot_number" between 2 and 5 and not "complimentary_slots"."founder_slot"))
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"event_key" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"subscription_id" uuid,
	"plan_id" text NOT NULL,
	"provider" text DEFAULT 'paystack' NOT NULL,
	"reference" text NOT NULL,
	"provider_transaction_id" text,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp with time zone,
	"receipt_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_status_check" CHECK ("payments"."status" in ('pending', 'success', 'failed', 'refunded')),
	CONSTRAINT "payments_amount_check" CHECK ("payments"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "revenue_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"payment_id" uuid,
	"revenue_type" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"status" text DEFAULT 'verified' NOT NULL,
	"realized_profit" numeric(30, 12),
	"high_water_mark_before" numeric(30, 12),
	"high_water_mark_after" numeric(30, 12),
	"user_consent_at" timestamp with time zone,
	"audit_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "revenue_ledger_type_check" CHECK ("revenue_ledger"."revenue_type" in ('subscription', 'performance_fee')),
	CONSTRAINT "revenue_ledger_status_check" CHECK ("revenue_ledger"."status" in ('verified', 'pending', 'reversed')),
	CONSTRAINT "revenue_ledger_amount_check" CHECK ("revenue_ledger"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_plans" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"currency" text DEFAULT 'NGN' NOT NULL,
	"amount_minor" integer NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"trial_days" integer DEFAULT 0 NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_plans_amount_check" CHECK ("subscription_plans"."amount_minor" >= 0),
	CONSTRAINT "subscription_plans_interval_check" CHECK ("subscription_plans"."interval" = 'month'),
	CONSTRAINT "subscription_plans_trial_days_check" CHECK ("subscription_plans"."trial_days" between 0 and 30)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"source" text DEFAULT 'free' NOT NULL,
	"current_period_start" timestamp with time zone,
	"current_period_end" timestamp with time zone,
	"trial_ends_at" timestamp with time zone,
	"grace_ends_at" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"provider_customer_code" text,
	"provider_subscription_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('trialing', 'active', 'past_due', 'canceled', 'expired')),
	CONSTRAINT "subscriptions_source_check" CHECK ("subscriptions"."source" in ('free', 'paystack', 'trial'))
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_role_check";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "complimentary_account_events" ADD CONSTRAINT "complimentary_account_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_account_events" ADD CONSTRAINT "complimentary_account_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_slots" ADD CONSTRAINT "complimentary_slots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complimentary_slots" ADD CONSTRAINT "complimentary_slots_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD CONSTRAINT "revenue_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_ledger" ADD CONSTRAINT "revenue_ledger_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_subscription_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "complimentary_account_events_created_idx" ON "complimentary_account_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "complimentary_account_events_slot_created_idx" ON "complimentary_account_events" USING btree ("slot_number","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "complimentary_slots_user_uidx" ON "complimentary_slots" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_provider_key_uidx" ON "payment_webhook_events" USING btree ("provider","event_key");--> statement-breakpoint
CREATE INDEX "payment_webhook_events_received_idx" ON "payment_webhook_events" USING btree ("received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_reference_uidx" ON "payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_transaction_uidx" ON "payments" USING btree ("provider","provider_transaction_id");--> statement-breakpoint
CREATE INDEX "payments_user_created_idx" ON "payments" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_status_created_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "revenue_ledger_payment_uidx" ON "revenue_ledger" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "revenue_ledger_type_created_idx" ON "revenue_ledger" USING btree ("revenue_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_user_uidx" ON "subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_uidx" ON "subscriptions" USING btree ("provider_subscription_code");--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_end_idx" ON "subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "subscriptions_plan_status_idx" ON "subscriptions" USING btree ("plan_id","status");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("users"."role" in ('owner', 'admin', 'user'));--> statement-breakpoint
INSERT INTO "subscription_plans" ("id", "name", "description", "amount_minor", "trial_days", "features") VALUES
	('free', 'Free', 'Basic market intelligence, limited backtesting and paper trading.', 0, 0, '{"market_intelligence":true,"paper_trading":true,"strategy_builder":false,"backtests_per_day":3,"analytics":false,"mt5_demo":false,"automated_demo_strategies":false,"advanced_risk":false}'::jsonb),
	('starter', 'Starter', 'Expanded intelligence, strategy builder, backtesting and analytics.', 500000, 7, '{"market_intelligence":true,"paper_trading":true,"strategy_builder":true,"backtests_per_day":50,"analytics":true,"mt5_demo":false,"automated_demo_strategies":false,"advanced_risk":false}'::jsonb),
	('professional', 'Professional', 'All Starter features plus MT5 demo integration and advanced risk management.', 1000000, 7, '{"market_intelligence":true,"paper_trading":true,"strategy_builder":true,"backtests_per_day":200,"analytics":true,"mt5_demo":true,"automated_demo_strategies":true,"advanced_risk":true}'::jsonb)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "complimentary_slots" ("slot_number", "founder_slot") VALUES
	(1, true), (2, false), (3, false), (4, false), (5, false)
ON CONFLICT ("slot_number") DO NOTHING;--> statement-breakpoint
INSERT INTO "subscriptions" ("user_id", "plan_id", "status", "source")
SELECT "id", 'free', 'active', 'free' FROM "users"
ON CONFLICT ("user_id") DO NOTHING;