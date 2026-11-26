import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMarket, calculateIndicators, type CandleInput } from "./indicators";

function candlesFromCloses(closes: number[]): CandleInput[] {
  return closes.map((close, index) => ({
    openTime: new Date(index * 60_000),
    open: close - 0.5,
    high: close + 1,
    low: close - 1,
    close,
    baseVolume: 10 + index,
    quoteVolume: (10 + index) * close,
  }));
}

test("indicator warmup returns null until enough historical candles exist", () => {
  const result = calculateIndicators(candlesFromCloses(Array.from({ length: 19 }, (_, i) => 100 + i)));
  assert.equal(result.rsi14 !== null, true);
  assert.equal(result.ema[200], null);
  assert.equal(result.sma[20], null);
  assert.equal(result.atr14 !== null, true);
  assert.equal(result.bollinger.middle, null);
});

test("flat candles have RSI 100 and zero momentum after warmup", () => {
  const result = calculateIndicators(candlesFromCloses(Array(40).fill(100)));
  assert.equal(result.rsi14, 100);
  assert.equal(result.momentum.change5, 0);
  assert.equal(result.macd.histogram, 0);
});

test("analysis labels observed data and source provenance", () => {
  const candles = candlesFromCloses(Array.from({ length: 220 }, (_, i) => 100 + i));
  const result = analyzeMarket("BTCUSDT", "1m", candles, {
    bids: [["319", "2"]],
    asks: [["321", "3"]],
  });
  assert.equal(result.observed.close, 319);
  assert.equal(result.regime.trend, "bullish");
  assert.equal(result.provenance.source, "binance_spot");
  assert.equal(result.provenance.candleCount, 220);
  assert.ok(result.indicators.liquidity.spreadBps! > 0);
});
