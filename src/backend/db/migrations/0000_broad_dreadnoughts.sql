CREATE TABLE "activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text NOT NULL,
	"asset" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" text NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_candles" (
	"symbol" text NOT NULL,
	"interval" text NOT NULL,
	"open_time" timestamp with time zone NOT NULL,
	"close_time" timestamp with time zone NOT NULL,
	"event_time" timestamp with time zone,
	"open" numeric(30, 12) NOT NULL,
	"high" numeric(30, 12) NOT NULL,
	"low" numeric(30, 12) NOT NULL,
	"close" numeric(30, 12) NOT NULL,
	"base_volume" numeric(36, 18) NOT NULL,
	"quote_volume" numeric(36, 18) NOT NULL,
	"trade_count" integer NOT NULL,
	"taker_buy_base_volume" numeric(36, 18) NOT NULL,
	"taker_buy_quote_volume" numeric(36, 18) NOT NULL,
	"is_closed" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_ingestion_status" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"symbol" text NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_message_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"last_candle_at" timestamp with time zone,
	"last_trade_at" timestamp with time zone,
	"last_order_book_at" timestamp with time zone,
	"backfill_completed_at" timestamp with time zone,
	"reconnect_count" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_order_book_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"last_update_id" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"bids" jsonb NOT NULL,
	"asks" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_order_book_updates" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"first_update_id" text NOT NULL,
	"last_update_id" text NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone NOT NULL,
	"bids" jsonb NOT NULL,
	"asks" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "market_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"trade_id" text NOT NULL,
	"price" numeric(30, 12) NOT NULL,
	"quantity" numeric(36, 18) NOT NULL,
	"trade_time" timestamp with time zone NOT NULL,
	"buyer_is_maker" boolean NOT NULL,
	"received_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "paper_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"side" text NOT NULL,
	"quantity" double precision NOT NULL,
	"price" double precision NOT NULL,
	"fee" double precision DEFAULT 0 NOT NULL,
	"slippage" double precision DEFAULT 0 NOT NULL,
	"status" text NOT NULL,
	"reason" text,
	"strategy" text,
	"risk_checks" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"rules" jsonb NOT NULL,
	"risk" jsonb NOT NULL,
	"result" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_state" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_candles_symbol_interval_open_time_uidx" ON "market_candles" USING btree ("symbol","interval","open_time");--> statement-breakpoint
CREATE INDEX "market_candles_symbol_interval_close_time_idx" ON "market_candles" USING btree ("symbol","interval","close_time");--> statement-breakpoint
CREATE INDEX "market_ingestion_status_symbol_updated_at_idx" ON "market_ingestion_status" USING btree ("symbol","updated_at");--> statement-breakpoint
CREATE INDEX "market_order_book_snapshots_symbol_captured_at_idx" ON "market_order_book_snapshots" USING btree ("symbol","captured_at");--> statement-breakpoint
CREATE INDEX "market_order_book_updates_symbol_received_at_idx" ON "market_order_book_updates" USING btree ("symbol","received_at");--> statement-breakpoint
CREATE UNIQUE INDEX "market_order_book_updates_symbol_last_update_uidx" ON "market_order_book_updates" USING btree ("symbol","last_update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "market_trades_symbol_trade_id_uidx" ON "market_trades" USING btree ("symbol","trade_id");--> statement-breakpoint
CREATE INDEX "market_trades_symbol_trade_time_idx" ON "market_trades" USING btree ("symbol","trade_time");