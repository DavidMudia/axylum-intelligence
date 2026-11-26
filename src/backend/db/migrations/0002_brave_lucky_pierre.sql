CREATE TABLE "backtest_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_slug" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"from_time" timestamp with time zone NOT NULL,
	"to_time" timestamp with time zone NOT NULL,
	"metrics" jsonb NOT NULL,
	"equity_curve" jsonb NOT NULL,
	"trades" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_health" (
	"engine" text PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"last_cycle_at" timestamp with time zone,
	"last_error" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engine_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"engine" text NOT NULL,
	"level" text NOT NULL,
	"event" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"candle_open_time" timestamp with time zone NOT NULL,
	"observed" jsonb NOT NULL,
	"indicators" jsonb NOT NULL,
	"regime" jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"currency" text DEFAULT 'USDT' NOT NULL,
	"starting_balance" numeric(30, 12) NOT NULL,
	"cash_balance" numeric(30, 12) NOT NULL,
	"realized_pnl" numeric(30, 12) DEFAULT '0' NOT NULL,
	"peak_equity" numeric(30, 12) NOT NULL,
	"day_start_equity" numeric(30, 12) NOT NULL,
	"day_start_date" text NOT NULL,
	"halted" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"symbol" text PRIMARY KEY NOT NULL,
	"quantity" numeric(36, 18) NOT NULL,
	"average_entry_price" numeric(30, 12) NOT NULL,
	"mark_price" numeric(30, 12) NOT NULL,
	"stop_loss" numeric(30, 12),
	"take_profit" numeric(30, 12),
	"realized_pnl" numeric(30, 12) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"max_risk_per_trade_pct" double precision NOT NULL,
	"max_daily_loss_pct" double precision NOT NULL,
	"max_drawdown_pct" double precision NOT NULL,
	"max_position_pct" double precision NOT NULL,
	"max_concurrent_positions" integer NOT NULL,
	"min_risk_reward" double precision NOT NULL,
	"max_exposure_pct" double precision NOT NULL,
	"fee_rate" double precision NOT NULL,
	"slippage_rate" double precision NOT NULL,
	"starting_balance" numeric(30, 12) NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_decisions" (
	"id" serial PRIMARY KEY NOT NULL,
	"strategy_slug" text NOT NULL,
	"strategy_version" integer NOT NULL,
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"candle_open_time" timestamp with time zone NOT NULL,
	"action" text NOT NULL,
	"status" text NOT NULL,
	"entry_price" numeric(30, 12),
	"stop_loss" numeric(30, 12),
	"take_profit" numeric(30, 12),
	"risk_reward" double precision,
	"confidence" double precision NOT NULL,
	"regime" text NOT NULL,
	"supporting_indicators" jsonb NOT NULL,
	"explanation" text NOT NULL,
	"invalidation" jsonb NOT NULL,
	"risk_checks" jsonb,
	"order_id" integer,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trading_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "client_order_id" text;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "order_type" text DEFAULT 'market' NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "limit_price" numeric(30, 12);--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "stop_loss" numeric(30, 12);--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "take_profit" numeric(30, 12);--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "realized_pnl" double precision DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "decision_id" integer;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "risk_details" jsonb;--> statement-breakpoint
ALTER TABLE "paper_orders" ADD COLUMN "executed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "backtest_runs_strategy_created_idx" ON "backtest_runs" USING btree ("strategy_slug","created_at");--> statement-breakpoint
CREATE INDEX "engine_logs_engine_created_idx" ON "engine_logs" USING btree ("engine","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_analyses_symbol_interval_candle_uidx" ON "market_analyses" USING btree ("symbol","interval","candle_open_time");--> statement-breakpoint
CREATE INDEX "market_analyses_created_at_idx" ON "market_analyses" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_decisions_strategy_symbol_interval_candle_uidx" ON "trading_decisions" USING btree ("strategy_slug","symbol","interval","candle_open_time");--> statement-breakpoint
CREATE INDEX "trading_decisions_created_at_idx" ON "trading_decisions" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trading_strategies_slug_uidx" ON "trading_strategies" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "trading_strategies_active_idx" ON "trading_strategies" USING btree ("active");