import { calculateIndicatorSeries, type CandleInput } from "./indicators";
import type { RiskConfig } from "./risk";

type BacktestTrade = {
  entryTime: string;
  exitTime: string;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  netPnl: number;
  returnPct: number;
  exitReason: "signal" | "stop_loss" | "take_profit" | "end_of_test";
};

type BacktestStats = {
  totalReturnPct: number;
  winRatePct: number;
  profitFactor: number | null;
  maxDrawdownPct: number;
  averageProfit: number;
  averageLoss: number;
  sharpeRatio: number;
  trades: number;
  fees: number;
  slippage: number;
};

export type BacktestResult = {
  strategySlug: string;
  symbol: string;
  interval: string;
  fromTime: Date;
  toTime: Date;
  metrics: {
    inSample: BacktestStats;
    outOfSample: BacktestStats;
    buyAndHold: { totalReturnPct: number };
    splitIndex: number;
    candles: number;
    assumptions: { feeRate: number; slippageRate: number; execution: "next_candle_open"; intrabarTieBreak: "stop_loss_first" };
  };
  equityCurve: Array<{ time: number; strategy: number; benchmark: number }>;
  trades: BacktestTrade[];
};

type Position = { entryPrice: number; entryFee: number; quantity: number; stop: number; target: number; entryIndex: number };

