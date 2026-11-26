import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@backend/db";
import {
  marketCandles,
  marketIngestionStatus,
  marketOrderBookSnapshots,
  marketOrderBookUpdates,
  marketTrades,
} from "@backend/db/schema";
import type { MarketCandle, MarketTrade, OrderBookSnapshot, OrderBookUpdate } from "./types";

type MarketDataBatch = {
  candles: MarketCandle[];
  trades: MarketTrade[];
  orderBookUpdates: OrderBookUpdate[];
};

type IngestionStatus = typeof marketIngestionStatus.$inferInsert;

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

export async function persistMarketDataBatch(batch: MarketDataBatch): Promise<void> {
  if (!batch.candles.length && !batch.trades.length && !batch.orderBookUpdates.length) return;

  await db.transaction(async (transaction) => {
    for (const values of chunks(batch.candles, 500)) {
      await transaction
        .insert(marketCandles)
        .values(values)
        .onConflictDoUpdate({
          target: [marketCandles.symbol, marketCandles.interval, marketCandles.openTime],
          setWhere: sql`excluded.received_at >= ${marketCandles.receivedAt}`,
          set: {
            closeTime: sql`excluded.close_time`,
            eventTime: sql`excluded.event_time`,
            open: sql`excluded.open`,
            high: sql`excluded.high`,
            low: sql`excluded.low`,
            close: sql`excluded.close`,
            baseVolume: sql`excluded.base_volume`,
            quoteVolume: sql`excluded.quote_volume`,
            tradeCount: sql`excluded.trade_count`,
            takerBuyBaseVolume: sql`excluded.taker_buy_base_volume`,
            takerBuyQuoteVolume: sql`excluded.taker_buy_quote_volume`,
            isClosed: sql`excluded.is_closed`,
            receivedAt: sql`excluded.received_at`,
          },
        });
    }

    for (const values of chunks(batch.trades, 500)) {
      await transaction.insert(marketTrades).values(values).onConflictDoNothing();
    }

    for (const values of chunks(batch.orderBookUpdates, 250)) {
      await transaction
        .insert(marketOrderBookUpdates)
        .values(values.map((update) => ({ ...update, sequenceValid: update.sequenceValid ?? false })))
        .onConflictDoNothing();
    }
  });
}

export async function persistOrderBookSnapshot(snapshot: OrderBookSnapshot): Promise<void> {
  await db.insert(marketOrderBookSnapshots).values(snapshot);
}

export async function upsertIngestionStatus(status: IngestionStatus): Promise<void> {
  const { id, ...values } = status;
  await db
    .insert(marketIngestionStatus)
    .values(status)
    .onConflictDoUpdate({ target: marketIngestionStatus.id, set: values });
}

export async function getLatestCandleTime(symbol: string, interval: string): Promise<Date | null> {
  const [row] = await db
    .select({ openTime: marketCandles.openTime })
    .from(marketCandles)
    .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval)))
    .orderBy(desc(marketCandles.openTime))
    .limit(1);
  return row?.openTime ?? null;
}

export async function getCandles(symbol: string, interval: string, limit: number) {
  const rows = await db
    .select()
    .from(marketCandles)
    .where(and(eq(marketCandles.symbol, symbol), eq(marketCandles.interval, interval)))
    .orderBy(desc(marketCandles.openTime))
    .limit(limit);
  return rows.reverse();
}

export async function getRecentTrades(symbol: string, limit: number) {
  return db
    .select()
    .from(marketTrades)
    .where(eq(marketTrades.symbol, symbol))
    .orderBy(desc(marketTrades.tradeTime), desc(marketTrades.id))
    .limit(limit);
}

export async function getLatestOrderBookSnapshot(symbol: string) {
  const [snapshot] = await db
    .select()
    .from(marketOrderBookSnapshots)
    .where(eq(marketOrderBookSnapshots.symbol, symbol))
    .orderBy(desc(marketOrderBookSnapshots.capturedAt))
    .limit(1);
  return snapshot ?? null;
}

export async function getRecentOrderBookUpdates(symbol: string, limit: number) {
  return db
    .select()
    .from(marketOrderBookUpdates)
    .where(eq(marketOrderBookUpdates.symbol, symbol))
    .orderBy(desc(marketOrderBookUpdates.receivedAt))
    .limit(limit);
}

export async function getIngestionStatus(symbol: string) {
  const [status] = await db
    .select()
    .from(marketIngestionStatus)
    .where(eq(marketIngestionStatus.symbol, symbol))
    .orderBy(desc(marketIngestionStatus.updatedAt))
    .limit(1);
  return status ?? null;
}
