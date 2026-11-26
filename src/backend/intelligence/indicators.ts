export type CandleInput = {
  openTime: Date;
  open: string | number;
  high: string | number;
  low: string | number;
  close: string | number;
  baseVolume: string | number;
  quoteVolume: string | number;
};

export type IndicatorSnapshot = {
  rsi14: number | null;
  macd: { line: number | null; signal: number | null; histogram: number | null };
  ema: Record<9 | 21 | 50 | 200, number | null>;
  sma: Record<20 | 50 | 200, number | null>;
  bollinger: { upper: number | null; middle: number | null; lower: number | null };
  atr14: number | null;
  volume: { current: number; average20: number | null; ratio: number | null };
  momentum: { change1: number | null; change5: number | null; change20: number | null };
  support: number | null;
  resistance: number | null;
  volatility: { atrPercent: number | null; realizedPercent: number | null };
  liquidity: { averageQuoteVolume20: number | null; spreadBps: number | null };
};

export type MarketAnalysis = {
  symbol: string;
  interval: string;
  candleOpenTime: Date;
  observed: { open: number; high: number; low: number; close: number; baseVolume: number; quoteVolume: number };
  indicators: IndicatorSnapshot;
  regime: { trend: "bullish" | "bearish" | "sideways"; volatility: "high" | "normal" | "low"; label: string };
  confidence: number;
  provenance: { source: "binance_spot"; table: "market_candles"; candleCount: number; calculatedAt: Date };
};

export type IndicatorSeries = {
  ema9: Array<number | null>;
  ema21: Array<number | null>;
  ema50: Array<number | null>;
  ema200: Array<number | null>;
  rsi14: Array<number | null>;
  atr14: Array<number | null>;
  sma20: Array<number | null>;
  volumeAverage20: Array<number | null>;
};

const numeric = (value: string | number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new TypeError("Market candle contains a non-finite numeric value");
  return parsed;
};

function sma(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  let total = 0;
  for (let i = 0; i < values.length; i++) {
    total += values[i];
    if (i >= period) total -= values[i - period];
    if (i >= period - 1) result[i] = total / period;
  }
  return result;
}

function ema(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  let seed = 0;
  for (let i = 0; i < period; i++) seed += values[i];
  result[period - 1] = seed / period;
  const multiplier = 2 / (period + 1);
  for (let i = period; i < values.length; i++) {
    result[i] = values[i] * multiplier + result[i - 1]! * (1 - multiplier);
  }
  return result;
}

function rsi(closes: number[], period = 14): Array<number | null> {
  const result: Array<number | null> = Array(closes.length).fill(null);
  if (closes.length <= period) return result;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    gain += Math.max(change, 0);
    loss += Math.max(-change, 0);
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function trueRanges(highs: number[], lows: number[], closes: number[]): number[] {
  return highs.map((high, i) => Math.max(high - lows[i], Math.abs(high - (closes[i - 1] ?? high)), Math.abs(lows[i] - (closes[i - 1] ?? lows[i]))));
}

function wilderAverage(values: number[], period: number): Array<number | null> {
  const result: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period) return result;
  let initial = 0;
  for (let i = 0; i < period; i++) initial += values[i];
  result[period - 1] = initial / period;
  for (let i = period; i < values.length; i++) {
    result[i] = (result[i - 1]! * (period - 1) + values[i]) / period;
  }
  return result;
}

function percentChange(current: number, previous: number | undefined): number | null {
  return previous === undefined || previous === 0 ? null : ((current / previous) - 1) * 100;
}

export function calculateIndicatorSeries(candles: CandleInput[]): IndicatorSeries {
  const closes = candles.map((candle) => numeric(candle.close));
  const highs = candles.map((candle) => numeric(candle.high));
  const lows = candles.map((candle) => numeric(candle.low));
  const volumes = candles.map((candle) => numeric(candle.baseVolume));
  return {
    ema9: ema(closes, 9),
    ema21: ema(closes, 21),
    ema50: ema(closes, 50),
    ema200: ema(closes, 200),
    rsi14: rsi(closes),
    atr14: wilderAverage(trueRanges(highs, lows, closes), 14),
    sma20: sma(closes, 20),
    volumeAverage20: sma(volumes, 20),
  };
}

