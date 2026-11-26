import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeDepthSnapshot, normalizeDepthUpdate, normalizeRestKline, normalizeTrade, normalizeWebSocketKline } from "./normalize";
import { OrderBookSequenceTracker } from "./order-book-sequence";

test("normalizes Binance REST candles without losing decimal precision", () => {
  const receivedAt = new Date(1_700_000_060_001);
  const candle = normalizeRestKline(
    [1_700_000_000_000, "67240.12000000", "67300.00000000", "67100.00000000", "67250.50000000", "1.23000000", 1_700_000_059_999, "82600.0", 52, "0.61", "41000.5"],
    "BTCUSDT",
    "1m",
    receivedAt,
  );

  assert.equal(candle.open, "67240.12000000");
  assert.equal(candle.baseVolume, "1.23000000");
  assert.equal(candle.tradeCount, 52);
  assert.equal(candle.isClosed, true);
  assert.equal(candle.receivedAt, receivedAt);
});

test("rejects candles with invalid OHLC values or timestamps", () => {
  assert.throws(
    () =>
      normalizeRestKline(
        [1000, "100", "99", "98", "101", "1", 2000, "100", 1, "0.5", "50"],
        "BTCUSDT",
        "1m",
      ),
    /OHLC values are inconsistent/,
  );
  assert.throws(
    () =>
      normalizeRestKline(
        [Number.MAX_SAFE_INTEGER + 1, "100", "101", "99", "100", "1", 2000, "100", 1, "0.5", "50"],
        "BTCUSDT",
        "1m",
      ),
    /timestamp/,
  );
});

test("normalizes WebSocket candle updates and keeps their close state", () => {
  const candle = normalizeWebSocketKline({
    E: 1_700_000_060_000,
    k: {
      s: "BTCUSDT",
      i: "1m",
      t: 1_700_000_000_000,
      T: 1_700_000_059_999,
      o: "100",
      h: "102",
      l: "99",
      c: "101",
      v: "3.2",
      q: "320.1",
      n: 9,
      V: "1.1",
      Q: "110.3",
      x: false,
    },
  });

  assert.equal(candle.interval, "1m");
  assert.equal(candle.isClosed, false);
  assert.equal(candle.close, "101");
});

test("normalizes trades and preserves zero-quantity depth deletions", () => {
  const trade = normalizeTrade({
    s: "BTCUSDT",
    t: 42,
    p: "67200.10",
    q: "0.02",
    T: 1_700_000_000_000,
    m: true,
  });
  const update = normalizeDepthUpdate({
    s: "BTCUSDT",
    U: 500,
    u: 501,
    E: 1_700_000_000_000,
    b: [["67200", "0"]],
    a: [["67201", "0.5"]],
  });

  assert.equal(trade.tradeId, "42");
  assert.equal(trade.buyerIsMaker, true);
  assert.deepEqual(update.bids, [["67200", "0"]]);
});

test("rejects unsorted or crossed order book snapshots", () => {
  assert.throws(
    () =>
      normalizeDepthSnapshot(
        { lastUpdateId: 10, bids: [["100", "1"], ["101", "1"]], asks: [["102", "1"]] },
        "BTCUSDT",
      ),
    /bids are not sorted/,
  );
  assert.throws(
    () =>
      normalizeDepthSnapshot(
        { lastUpdateId: 10, bids: [["100", "1"]], asks: [["99", "1"]] },
        "BTCUSDT",
      ),
    /crossed/,
  );
});

test("detects depth sequence gaps and resynchronizes against a new snapshot", () => {
  const tracker = new OrderBookSequenceTracker("100");
  assert.equal(tracker.accept({ firstUpdateId: "101", lastUpdateId: "102" }), "accepted");
  assert.equal(tracker.accept({ firstUpdateId: "102", lastUpdateId: "103" }), "accepted");
  assert.equal(tracker.accept({ firstUpdateId: "102", lastUpdateId: "103" }), "stale");
  assert.equal(tracker.accept({ firstUpdateId: "105", lastUpdateId: "106" }), "gap");
  assert.equal(tracker.isSynchronized, false);
  assert.equal(tracker.accept({ firstUpdateId: "107", lastUpdateId: "108" }), "unsynchronized");

  tracker.reset("106");
  assert.equal(tracker.accept({ firstUpdateId: "107", lastUpdateId: "108" }), "accepted");
  assert.equal(tracker.isSynchronized, true);
});
