import "dotenv/config";
import { pool } from "@backend/db";
import { acquireWorkerLock } from "@backend/lib/server/worker-lock";
import { marketIngestionStatus } from "@backend/db/schema";
import { OrderBookSequenceTracker } from "./order-book-sequence";
import { createMarketDataProvider } from "./provider";
import { persistMarketDataBatch, persistOrderBookSnapshot, getLatestCandleTime, upsertIngestionStatus } from "./store";
import type { CandleInterval, MarketCandle, MarketDataEvent, MarketTrade, OrderBookUpdate } from "./types";

const VALID_INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
const MAX_PENDING_EVENTS = 50_000;
let poolShutdown: Promise<void> | null = null;
let releaseWorkerLock: (() => Promise<void>) | null = null;

function closePool(): Promise<void> {
  poolShutdown ??= pool.end();
  return poolShutdown;
}

function integerSetting(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function candleKey(candle: MarketCandle): string {
  return `${candle.symbol}:${candle.interval}:${candle.openTime.getTime()}`;
}

async function main(): Promise<void> {
  releaseWorkerLock = await acquireWorkerLock(pool, 83_710_422, "Binance market-data");
  const symbol = (process.env.MARKET_SYMBOL ?? "BTCUSDT").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol)) throw new Error("MARKET_SYMBOL must be a Binance spot symbol, such as BTCUSDT");

  const rawInterval = process.env.MARKET_INTERVAL ?? "1m";
  if (!VALID_INTERVALS.includes(rawInterval as CandleInterval)) {
    throw new Error(`MARKET_INTERVAL must be one of: ${VALID_INTERVALS.join(", ")}`);
  }
  const interval = rawInterval as CandleInterval;
  const backfillDays = integerSetting("MARKET_BACKFILL_DAYS", 30, 1, 365);
  const bookDepth = integerSetting("MARKET_ORDER_BOOK_DEPTH", 100, 5, 1000);
  const snapshotIntervalMs = integerSetting("MARKET_ORDER_BOOK_SNAPSHOT_INTERVAL_MS", 30_000, 5_000, 300_000);
  const staleAfterMs = integerSetting("MARKET_STALE_AFTER_MS", 15_000, 1_000, 300_000);
  const provider = createMarketDataProvider();
  const controller = new AbortController();
  const now = new Date();
  const status: typeof marketIngestionStatus.$inferInsert = {
    id: `${provider.id}:${symbol}`,
    provider: provider.id,
    symbol,
    state: "starting",
    startedAt: now,
    lastMessageAt: null,
    lastEventAt: null,
    lastCandleAt: null,
    lastTradeAt: null,
    lastOrderBookAt: null,
    orderBookSequenceHealthy: false,
    backfillCompletedAt: null,
    reconnectCount: 0,
    lastError: null,
    updatedAt: now,
  };
  const pendingCandles = new Map<string, MarketCandle>();
  let pendingTrades: MarketTrade[] = [];
  let pendingDepth: OrderBookUpdate[] = [];
  const runtime = { fatalError: null as Error | null };
  let flushInProgress = false;
  let websocketConnected = false;
  let sequenceTracker: OrderBookSequenceTracker | null = null;
  let resyncInProgress = false;
  const bufferedDepth: OrderBookUpdate[] = [];
  let requestBookResync = () => {};
  let resyncTimer: NodeJS.Timeout | undefined;
  let resyncTask: Promise<void> | null = null;
  let statusWrite = Promise.resolve();
  let flushRetryAt = 0;
  let flushRetryDelayMs = 500;

  const pendingCount = () => pendingCandles.size + pendingTrades.length + pendingDepth.length;
  const writeStatus = () => {
    status.updatedAt = new Date();
    statusWrite = statusWrite.then(async () => {
      await upsertIngestionStatus(status);
      if (status.lastError?.startsWith("Status persistence failed")) {
        status.lastError = null;
        if (websocketConnected && status.orderBookSequenceHealthy) status.state = "streaming";
      }
    }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      status.state = "degraded";
      status.lastError = `Status persistence failed: ${message}`;
      console.error(`[market-data] ${status.lastError}`);
    });
    return statusWrite;
  };

  const queueEvent = (event: MarketDataEvent) => {
    if (pendingCount() >= MAX_PENDING_EVENTS) {
      runtime.fatalError = new Error(`Market data write queue exceeded ${MAX_PENDING_EVENTS} events`);
      status.lastError = runtime.fatalError.message;
      controller.abort();
      return;
    }

    status.lastMessageAt = event.data.receivedAt;
    if (websocketConnected && status.state === "degraded" && status.lastError?.startsWith("No market data received")) {
      status.state = "streaming";
      status.lastError = null;
    }
    if (event.type === "candle") {
      pendingCandles.set(candleKey(event.data), event.data);
      status.lastEventAt = event.data.eventTime ?? event.data.receivedAt;
      status.lastCandleAt = event.data.receivedAt;
    } else if (event.type === "trade") {
      pendingTrades.push(event.data);
      status.lastEventAt = event.data.tradeTime;
      status.lastTradeAt = event.data.receivedAt;
    } else {
      const update = { ...event.data, sequenceValid: false };
      pendingDepth.push(update);
      status.lastEventAt = event.data.eventTime;
      status.lastOrderBookAt = event.data.receivedAt;
      if (resyncInProgress) {
        bufferedDepth.push(update);
        return;
      }

      const sequenceResult = sequenceTracker?.accept(update) ?? "unsynchronized";
      update.sequenceValid = sequenceResult === "accepted";
      if (sequenceResult === "gap" || sequenceResult === "unsynchronized") {
        status.orderBookSequenceHealthy = false;
        status.state = "degraded";
        status.lastError = "Order book update sequence gap detected; resynchronizing from REST snapshot";
        requestBookResync();
      }
    }
  };

  const restoreBatch = (candles: MarketCandle[], trades: MarketTrade[], depth: OrderBookUpdate[]) => {
    for (const candle of candles) {
      const key = candleKey(candle);
      const newer = pendingCandles.get(key);
      if (!newer || newer.receivedAt < candle.receivedAt) pendingCandles.set(key, candle);
    }
    pendingTrades = trades.concat(pendingTrades);
    pendingDepth = depth.concat(pendingDepth);
  };

  const flush = async () => {
    if (flushInProgress || pendingCount() === 0) return;
    flushInProgress = true;
    const candles = [...pendingCandles.values()];
    const trades = pendingTrades.splice(0, pendingTrades.length);
    const depth = pendingDepth.splice(0, pendingDepth.length);
    pendingCandles.clear();
    try {
      await persistMarketDataBatch({ candles, trades, orderBookUpdates: depth });
    } catch (error) {
      restoreBatch(candles, trades, depth);
      throw error;
    } finally {
      flushInProgress = false;
    }
  };

  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  let flushTimer: NodeJS.Timeout | undefined;
  let heartbeatTimer: NodeJS.Timeout | undefined;
  let snapshotTimer: NodeJS.Timeout | undefined;
  let snapshotInProgress = false;
  let snapshotTask: Promise<void> | null = null;
  let subscriptionTask: Promise<void> | null = null;
  let workerError: Error | null = null;

  try {
    status.state = "starting";
    await writeStatus();

    const initialSnapshot = await provider.fetchOrderBookSnapshot(symbol, bookDepth, controller.signal);
    await persistOrderBookSnapshot(initialSnapshot);
    sequenceTracker = new OrderBookSequenceTracker(initialSnapshot.lastUpdateId);
    status.orderBookSequenceHealthy = true;
    status.lastOrderBookAt = initialSnapshot.capturedAt;
    status.state = "connecting";
    await writeStatus();

    const resynchronizeOrderBook = async () => {
      if (resyncInProgress || controller.signal.aborted) return;
      resyncInProgress = true;
      status.orderBookSequenceHealthy = false;
      try {
        const snapshot = await provider.fetchOrderBookSnapshot(symbol, bookDepth, controller.signal);
        await persistOrderBookSnapshot(snapshot);
        sequenceTracker?.reset(snapshot.lastUpdateId);
        let sequenceGap = false;
        for (const update of bufferedDepth.splice(0)) {
          const result = sequenceTracker?.accept(update) ?? "unsynchronized";
          update.sequenceValid = result === "accepted";
          if (result === "gap" || result === "unsynchronized") sequenceGap = true;
        }
        status.lastOrderBookAt = snapshot.capturedAt;
        status.orderBookSequenceHealthy = !sequenceGap;
        if (sequenceGap) {
          sequenceTracker?.invalidate();
          status.lastError = "Order book sequence still has a gap after snapshot refresh";
          status.state = "degraded";
        } else {
          if (websocketConnected) status.state = "streaming";
          if (status.lastError?.startsWith("Order book")) status.lastError = null;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        status.lastError = `Order book resynchronization failed: ${message}`;
        console.error(`[market-data] ${status.lastError}`);
      } finally {
        resyncInProgress = false;
        if (!status.orderBookSequenceHealthy && !controller.signal.aborted && !resyncTimer) {
          resyncTimer = setTimeout(() => {
            resyncTimer = undefined;
            requestBookResync();
          }, 2_000);
        }
      }
    };
    requestBookResync = () => {
      if (!resyncInProgress && !controller.signal.aborted) {
        resyncTask = resynchronizeOrderBook();
      }
    };

    flushTimer = setInterval(() => {
      if (Date.now() < flushRetryAt) return;
      void flush().then(() => {
        flushRetryAt = 0;
        flushRetryDelayMs = 500;
        if (status.lastError?.startsWith("Market data persistence failed")) {
          status.lastError = null;
          if (websocketConnected && status.orderBookSequenceHealthy) status.state = "streaming";
        }
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        status.state = "degraded";
        status.lastError = `Market data persistence failed: ${message}`;
        console.error(`[market-data] retaining queued events; retrying in ${flushRetryDelayMs}ms: ${message}`);
        flushRetryAt = Date.now() + flushRetryDelayMs;
        flushRetryDelayMs = Math.min(flushRetryDelayMs * 2, 30_000);
      });
    }, 250);

    heartbeatTimer = setInterval(() => {
      if (status.lastMessageAt && Date.now() - status.lastMessageAt.getTime() > staleAfterMs && status.state === "streaming") {
        status.state = "degraded";
        status.lastError = `No market data received for more than ${staleAfterMs}ms`;
      }
      void writeStatus();
    }, 5_000);

    snapshotTimer = setInterval(() => {
      if (snapshotInProgress || controller.signal.aborted) return;
      snapshotInProgress = true;
      snapshotTask = provider
        .fetchOrderBookSnapshot(symbol, bookDepth, controller.signal)
        .then(async (snapshot) => {
          await persistOrderBookSnapshot(snapshot);
          status.lastOrderBookAt = snapshot.capturedAt;
          if (status.lastError?.startsWith("Order book snapshot failed")) status.lastError = null;
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          status.lastError = `Order book snapshot failed: ${message}`;
          console.error(`[market-data] ${status.lastError}`);
        })
        .finally(() => {
          snapshotInProgress = false;
          snapshotTask = null;
        });
    }, snapshotIntervalMs);

    subscriptionTask = provider.subscribe(
      symbol,
      interval,
      {
        onEvent: queueEvent,
        onConnection: (connectionState, reconnectCount, retryInMs) => {
          websocketConnected = connectionState === "connected";
          if (connectionState === "connected") {
            if (status.lastError?.startsWith("Binance provider error:")) status.lastError = null;
            const persistenceError =
              status.lastError?.startsWith("Market data persistence failed") ||
              status.lastError?.startsWith("Status persistence failed");
            status.state = status.orderBookSequenceHealthy && !persistenceError ? "streaming" : "degraded";
          } else {
            status.state = connectionState === "disconnected" ? "stopped" : connectionState;
          }
          status.reconnectCount = reconnectCount;
          if (connectionState === "reconnecting") {
            sequenceTracker?.invalidate();
            status.orderBookSequenceHealthy = false;
          }
          if (connectionState === "connected") status.lastError = null;
          void writeStatus();
          if (retryInMs) console.warn(`[market-data] reconnecting in ${retryInMs}ms`);
        },
        onError: (error) => {
          status.lastError = `Binance provider error: ${error.message}`;
          console.error(`[market-data] provider error: ${error.message}`);
        },
      },
      controller.signal,
    );

    const nowMs = Date.now();
    const earliestAllowed = nowMs - backfillDays * 86_400_000;
    const latestCandle = await getLatestCandleTime(symbol, interval);
    const from = new Date(Math.max(earliestAllowed, latestCandle?.getTime() ?? earliestAllowed));
    const candles = await provider.fetchHistoricalCandles(symbol, interval, from, new Date(nowMs), controller.signal);
    await persistMarketDataBatch({ candles, trades: [], orderBookUpdates: [] });
    status.backfillCompletedAt = new Date();
    const latestBackfillAt = candles[candles.length - 1]?.receivedAt;
    if (latestBackfillAt && (!status.lastCandleAt || latestBackfillAt > status.lastCandleAt)) {
      status.lastCandleAt = latestBackfillAt;
    }
    console.info(`[market-data] backfilled ${candles.length} ${interval} candles for ${symbol}`);
    await writeStatus();
    await subscriptionTask;
  } catch (error) {
    if (!controller.signal.aborted) {
      workerError = error instanceof Error ? error : new Error(String(error));
      status.state = "degraded";
      status.lastError = workerError.message;
      throw workerError;
    }
  } finally {
    controller.abort();
    if (flushTimer) clearInterval(flushTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (snapshotTimer) clearInterval(snapshotTimer);
    if (resyncTimer) clearTimeout(resyncTimer);
    if (subscriptionTask) await subscriptionTask;
    if (resyncTask) await resyncTask;
    if (snapshotTask) await snapshotTask;
    await flush().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      status.lastError = message;
      runtime.fatalError ??= error instanceof Error ? error : new Error(message);
      console.error(`[market-data] final flush failed: ${message}`);
    });
    status.state = runtime.fatalError || workerError ? "degraded" : "stopped";
    await writeStatus();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    if (releaseWorkerLock) await releaseWorkerLock();
    await closePool();
  }

  if (runtime.fatalError) {
    console.error(`[market-data] worker stopped: ${runtime.fatalError.message}`);
    process.exitCode = 1;
  }
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[market-data] worker failed: ${message}`);
  process.exitCode = 1;
  if (releaseWorkerLock) await releaseWorkerLock().catch((lockError: unknown) => {
    console.error(`[market-data] worker lock release failed: ${String(lockError)}`);
  });
  await closePool().catch((poolError: unknown) => {
    console.error(`[market-data] database pool shutdown failed: ${String(poolError)}`);
  });
});
