import assert from "node:assert/strict";
import test from "node:test";
import { runHistoricalBacktest } from "./backtest";
import { DEFAULT_RISK_CONFIG } from "./risk";
import type { CandleInput } from "./indicators";

function oversoldCandles(count: number): CandleInput[] {
  let close = 200;
  return Array.from({ length: count }, (_, index) => {
    const previous = close;
    close *= index < 250 ? 1 : index === 279 ? 1.0001 : 0.9995;
    if (index >= 279) close = previous * 1.0001;
    return {
      openTime: new Date(index * 60_000),
      open: previous,
      high: Math.max(previous, close) * 1.0005,
      low: Math.min(previous, close) * 0.9995,
      close,
      baseVolume: 100,
      quoteVolume: 100 * close,
    };
  });
}

test("backtest requires enough real closed candles", () => {
  assert.throws(() => runHistoricalBacktest(oversoldCandles(249), {
    strategySlug: "ema-trend",
    symbol: "BTCUSDT",
    interval: "1m",
    risk: DEFAULT_RISK_CONFIG,
    startingEquity: 100_000,
  }), /250 closed candles/);
});

test("backtest reports separate out-of-sample, benchmark and execution assumptions", () => {
  const result = runHistoricalBacktest(oversoldCandles(300), {
    strategySlug: "rsi-reversal",
    symbol: "BTCUSDT",
    interval: "1m",
    risk: DEFAULT_RISK_CONFIG,
    startingEquity: 100_000,
  });
  assert.equal(result.metrics.candles, 300);
  assert.equal(result.metrics.splitIndex, 210);
  assert.equal(result.metrics.assumptions.execution, "next_candle_open");
  assert.equal(result.metrics.assumptions.intrabarTieBreak, "stop_loss_first");
  assert.ok(Number.isFinite(result.metrics.inSample.totalReturnPct));
});

test("future candles do not alter in-sample backtest metrics", () => {
  const candles = oversoldCandles(400);
  const options = {
    strategySlug: "rsi-reversal",
    symbol: "BTCUSDT",
    interval: "1m",
    risk: DEFAULT_RISK_CONFIG,
    startingEquity: 100_000,
  } as const;
  const initial = runHistoricalBacktest(candles, options);
  const changedFuture = candles.map((candle, index) => index < initial.metrics.splitIndex
    ? candle
    : { ...candle, open: Number(candle.open) * 1.5, high: Number(candle.high) * 1.5, low: Number(candle.low) * 1.5, close: Number(candle.close) * 1.5 });
  const changed = runHistoricalBacktest(changedFuture, options);
  assert.deepEqual(changed.metrics.inSample, initial.metrics.inSample);
});
