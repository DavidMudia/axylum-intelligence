CREATE TABLE "mt5_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bridge_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"login" text NOT NULL,
	"server" text NOT NULL,
	"broker" text DEFAULT '' NOT NULL,
	"account_type" text DEFAULT 'unknown' NOT NULL,
	"currency" text DEFAULT '' NOT NULL,
	"leverage" integer DEFAULT 0 NOT NULL,
	"balance" numeric(30, 12) DEFAULT '0' NOT NULL,
	"equity" numeric(30, 12) DEFAULT '0' NOT NULL,
	"free_margin" numeric(30, 12) DEFAULT '0' NOT NULL,
	"used_margin" numeric(30, 12) DEFAULT '0' NOT NULL,
	"margin_level" numeric(30, 12),
	"floating_profit" numeric(30, 12) DEFAULT '0' NOT NULL,
	"trading_allowed" boolean DEFAULT false NOT NULL,
	"expert_allowed" boolean DEFAULT false NOT NULL,
	"connected" boolean DEFAULT false NOT NULL,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt5_accounts_type_check" CHECK ("mt5_accounts"."account_type" in ('demo', 'live', 'contest', 'unknown'))
);
--> statement-breakpoint
CREATE TABLE "mt5_bridges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"terminal_version" text,
	"last_heartbeat_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mt5_bridges_status_check" CHECK ("mt5_bridges"."status" in ('online', 'offline', 'degraded', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "mt5_instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"broker_symbol" text NOT NULL,
	"canonical_symbol" text NOT NULL,
	"asset_class" text DEFAULT 'other' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"base_currency" text,
	"quote_currency" text,
	"digits" integer NOT NULL,
	"point" numeric(30, 18) NOT NULL,
	"tick_size" numeric(30, 18) NOT NULL,
	"tick_value" numeric(30, 12) NOT NULL,
	"contract_size" numeric(30, 12) NOT NULL,
	"volume_min" numeric(30, 12) NOT NULL,
	"volume_max" numeric(30, 12) NOT NULL,
	"volume_step" numeric(30, 12) NOT NULL,
	"stops_level_points" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mt5_instruments_asset_class_check" CHECK ("mt5_instruments"."asset_class" in ('forex', 'metal', 'index', 'commodity', 'crypto', 'other'))
);
--> statement-breakpoint
CREATE TABLE "mt5_market_candles" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"timeframe" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"open" numeric(30, 12) NOT NULL,
	"high" numeric(30, 12) NOT NULL,
	"low" numeric(30, 12) NOT NULL,
	"close" numeric(30, 12) NOT NULL,
	"tick_volume" numeric(36, 18) NOT NULL,
	"real_volume" numeric(36, 18) NOT NULL,
	"spread_points" integer DEFAULT 0 NOT NULL,
	"is_closed" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mt5_market_candles_timeframe_check" CHECK ("mt5_market_candles"."timeframe" in ('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1'))
);
--> statement-breakpoint
CREATE TABLE "mt5_market_ticks" (
	"id" serial PRIMARY KEY NOT NULL,
	"instrument_id" uuid NOT NULL,
	"source_tick_id" text NOT NULL,
	"tick_time" timestamp with time zone NOT NULL,
	"bid" numeric(30, 12) NOT NULL,
	"ask" numeric(30, 12) NOT NULL,
	"last" numeric(30, 12),
	"volume" numeric(36, 18),
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD CONSTRAINT "mt5_accounts_bridge_id_mt5_bridges_id_fk" FOREIGN KEY ("bridge_id") REFERENCES "public"."mt5_bridges"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_accounts" ADD CONSTRAINT "mt5_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_bridges" ADD CONSTRAINT "mt5_bridges_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_instruments" ADD CONSTRAINT "mt5_instruments_account_id_mt5_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."mt5_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_market_candles" ADD CONSTRAINT "mt5_market_candles_instrument_id_mt5_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."mt5_instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mt5_market_ticks" ADD CONSTRAINT "mt5_market_ticks_instrument_id_mt5_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."mt5_instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_accounts_bridge_server_login_uidx" ON "mt5_accounts" USING btree ("bridge_id","server","login");--> statement-breakpoint
CREATE INDEX "mt5_accounts_owner_updated_idx" ON "mt5_accounts" USING btree ("owner_user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_bridges_token_hash_uidx" ON "mt5_bridges" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_bridges_owner_name_uidx" ON "mt5_bridges" USING btree ("owner_user_id","name");--> statement-breakpoint
CREATE INDEX "mt5_bridges_owner_status_idx" ON "mt5_bridges" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_instruments_account_symbol_uidx" ON "mt5_instruments" USING btree ("account_id","broker_symbol");--> statement-breakpoint
CREATE INDEX "mt5_instruments_canonical_symbol_idx" ON "mt5_instruments" USING btree ("canonical_symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_market_candles_instrument_tf_open_uidx" ON "mt5_market_candles" USING btree ("instrument_id","timeframe","open_time");--> statement-breakpoint
CREATE INDEX "mt5_market_candles_instrument_tf_close_idx" ON "mt5_market_candles" USING btree ("instrument_id","timeframe","close_time");--> statement-breakpoint
CREATE UNIQUE INDEX "mt5_market_ticks_instrument_source_uidx" ON "mt5_market_ticks" USING btree ("instrument_id","source_tick_id");--> statement-breakpoint
CREATE INDEX "mt5_market_ticks_instrument_time_idx" ON "mt5_market_ticks" USING btree ("instrument_id","tick_time");