function indicatorSignal(
  candles: CandleInput[],
  indicators: ReturnType<typeof calculateIndicatorSeries>,
  index: number,
  slug: string,
  rules: Record<string, unknown>,
): "BUY" | "SELL" | "HOLD" {
  const ruleNumber = (name: string, fallback: number) => {
    const value = Number(rules[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  const previous = index - 1;
  if (previous < 0) return "HOLD";
  if (slug === "ema-trend") {
    const crossedUp = indicators.ema9[previous] !== null && indicators.ema21[previous] !== null &&
      indicators.ema9[index] !== null && indicators.ema21[index] !== null &&
      indicators.ema9[previous]! <= indicators.ema21[previous]! && indicators.ema9[index]! > indicators.ema21[index]!;
    if (crossedUp && indicators.ema50[index] !== null && Number(candles[index].close) > indicators.ema50[index]! &&
      indicators.ema200[index] !== null && indicators.ema50[index]! > indicators.ema200[index]! &&
      indicators.rsi14[index] !== null && indicators.rsi14[index]! >= ruleNumber("rsiMin", 40) && indicators.rsi14[index]! <= ruleNumber("rsiMax", 68) &&
      indicators.volumeAverage20[index] !== null && Number(candles[index].baseVolume) / indicators.volumeAverage20[index]! >= ruleNumber("volumeRatioMin", 0.8)) return "BUY";
    const crossedDown = indicators.ema9[previous] !== null && indicators.ema21[previous] !== null &&
      indicators.ema9[index] !== null && indicators.ema21[index] !== null &&
      indicators.ema9[previous]! >= indicators.ema21[previous]! && indicators.ema9[index]! < indicators.ema21[index]!;
    return crossedDown ? "SELL" : "HOLD";
  }
  const rsi = indicators.rsi14[index];
  if (rsi === null) return "HOLD";
  if (rsi >= ruleNumber("rsiExit", 68)) return "SELL";
  const supportStart = Math.max(0, index - 49);
  const support = Math.min(...candles.slice(supportStart, index + 1).map((candle) => Number(candle.low)));
  const nearSupport = Number(candles[index].close) > 0 &&
    ((Number(candles[index].close) - support) / Number(candles[index].close)) * 100 <= ruleNumber("supportDistancePct", 0.75);
  const positiveMomentum = Number(candles[index].close) > Number(candles[previous].close);
  return rsi < ruleNumber("rsiEntry", 30) && nearSupport && positiveMomentum ? "BUY" : "HOLD";
}

function calculateStats(equity: number[], startingEquity: number, trades: BacktestTrade[], fees: number, slippage: number, periodsPerYear: number): BacktestStats {
  const returns = equity.slice(1).map((value, i) => value / equity[i] - 1).filter(Number.isFinite);
  const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
  const deviation = returns.length > 1
    ? Math.sqrt(returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1))
    : 0;
  let peak = startingEquity;
  let maxDrawdown = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, (peak - value) / peak);
  }
  const winners = trades.filter((trade) => trade.netPnl > 0);
  const losers = trades.filter((trade) => trade.netPnl < 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLoss = -losers.reduce((sum, trade) => sum + trade.netPnl, 0);
  return {
    totalReturnPct: ((equity[equity.length - 1] / startingEquity) - 1) * 100,
    winRatePct: trades.length ? winners.length / trades.length * 100 : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : grossProfit ? null : 0,
    maxDrawdownPct: maxDrawdown * 100,
    averageProfit: winners.length ? grossProfit / winners.length : 0,
    averageLoss: losers.length ? grossLoss / losers.length : 0,
    sharpeRatio: deviation ? mean / deviation * Math.sqrt(periodsPerYear) : 0,
    trades: trades.length,
    fees,
    slippage,
  };
}

function simulate(
  candles: CandleInput[],
  indicators: ReturnType<typeof calculateIndicatorSeries>,
  slug: string,
  config: RiskConfig,
  startingEquity: number,
  fromIndex: number,
  endIndex: number,
  periodsPerYear: number,
  rules: Record<string, unknown>,
): { stats: BacktestStats; trades: BacktestTrade[]; equity: number[]; fees: number; slippage: number } {
  let cash = startingEquity;
  let position: Position | null = null;
  let fees = 0;
  let slippage = 0;
  const trades: BacktestTrade[] = [];
  const equity: number[] = [startingEquity];
  let startAt = Math.max(2, fromIndex);
  let peakEquity = startingEquity;
  let dayStartEquity = startingEquity;
  let currentDay = candles[Math.max(0, startAt - 1)].openTime.toISOString().slice(0, 10);

  for (let i = startAt; i < endIndex; i++) {
    const execution = candles[i];
    const rawOpen = Number(execution.open);
    const executionDay = execution.openTime.toISOString().slice(0, 10);
    const markedEquity = cash + (position ? position.quantity * rawOpen : 0);
    if (executionDay !== currentDay) {
      currentDay = executionDay;
      dayStartEquity = markedEquity;
    }
    peakEquity = Math.max(peakEquity, markedEquity);
    const dailyLossPct = dayStartEquity > 0 ? (dayStartEquity - markedEquity) / dayStartEquity * 100 : 100;
    const drawdownPct = peakEquity > 0 ? (peakEquity - markedEquity) / peakEquity * 100 : 100;
    const riskHalted = dailyLossPct >= config.maxDailyLossPct || drawdownPct >= config.maxDrawdownPct;
    let exitPrice: number | null = null;
    let exitReason: BacktestTrade["exitReason"] | null = null;
    if (position) {
      const low = Number(execution.low);
      const high = Number(execution.high);
      if (low <= position.stop) {
        exitPrice = Math.min(rawOpen, position.stop);
        exitReason = "stop_loss";
      } else if (high >= position.target) {
        exitPrice = Math.max(rawOpen, position.target);
        exitReason = "take_profit";
      } else if (indicatorSignal(candles, indicators, i - 1, slug, rules) === "SELL") {
        exitPrice = rawOpen;
        exitReason = "signal";
      }
    } else if (!riskHalted && indicatorSignal(candles, indicators, i - 1, slug, rules) === "BUY") {
      const referencePrice = rawOpen;
      const atr = indicators.atr14[i - 1];
      if (atr !== null && referencePrice > 0) {
        const stopAtr = Number(rules.stopAtr ?? 1.5);
        const targetAtr = Number(rules.targetAtr ?? 3);
        const stop = referencePrice - atr * stopAtr;
        const target = referencePrice + atr * targetAtr;
        if (targetAtr / stopAtr < config.minRiskReward) {
          equity.push(markedEquity);
          continue;
        }
        const entryPrice = referencePrice * (1 + config.slippageRate);
        const equityBeforeEntry = cash;
        const riskBudget = equityBeforeEntry * config.maxRiskPerTradePct / 100;
        const riskQuantity = stop > 0 ? riskBudget / (referencePrice - stop) : 0;
        const capQuantity = Math.min(config.maxPositionPct, config.maxExposurePct) * equityBeforeEntry / 100 / entryPrice;
        const cashQuantity = cash / (entryPrice * (1 + config.feeRate));
        const quantity = Math.min(riskQuantity, capQuantity, cashQuantity);
        if (quantity > 0) {
          const entryFee = quantity * entryPrice * config.feeRate;
          cash -= quantity * entryPrice + entryFee;
          fees += entryFee;
          slippage += quantity * Math.abs(entryPrice - referencePrice);
          position = { entryPrice, entryFee, quantity, stop, target, entryIndex: i };
        }
      }
    }

    if (position && exitPrice !== null && exitReason) {
      const fill = exitPrice * (1 - config.slippageRate);
      const exitFee = position.quantity * fill * config.feeRate;
      const exitSlippage = position.quantity * Math.abs(exitPrice - fill);
      const netPnl = (fill - position.entryPrice) * position.quantity - position.entryFee - exitFee;
      cash += position.quantity * fill - exitFee;
      fees += exitFee;
      slippage += exitSlippage;
      trades.push({
        entryTime: candles[position.entryIndex].openTime.toISOString(),
        exitTime: execution.openTime.toISOString(),
        entryPrice: position.entryPrice,
        exitPrice: fill,
        quantity: position.quantity,
        netPnl,
        returnPct: netPnl / (position.entryPrice * position.quantity) * 100,
        exitReason,
      });
      position = null;
    }
    equity.push(cash + (position ? position.quantity * Number(execution.close) : 0));
  }

  if (position) {
    const last = candles[endIndex - 1];
    const rawClose = Number(last.close);
    const fill = rawClose * (1 - config.slippageRate);
    const exitFee = position.quantity * fill * config.feeRate;
    const netPnl = (fill - position.entryPrice) * position.quantity - position.entryFee - exitFee;
    cash += position.quantity * fill - exitFee;
    fees += exitFee;
    slippage += position.quantity * Math.abs(rawClose - fill);
    trades.push({
      entryTime: candles[position.entryIndex].openTime.toISOString(),
      exitTime: last.openTime.toISOString(),
      entryPrice: position.entryPrice,
      exitPrice: fill,
      quantity: position.quantity,
      netPnl,
      returnPct: netPnl / (position.entryPrice * position.quantity) * 100,
      exitReason: "end_of_test",
    });
    equity[equity.length - 1] = cash;
  }

  return { stats: calculateStats(equity, startingEquity, trades, fees, slippage, periodsPerYear), trades, equity, fees, slippage };
}

function intervalPeriodsPerYear(interval: string): number {
  const minutes: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };
  return 365 * 24 * 60 / (minutes[interval] ?? 1);
}

