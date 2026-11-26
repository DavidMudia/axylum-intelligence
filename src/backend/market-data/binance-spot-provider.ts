import WebSocket, { type RawData } from "ws";
import { normalizeDepthSnapshot, normalizeDepthUpdate, normalizeRestKline, normalizeTrade, normalizeWebSocketKline } from "./normalize";
import type { CandleInterval, MarketDataEvent, MarketDataHandlers, MarketDataProvider, OrderBookSnapshot } from "./types";

const REST_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 5;
const MAX_RETRY_DELAY_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return signal ? wait(ms, signal) : new Promise((resolve) => setTimeout(resolve, ms));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Binance WebSocket message must be an object");
  }
  return value as Record<string, unknown>;
}

function messageText(data: RawData): string {
  if (typeof data === "string") return data;
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");
  return Buffer.from(data).toString("utf8");
}

export class BinanceSpotProvider implements MarketDataProvider {
  readonly id = "binance-spot";
  private readonly restBaseUrl = (process.env.BINANCE_REST_BASE_URL ?? "https://api.binance.com").replace(/\/+$/, "");
  private readonly wsBaseUrl = (process.env.BINANCE_WS_BASE_URL ?? "wss://stream.binance.com:9443").replace(/\/+$/, "");

  async fetchHistoricalCandles(symbol: string, interval: CandleInterval, from: Date, to: Date, signal?: AbortSignal) {
    if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) {
      throw new Error("Invalid historical candle time range");
    }

