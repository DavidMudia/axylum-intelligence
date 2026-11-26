CREATE TABLE "mt5_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"broker_ticket" text NOT NULL,
	"order_ticket" text,
	"position_ticket" text,
	"broker_symbol" text NOT NULL,
	"side" text NOT NULL,
	"entry" text NOT NULL,
	"volume" numeric(36, 18) NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"profit" numeric(30, 12) DEFAULT '0' NOT NULL,
	"commission" numeric(30, 12) DEFAULT '0' NOT NULL,
	"swap" numeric(30, 12) DEFAULT '0' NOT NULL,
	"comment" text DEFAULT '' NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mt5_order_intents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"bridge_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"client_order_id" text NOT NULL,
	"operation" text NOT NULL,
	"status" text NOT NULL,
	"broker_symbol" text,
	"side" text,
	"order_type" text,
	"requested_volume" numeric(36, 18),
	"filled_volume" numeric(36, 18) DEFAULT '0' NOT NULL,
	"price" numeric(30, 12),
	"stop_loss" numeric(30, 12),
	"take_profit" numeric(30, 12),
	"estimated_margin" numeric(30, 12),
	"risk_checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"broker_result" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	CONSTRAINT "mt5_order_intents_operation_check" CHECK ("mt5_order_intents"."operation" in ('place_order', 'modify_position', 'close_position', 'cancel_pending')),
	CONSTRAINT "mt5_order_intents_status_check" CHECK ("mt5_order_intents"."status" in ('preflight', 'validated', 'submitted', 'accepted', 'partially_filled', 'filled', 'rejected', 'unknown', 'cancelled', 'closed')),
	CONSTRAINT "mt5_order_intents_side_check" CHECK ("mt5_order_intents"."side" is null or "mt5_order_intents"."side" in ('buy', 'sell'))
);
--> statement-breakpoint
CREATE TABLE "mt5_pending_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"broker_ticket" text NOT NULL,
	"broker_symbol" text NOT NULL,
	"order_type" text NOT NULL,
	"side" text NOT NULL,
	"volume" numeric(36, 18) NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"stop_loss" numeric(30, 12),
	"take_profit" numeric(30, 12),
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "mt5_pending_orders_side_check" CHECK ("mt5_pending_orders"."side" in ('buy', 'sell'))
);
--> statement-breakpoint
CREATE TABLE "mt5_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"broker_ticket" text NOT NULL,
	"broker_symbol" text NOT NULL,
	"side" text NOT NULL,
	"volume" numeric(36, 18) NOT NULL,
	"open_price" numeric(30, 12) NOT NULL,
	"current_price" numeric(30, 12) NOT NULL,
	"stop_loss" numeric(30, 12),
	"take_profit" numeric(30, 12),
	"profit" numeric(30, 12) DEFAULT '0' NOT NULL,
	"swap" numeric(30, 12) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "mt5_positions_side_check" CHECK ("mt5_positions"."side" in ('buy', 'sell'))
);
--> statement-breakpoint
ALTER TABLE "mt5_bridges" DROP CONSTRAINT "mt5_bridges_status_check";--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD COLUMN "day_start_equity" numeric(30, 12) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD COLUMN "day_start_date" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD COLUMN "peak_equity" numeric(30, 12) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "mt5_deals" ADD CONSTRAINT "mt5_deals_account_id_mt5_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_order_intents" ADD CONSTRAINT "mt5_order_intents_account_id_mt5_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_order_intents" ADD CONSTRAINT "mt5_order_intents_bridge_id_mt5_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."mt5_bridges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_order_intents" ADD CONSTRAINT "mt5_order_intents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_pending_orders" ADD CONSTRAINT "mt5_pending_orders_account_id_mt5_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_positions" ADD CONSTRAINT "mt5_positions_account_id_mt5_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_deals_account_ticket_uidx" ON "mt5_deals" USING btree ("account_id","broker_ticket");--> statement-breakpoint
CREATE INDEX "mt5_deals_account_time_idx" ON "mt5_deals" USING btree ("account_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_order_intents_account_client_uidx" ON "mt5_order_intents" USING btree ("account_id","client_order_id");--> statement-breakpoint
CREATE INDEX "mt5_order_intents_bridge_status_created_idx" ON "mt5_order_intents" USING btree ("bridge_id","status","created_at");--> statement-breakpoint
CREATE INDEX "mt5_order_intents_owner_created_idx" ON "mt5_order_intents" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_pending_orders_account_ticket_uidx" ON "mt5_pending_orders" USING btree ("account_id","broker_ticket");--> statement-breakpoint
CREATE INDEX "mt5_pending_orders_account_active_idx" ON "mt5_pending_orders" USING btree ("account_id","active");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_positions_account_ticket_uidx" ON "mt5_positions" USING btree ("account_id","broker_ticket");--> statement-breakpoint
CREATE INDEX "mt5_positions_account_open_idx" ON "mt5_positions" USING btree ("account_id","closed_at");--> statement-breakpoint
ALTER TABLE "mt5_bridges" ADD CONSTRAINT "mt5_bridges_status_check" CHECK ("mt5_bridges"."status" in ('online', 'offline', 'degraded'));