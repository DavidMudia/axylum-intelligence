import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocketServer } from "ws";
import { BinanceSpotProvider } from "./binance-spot-provider";

test("retries a Binance rate limit and paginates normalized REST candles", async () => {
  const previousBaseUrl = process.env.BINANCE_REST_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.BINANCE_REST_BASE_URL = "https://binance.test";
  let calls = 0;
  globalThis.fetch = async (input) => {
    calls++;
    const url = new URL(input instanceof Request ? input.url : input.toString());
    assert.equal(url.pathname, "/api/v3/klines");
    assert.equal(url.searchParams.get("symbol"), "BTCUSDT");
    assert.equal(url.searchParams.get("interval"), "1m");
    if (calls === 1) return new Response("rate limited", { status: 429, headers: { "retry-after": "0.001" } });
    return Response.json([
      [1_700_000_000_000, "100", "102", "99", "101", "2.5", 1_700_000_059_999, "250", 11, "1.2", "120"],
    ]);
  };

  try {
    const provider = new BinanceSpotProvider();
    const candles = await provider.fetchHistoricalCandles(
      "BTCUSDT",
      "1m",
      new Date(1_700_000_000_000),
      new Date(1_700_000_060_000),
    );
    assert.equal(calls, 2);
    assert.equal(candles.length, 1);
    assert.equal(candles[0].close, "101");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousBaseUrl === undefined) delete process.env.BINANCE_REST_BASE_URL;
    else process.env.BINANCE_REST_BASE_URL = previousBaseUrl;
  }
});

test("reconnects after a dropped Binance stream and normalizes incoming events", { timeout: 8_000 }, async () => {
  const previousUrl = process.env.BINANCE_WS_BASE_URL;
  const server = new WebSocketServer({ port: 0 });
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.BINANCE_WS_BASE_URL = `ws://127.0.0.1:${address.port}`;

  const controller = new AbortController();
  let connectionCount = 0;
  let receivedTrades = 0;
  let reconnectCount = 0;

  server.on("connection", (socket) => {
    connectionCount++;
    if (connectionCount === 1) {
      socket.send(
        JSON.stringify({
          stream: "btcusdt@trade",
          data: { e: "trade", s: "BTCUSDT", t: 1, p: "67000", q: "0.01", T: 1_700_000_000_000, m: false },
        }),
      );
      setTimeout(() => socket.close(1012, "test reconnect"), 50);
    }
  });

  const provider = new BinanceSpotProvider();
  const subscription = provider
    .subscribe(
      "BTCUSDT",
      "1m",
      {
        onEvent: (event) => {
          if (event.type === "trade") receivedTrades++;
        },
        onConnection: (state, retries) => {
          if (state === "reconnecting") reconnectCount = retries;
          if (state === "connected" && retries > 0) controller.abort();
        },
        onError: () => undefined,
      },
      controller.signal,
    )
    .finally(() => {
      if (previousUrl === undefined) delete process.env.BINANCE_WS_BASE_URL;
      else process.env.BINANCE_WS_BASE_URL = previousUrl;
    });

  try {
    await subscription;
    assert.ok(connectionCount >= 2);
    assert.equal(reconnectCount, 1);
    assert.equal(receivedTrades, 1);
  } finally {
    controller.abort();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