    const candles = [];
    let startTime = from.getTime();
    let pageCount = 0;
    while (startTime <= to.getTime()) {
      if (signal?.aborted) throw new Error("Binance historical candle request aborted");
      if (++pageCount > 10_000) throw new Error("Historical candle pagination exceeded its safety limit");
      const payload = await this.request(
        "/api/v3/klines",
        {
          symbol,
          interval,
          startTime: String(startTime),
          endTime: String(to.getTime()),
          limit: "1000",
        },
        signal,
      );
      if (!Array.isArray(payload)) throw new Error("Binance returned an invalid kline response");
      if (payload.length === 0) break;

      const receivedAt = new Date();
      const page = payload.map((row) => normalizeRestKline(row, symbol, interval, receivedAt));
      candles.push(...page);
      const nextStart = page[page.length - 1].closeTime.getTime() + 1;
      if (nextStart <= startTime) throw new Error("Binance kline pagination did not advance");
      startTime = nextStart;
      if (page.length < 1000) break;
      await delay(100, signal);
    }
    return candles;
  }

  async fetchOrderBookSnapshot(symbol: string, limit: number, signal?: AbortSignal): Promise<OrderBookSnapshot> {
    if (!Number.isInteger(limit) || limit < 5 || limit > 1000) {
      throw new Error("Order book depth must be an integer between 5 and 1000");
    }
    const payload = await this.request("/api/v3/depth", { symbol, limit: String(limit) }, signal);
    return normalizeDepthSnapshot(payload, symbol);
  }

  async subscribe(
    symbol: string,
    interval: CandleInterval,
    handlers: MarketDataHandlers,
    signal: AbortSignal,
  ): Promise<void> {
    const streamSymbol = symbol.toLowerCase();
    const streams = `${streamSymbol}@kline_${interval}/${streamSymbol}@trade/${streamSymbol}@depth@100ms`;
    const url = `${this.wsBaseUrl}/stream?streams=${streams}`;
    let reconnectCount = 0;
    let delayMs = 1000;

    while (!signal.aborted) {
      handlers.onConnection(reconnectCount === 0 ? "connecting" : "reconnecting", reconnectCount);
      try {
        await this.openStream(url, symbol, interval, handlers, signal, reconnectCount);
        if (signal.aborted) break;
        throw new Error("Binance WebSocket closed unexpectedly");
      } catch (error) {
        if (signal.aborted) break;
        reconnectCount++;
        const retryInMs = Math.min(delayMs, MAX_RECONNECT_DELAY_MS) * (0.75 + Math.random() * 0.5);
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        handlers.onError(normalizedError);
        handlers.onConnection("reconnecting", reconnectCount, Math.round(retryInMs));
        await wait(retryInMs, signal);
        delayMs = Math.min(delayMs * 2, MAX_RECONNECT_DELAY_MS);
      }
    }
    handlers.onConnection("disconnected", reconnectCount);
  }

  private async request(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<unknown> {
    const url = new URL(path, `${this.restBaseUrl}/`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error("Binance REST request aborted");
      try {
        const requestSignal = signal
          ? AbortSignal.any([signal, AbortSignal.timeout(REST_TIMEOUT_MS)])
          : AbortSignal.timeout(REST_TIMEOUT_MS);
        const response = await fetch(url, { signal: requestSignal });
        if (response.ok) return await response.json();

        const body = (await response.text()).slice(0, 500);
        const error = new Error(`Binance REST request failed (${response.status}): ${body}`);
        if (![418, 429].includes(response.status) && response.status < 500) throw error;

        lastError = error;
        if (attempt === MAX_RETRIES - 1) break;
        const retryAfter = Number(response.headers.get("retry-after")) * 1000;
        const backoff = Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS);
        await delay(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : backoff, signal);
      } catch (error) {
        if (signal?.aborted) throw new Error("Binance REST request aborted");
        if (error instanceof Error && error.message.startsWith("Binance REST request failed (")) throw error;
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt === MAX_RETRIES - 1) break;
        await delay(Math.min(500 * 2 ** attempt, MAX_RETRY_DELAY_MS), signal);
      }
    }
    throw new Error(`Binance REST request exhausted retries: ${lastError?.message ?? "unknown error"}`);
  }

  private openStream(
    url: string,
    symbol: string,
    interval: CandleInterval,
    handlers: MarketDataHandlers,
    signal: AbortSignal,
    reconnectCount: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url, { handshakeTimeout: REST_TIMEOUT_MS, maxPayload: 2 * 1024 * 1024 });
      let settled = false;
      let lastPongAt = Date.now();
      let heartbeat: NodeJS.Timeout | undefined;
      const connectTimeout = setTimeout(() => socket.terminate(), REST_TIMEOUT_MS);

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(connectTimeout);
        if (heartbeat) clearInterval(heartbeat);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };

      const abort = () => {
        if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Ingestion worker stopping");
        else socket.terminate();
      };

      signal.addEventListener("abort", abort, { once: true });
      socket.on("open", () => {
        clearTimeout(connectTimeout);
        handlers.onConnection("connected", reconnectCount);
        heartbeat = setInterval(() => {
          if (Date.now() - lastPongAt > 60_000) {
            socket.terminate();
            return;
          }
          socket.ping();
        }, 20_000);
      });
      socket.on("pong", () => {
        lastPongAt = Date.now();
      });
      socket.on("message", (raw) => {
        try {
          const envelope = asRecord(JSON.parse(messageText(raw)));
          const payload = asRecord(envelope.data);
          const receivedAt = new Date();
          let event: MarketDataEvent;
          if (payload.e === "kline") {
            const candle = normalizeWebSocketKline(payload, receivedAt);
            if (candle.symbol !== symbol || candle.interval !== interval) throw new Error("Binance kline stream returned an unexpected market");
            event = { type: "candle", data: candle };
          } else if (payload.e === "trade") {
            const trade = normalizeTrade(payload, receivedAt);
            if (trade.symbol !== symbol) throw new Error("Binance trade stream returned an unexpected market");
            event = { type: "trade", data: trade };
          } else if (payload.e === "depthUpdate") {
            const update = normalizeDepthUpdate(payload, receivedAt);
            if (update.symbol !== symbol) throw new Error("Binance depth stream returned an unexpected market");
            event = { type: "order-book-update", data: update };
          } else {
            throw new Error("Binance WebSocket message has an unsupported event type");
          }
          handlers.onEvent(event);
        } catch (error) {
          handlers.onError(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.on("error", (error) => {
        handlers.onError(error);
        finish(error);
      });
      socket.on("close", (code, reason) => {
        if (signal.aborted) finish();
        else finish(new Error(`Binance WebSocket closed (${code}): ${reason.toString("utf8")}`));
      });
    });
  }
}
