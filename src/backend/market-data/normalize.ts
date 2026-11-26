import type { BookLevel, CandleInterval, MarketCandle, MarketTrade, OrderBookSnapshot, OrderBookUpdate } from "./types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function decimal(value: unknown, label: string, allowZero = false): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${label} must be a decimal string`);
  }
  const result = String(value);
  if (!/^\d+(?:\.\d+)?$/.test(result) || !Number.isFinite(Number(result))) {
    throw new Error(`${label} is not a valid decimal`);
  }
  const number = Number(result);
  if (allowZero ? number < 0 : number <= 0) {
    throw new Error(`${label} must be ${allowZero ? "non-negative" : "positive"}`);
  }
  return result;
}

function timestamp(value: unknown, label: string): Date {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive millisecond timestamp`);
  }
  return new Date(value);
}

function integer(value: unknown, label: string): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return result;
}

function levels(value: unknown, label: string, allowZeroQuantity: boolean): BookLevel[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((level, index) => {
    if (!Array.isArray(level) || level.length < 2) throw new Error(`${label}[${index}] must contain price and quantity`);
    return [
      decimal(level[0], `${label}[${index}].price`),
      decimal(level[1], `${label}[${index}].quantity`, allowZeroQuantity),
    ];
  });
}

function validateCandle(candle: MarketCandle): MarketCandle {
  const open = Number(candle.open);
  const high = Number(candle.high);
  const low = Number(candle.low);
  const close = Number(candle.close);
  if (low > Math.min(open, close) || high < Math.max(open, close) || high < low) {
    throw new Error("Candle OHLC values are inconsistent");
  }
  if (candle.closeTime.getTime() < candle.openTime.getTime()) {
    throw new Error("Candle close time precedes open time");
  }
  return candle;
}

export function normalizeRestKline(
  value: unknown,
  symbol: string,
  interval: CandleInterval,
  receivedAt = new Date(),
): MarketCandle {
  if (!Array.isArray(value) || value.length < 11) throw new Error("Binance kline row is incomplete");
  const closeTime = timestamp(value[6], "kline close time");
  return validateCandle({
    symbol,
    interval,
    openTime: timestamp(value[0], "kline open time"),
    closeTime,
    eventTime: null,
    open: decimal(value[1], "kline open"),
    high: decimal(value[2], "kline high"),
    low: decimal(value[3], "kline low"),
    close: decimal(value[4], "kline close"),
    baseVolume: decimal(value[5], "kline volume", true),
    quoteVolume: decimal(value[7], "kline quote volume", true),
    tradeCount: integer(value[8], "kline trade count"),
    takerBuyBaseVolume: decimal(value[9], "kline taker buy base volume", true),
    takerBuyQuoteVolume: decimal(value[10], "kline taker buy quote volume", true),
    isClosed: closeTime.getTime() <= receivedAt.getTime(),
    receivedAt,
  });
}

export function normalizeWebSocketKline(value: unknown, receivedAt = new Date()): MarketCandle {
  const event = record(value, "kline event");
  const kline = record(event.k, "kline payload");
  const closeTime = timestamp(kline.T, "kline close time");
  const intervals: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];
  if (
    typeof kline.s !== "string" ||
    typeof kline.i !== "string" ||
    !intervals.includes(kline.i as CandleInterval) ||
    typeof kline.x !== "boolean"
  ) {
    throw new Error("Kline symbol, interval, or close status is invalid");
  }
  return validateCandle({
    symbol: kline.s,
    interval: kline.i as CandleInterval,
    openTime: timestamp(kline.t, "kline open time"),
    closeTime,
    eventTime: timestamp(event.E, "kline event time"),
    open: decimal(kline.o, "kline open"),
    high: decimal(kline.h, "kline high"),
    low: decimal(kline.l, "kline low"),
    close: decimal(kline.c, "kline close"),
    baseVolume: decimal(kline.v, "kline volume", true),
    quoteVolume: decimal(kline.q, "kline quote volume", true),
    tradeCount: integer(kline.n, "kline trade count"),
    takerBuyBaseVolume: decimal(kline.V, "kline taker buy base volume", true),
    takerBuyQuoteVolume: decimal(kline.Q, "kline taker buy quote volume", true),
    isClosed: kline.x,
    receivedAt,
  });
}

export function normalizeTrade(value: unknown, receivedAt = new Date()): MarketTrade {
  const event = record(value, "trade event");
  if (typeof event.s !== "string" || typeof event.m !== "boolean") throw new Error("Trade symbol or maker side is invalid");
  const tradeId = String(event.t);
  if (!/^\d+$/.test(tradeId)) throw new Error("Trade ID is invalid");
  return {
    symbol: event.s,
    tradeId,
    price: decimal(event.p, "trade price"),
    quantity: decimal(event.q, "trade quantity"),
    tradeTime: timestamp(event.T, "trade time"),
    buyerIsMaker: event.m,
    receivedAt,
  };
}

export function normalizeDepthUpdate(value: unknown, receivedAt = new Date()): OrderBookUpdate {
  const event = record(value, "depth event");
  if (typeof event.s !== "string") throw new Error("Depth event symbol is invalid");
  const firstUpdateId = String(event.U);
  const lastUpdateId = String(event.u);
  if (!/^\d+$/.test(firstUpdateId) || !/^\d+$/.test(lastUpdateId)) throw new Error("Depth update IDs are invalid");
  if (BigInt(firstUpdateId) > BigInt(lastUpdateId)) throw new Error("Depth update range is reversed");
  return {
    symbol: event.s,
    firstUpdateId,
    lastUpdateId,
    eventTime: timestamp(event.E, "depth event time"),
    receivedAt,
    bids: levels(event.b, "depth bids", true),
    asks: levels(event.a, "depth asks", true),
  };
}

export function normalizeDepthSnapshot(value: unknown, symbol: string, capturedAt = new Date()): OrderBookSnapshot {
  const snapshot = record(value, "depth snapshot");
  const lastUpdateId = String(snapshot.lastUpdateId);
  if (!/^\d+$/.test(lastUpdateId)) throw new Error("Depth snapshot update ID is invalid");
  const bids = levels(snapshot.bids, "snapshot bids", false);
  const asks = levels(snapshot.asks, "snapshot asks", false);
  for (let index = 1; index < bids.length; index++) {
    if (Number(bids[index - 1][0]) < Number(bids[index][0])) throw new Error("Order book bids are not sorted from highest to lowest");
  }
  for (let index = 1; index < asks.length; index++) {
    if (Number(asks[index - 1][0]) > Number(asks[index][0])) throw new Error("Order book asks are not sorted from lowest to highest");
  }
  if (bids.length && asks.length && Number(bids[0][0]) >= Number(asks[0][0])) {
    throw new Error("Order book snapshot is crossed or unsorted");
  }
  return { symbol, lastUpdateId, capturedAt, bids, asks };
}
