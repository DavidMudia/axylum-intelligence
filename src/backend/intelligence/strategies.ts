import type { IndicatorSnapshot, MarketAnalysis } from "./indicators";

export type StrategyDefinition = {
  slug: string;
  name: string;
  description: string;
  version: number;
  active: boolean;
  rules: Record<string, unknown>;
};

export type Signal = {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  supportingIndicators: string[];
  explanation: string;
  invalidation: string[];
  stopLoss: number | null;
  takeProfit: number | null;
};

export const DEFAULT_STRATEGIES: StrategyDefinition[] = [
  {
    slug: "ema-trend",
    name: "EMA Trend Confirmation",
    description: "Long-only EMA(9/21) cross confirmed by EMA(50) trend, RSI and volume.",
    version: 1,
    active: true,
    rules: { type: "ema-trend", fast: 9, slow: 21, trend: 50, rsiMin: 40, rsiMax: 68, volumeRatioMin: 0.8, stopAtr: 1.5, targetAtr: 3 },
  },
  {
    slug: "rsi-reversal",
    name: "RSI Support Reversal",
    description: "Long-only oversold reversal near recent support with positive short momentum.",
    version: 1,
    active: false,
    rules: { type: "rsi-reversal", rsiEntry: 30, rsiExit: 68, supportDistancePct: 0.75, stopAtr: 1.5, targetAtr: 3 },
  },
];

export function decide(
  strategy: StrategyDefinition,
  analysis: MarketAnalysis,
  previous: IndicatorSnapshot | null,
): Signal {
  const { indicators, observed, regime } = analysis;
  const price = observed.close;
  const atr = indicators.atr14;
  const ruleNumber = (name: string, fallback: number) => {
    const value = Number(strategy.rules[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  let action: Signal["action"] = "HOLD";
  let confidence = 0.25;
  const support: string[] = [];
  let explanation = "No complete entry or exit rule is currently satisfied; remain in cash.";
  const invalidation = ["A closed candle invalidates this signal if the strategy conditions no longer hold."];

  if (strategy.slug === "ema-trend" && previous) {
    const crossedUp = previous.ema[9] !== null && previous.ema[21] !== null &&
      indicators.ema[9] !== null && indicators.ema[21] !== null &&
      previous.ema[9]! <= previous.ema[21]! && indicators.ema[9]! > indicators.ema[21]!;
    const crossedDown = previous.ema[9] !== null && previous.ema[21] !== null &&
      indicators.ema[9] !== null && indicators.ema[21] !== null &&
      previous.ema[9]! >= previous.ema[21]! && indicators.ema[9]! < indicators.ema[21]!;
    const rsiMin = ruleNumber("rsiMin", 40);
    const rsiMax = ruleNumber("rsiMax", 68);
    const volumeRatioMin = ruleNumber("volumeRatioMin", 0.8);
    if (crossedUp && regime.trend === "bullish" && indicators.rsi14 !== null && indicators.rsi14 >= rsiMin && indicators.rsi14 <= rsiMax &&
      indicators.volume.ratio !== null && indicators.volume.ratio >= volumeRatioMin) {
      action = "BUY";
      confidence = Math.min(0.9, 0.55 + (indicators.volume.ratio - volumeRatioMin) * 0.08 + (rsiMax - indicators.rsi14) / 300);
      support.push("EMA9 crossed above EMA21", "Price/EMA50 bullish alignment", `RSI14 ${indicators.rsi14.toFixed(1)} in permitted range`, `Volume ${indicators.volume.ratio.toFixed(2)}x 20-candle average`);
      explanation = "A bullish EMA crossover is confirmed by the long-term trend, RSI filter and above-threshold volume.";
    } else if (crossedDown) {
      action = "SELL";
      confidence = 0.65;
      support.push("EMA9 crossed below EMA21");
      explanation = "The short-term EMA trend crossed down; close an existing long position if one is open.";
    }
    invalidation.push(`Entry is invalid below EMA50 or when RSI14 leaves ${rsiMin}–${rsiMax} before execution.`);
  } else if (strategy.slug === "rsi-reversal") {
    const rsiEntry = ruleNumber("rsiEntry", 30);
    const rsiExit = ruleNumber("rsiExit", 68);
    const supportDistancePct = ruleNumber("supportDistancePct", 0.75);
    const nearSupport = indicators.support !== null && price > 0 &&
      ((price - indicators.support) / price) * 100 <= supportDistancePct;
    if (indicators.rsi14 !== null && indicators.rsi14 < rsiEntry && nearSupport && (indicators.momentum.change1 ?? -1) > 0) {
      action = "BUY";
      confidence = Math.min(0.85, 0.55 + (rsiEntry - indicators.rsi14) / 100);
      support.push(`RSI14 ${indicators.rsi14.toFixed(1)} is oversold`, `Price is within ${supportDistancePct}% of 50-candle support`, "One-candle momentum is positive");
      explanation = "Oversold conditions are near observed support and the latest candle shows positive momentum.";
    } else if (indicators.rsi14 !== null && indicators.rsi14 >= rsiExit) {
      action = "SELL";
      confidence = 0.6;
      support.push(`RSI14 ${indicators.rsi14.toFixed(1)} reached the ${rsiExit} exit threshold`);
      explanation = "The reversal strategy's RSI exit threshold has been reached.";
    }
    invalidation.push("Entry is invalid if support breaks or the next closed candle loses positive momentum.");
  }

  const stopAtr = ruleNumber("stopAtr", 1.5);
  const targetAtr = ruleNumber("targetAtr", 3);
  return {
    action,
    confidence,
    supportingIndicators: support,
    explanation,
    invalidation,
    stopLoss: action === "BUY" && atr !== null ? Math.max(0, price - atr * stopAtr) : null,
    takeProfit: action === "BUY" && atr !== null ? price + atr * targetAtr : null,
  };
}