export function calculateIndicators(candles: CandleInput[]): IndicatorSnapshot {
  if (!candles.length) throw new RangeError("At least one closed market candle is required");
  const opens = candles.map((candle) => numeric(candle.open));
  const highs = candles.map((candle) => numeric(candle.high));
  const lows = candles.map((candle) => numeric(candle.low));
  const closes = candles.map((candle) => numeric(candle.close));
  const volumes = candles.map((candle) => numeric(candle.baseVolume));
  const quoteVolumes = candles.map((candle) => numeric(candle.quoteVolume));
  const at = candles.length - 1;
  const current = closes[at];
  const average = (values: number[], period: number, end = values.length): number | null => {
    if (end < period) return null;
    return values.slice(end - period, end).reduce((sum, value) => sum + value, 0) / period;
  };

  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const closeSma20 = sma(closes, 20);
  const closeSma50 = sma(closes, 50);
  const closeSma200 = sma(closes, 200);
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const macdLine = closes.map((_, i) => fast[i] === null || slow[i] === null ? null : fast[i]! - slow[i]!);
  const macdStart = macdLine.findIndex((value) => value !== null);
  const macdSignalRaw = macdStart < 0
    ? []
    : ema(macdLine.slice(macdStart).map((value) => value!), 9);
  const macdSignal = Array<number | null>(closes.length).fill(null);
  macdSignalRaw.forEach((value, i) => { macdSignal[macdStart + i] = value; });
  const tr = trueRanges(highs, lows, closes);
  const atr = wilderAverage(tr, 14);
  const avgVolume = average(volumes, 20);
  const avgQuoteVolume = average(quoteVolumes, 20);
  const mean20 = closeSma20[at];
  let standardDeviation: number | null = null;
  if (mean20 !== null) {
    const window = closes.slice(at - 19, at + 1);
    standardDeviation = Math.sqrt(window.reduce((sum, value) => sum + (value - mean20) ** 2, 0) / 20);
  }
  const returns = closes.slice(Math.max(1, at - 19), at + 1).map((close, i, values) => {
    const previous = i === 0 ? closes[Math.max(0, at - 20)] : values[i - 1];
    return previous ? Math.log(close / previous) : 0;
  });
  const returnMean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const realized = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, value) => sum + (value - returnMean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(365) * 100
    : null;
  const supportStart = Math.max(0, candles.length - 50);

  return {
    rsi14: rsi(closes)[at],
    macd: {
      line: macdLine[at],
      signal: macdSignal[at],
      histogram: macdLine[at] === null || macdSignal[at] === null ? null : macdLine[at]! - macdSignal[at]!,
    },
    ema: { 9: ema9[at], 21: ema21[at], 50: ema50[at], 200: ema200[at] },
    sma: { 20: closeSma20[at], 50: closeSma50[at], 200: closeSma200[at] },
    bollinger: {
      upper: mean20 === null || standardDeviation === null ? null : mean20 + 2 * standardDeviation,
      middle: mean20,
      lower: mean20 === null || standardDeviation === null ? null : mean20 - 2 * standardDeviation,
    },
    atr14: atr[at],
    volume: { current: volumes[at], average20: avgVolume, ratio: avgVolume === null || avgVolume === 0 ? null : volumes[at] / avgVolume },
    momentum: {
      change1: percentChange(current, closes[at - 1]),
      change5: percentChange(current, closes[at - 5]),
      change20: percentChange(current, closes[at - 20]),
    },
    support: Math.min(...lows.slice(supportStart)),
    resistance: Math.max(...highs.slice(supportStart)),
    volatility: {
      atrPercent: atr[at] === null || current === 0 ? null : (atr[at]! / current) * 100,
      realizedPercent: realized,
    },
    liquidity: { averageQuoteVolume20: avgQuoteVolume, spreadBps: null },
  };
}

export function analyzeMarket(
  symbol: string,
  interval: string,
  candles: CandleInput[],
  orderBook?: { bids: [string, string][]; asks: [string, string][] },
): MarketAnalysis {
  if (candles.length < 20) throw new RangeError("At least 20 closed candles are required for market analysis");
  const latest = candles[candles.length - 1];
  const indicators = calculateIndicators(candles);
  if (orderBook?.bids.length && orderBook.asks.length) {
    const bid = Number(orderBook.bids[0][0]);
    const ask = Number(orderBook.asks[0][0]);
    if (Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask >= bid) {
      indicators.liquidity.spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
    }
  }
  const trend = indicators.ema[50] !== null && indicators.ema[200] !== null
    ? indicators.ema[50]! > indicators.ema[200]! && Number(latest.close) > indicators.ema[50]!
      ? "bullish"
      : indicators.ema[50]! < indicators.ema[200]! && Number(latest.close) < indicators.ema[50]!
        ? "bearish"
        : "sideways"
    : "sideways";
  const atrPct = indicators.volatility.atrPercent;
  const volatility = atrPct === null ? "normal" : atrPct > 2.5 ? "high" : atrPct < 0.35 ? "low" : "normal";
  const label = volatility === "high" ? `high_volatility_${trend}` : `${trend}_${volatility}_volatility`;
  const confidence = Math.min(0.95, 0.35 + Math.min(candles.length, 200) / 400 + (indicators.ema[200] === null ? 0 : 0.1));

  return {
    symbol,
    interval,
    candleOpenTime: latest.openTime,
    observed: {
      open: numeric(latest.open), high: numeric(latest.high), low: numeric(latest.low), close: numeric(latest.close),
      baseVolume: numeric(latest.baseVolume), quoteVolume: numeric(latest.quoteVolume),
    },
    indicators,
    regime: { trend, volatility, label },
    confidence,
    provenance: { source: "binance_spot", table: "market_candles", candleCount: candles.length, calculatedAt: new Date() },
  };
}