export function runHistoricalBacktest(
  candles: CandleInput[],
  options: { strategySlug: string; symbol: string; interval: string; risk: RiskConfig; startingEquity: number; rules?: Record<string, unknown> },
): BacktestResult {
  if (candles.length < 250) throw new RangeError("At least 250 closed candles are required for an unbiased backtest");
  if (!["ema-trend", "rsi-reversal"].includes(options.strategySlug)) throw new RangeError("Unsupported backtest strategy");
  const indicators = calculateIndicatorSeries(candles);
  const rules = options.rules ?? {};
  const splitIndex = Math.max(201, Math.floor(candles.length * 0.7));
  const periods = intervalPeriodsPerYear(options.interval);
  const full = simulate(candles, indicators, options.strategySlug, options.risk, options.startingEquity, 200, candles.length, periods, rules);
  const inSample = simulate(candles, indicators, options.strategySlug, options.risk, options.startingEquity, 200, splitIndex, periods, rules);
  const outOfSample = simulate(candles, indicators, options.strategySlug, options.risk, options.startingEquity, splitIndex, candles.length, periods, rules);
  const firstPrice = Number(candles[201].open);
  const lastPrice = Number(candles[candles.length - 1].close);
  const benchmarkQuantity = (options.startingEquity / (firstPrice * (1 + options.risk.slippageRate) * (1 + options.risk.feeRate)));
  const benchmarkSell = lastPrice * (1 - options.risk.slippageRate);
  const benchmarkReturn = ((benchmarkQuantity * benchmarkSell * (1 - options.risk.feeRate)) / options.startingEquity - 1) * 100;
  const curve = full.equity.map((value, index) => {
    const candle = candles[Math.min(200 + index, candles.length - 1)];
    const benchmarkPrice = Number(candle.close);
    const benchmarkValue = (benchmarkQuantity * benchmarkPrice) * (1 - options.risk.slippageRate) * (1 - options.risk.feeRate);
    return { time: candle.openTime.getTime(), strategy: value, benchmark: benchmarkValue };
  });
  const maxCurvePoints = 500;
  const sampledCurve = curve.filter((_, index) => index % Math.max(1, Math.ceil(curve.length / maxCurvePoints)) === 0);
  return {
    strategySlug: options.strategySlug,
    symbol: options.symbol,
    interval: options.interval,
    fromTime: candles[200].openTime,
    toTime: candles[candles.length - 1].openTime,
    metrics: {
      inSample: inSample.stats,
      outOfSample: outOfSample.stats,
      buyAndHold: { totalReturnPct: benchmarkReturn },
      splitIndex,
      candles: candles.length,
      assumptions: { feeRate: options.risk.feeRate, slippageRate: options.risk.slippageRate, execution: "next_candle_open", intrabarTieBreak: "stop_loss_first" },
    },
    equityCurve: sampledCurve,
    trades: full.trades,
  };
}
