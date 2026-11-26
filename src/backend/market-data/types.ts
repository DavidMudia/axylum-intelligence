export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type BookLevel = [price: string, quantity: string];

export type MarketCandle = {
  symbol: string;
  interval: CandleInterval;
  openTime: Date;
  closeTime: Date;
  eventTime: Date | null;
  open: string;
  high: string;
  low: string;
  close: string;
  baseVolume: string;
  quoteVolume: string;
  tradeCount: number;
  takerBuyBaseVolume: string;
  takerBuyQuoteVolume: string;
  isClosed: boolean;
  receivedAt: Date;
};

export type MarketTrade = {
  symbol: string;
  tradeId: string;
  price: string;
  quantity: string;
  tradeTime: Date;
  buyerIsMaker: boolean;
  receivedAt: Date;
};

export type OrderBookUpdate = {
  symbol: string;
  firstUpdateId: string;
  lastUpdateId: string;
  eventTime: Date;
  receivedAt: Date;
  bids: BookLevel[];
  asks: BookLevel[];
  sequenceValid?: boolean;
};

export type OrderBookSnapshot = {
  symbol: string;
  lastUpdateId: string;
  capturedAt: Date;
  bids: BookLevel[];
  asks: BookLevel[];
};

export type MarketDataEvent =
  | { type: "candle"; data: MarketCandle }
  | { type: "trade"; data: MarketTrade }
  | { type: "order-book-update"; data: OrderBookUpdate };

export type ConnectionState = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface MarketDataHandlers {
  onEvent(event: MarketDataEvent): void;
  onConnection(state: ConnectionState, reconnectCount: number, retryInMs?: number): void;
  onError(error: Error): void;
}

export interface MarketDataProvider {
  readonly id: string;
  fetchHistoricalCandles(
    symbol: string,
    interval: CandleInterval,
    from: Date,
    to: Date,
    signal?: AbortSignal,
  ): Promise<MarketCandle[]>;
  fetchOrderBookSnapshot(symbol: string, limit: number, signal?: AbortSignal): Promise<OrderBookSnapshot>;
  subscribe(symbol: string, interval: CandleInterval, handlers: MarketDataHandlers, signal: AbortSignal): Promise<void>;
}
