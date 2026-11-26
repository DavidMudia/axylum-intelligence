export type RiskConfig = {
  maxRiskPerTradePct: number;
  maxDailyLossPct: number;
  maxDrawdownPct: number;
  maxPositionPct: number;
  maxConcurrentPositions: number;
  minRiskReward: number;
  maxExposurePct: number;
  feeRate: number;
  slippageRate: number;
};

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxRiskPerTradePct: 0.5,
  maxDailyLossPct: 2,
  maxDrawdownPct: 10,
  maxPositionPct: 10,
  maxConcurrentPositions: 1,
  minRiskReward: 2,
  maxExposurePct: 30,
  feeRate: 0.001,
  slippageRate: 0.0005,
};

export type RiskCheck = { name: string; passed: boolean; detail: string };

export type RiskAccountState = {
  equity: number;
  cash: number;
  exposure: number;
  dayStartEquity: number;
  peakEquity: number;
  openPositions: number;
  hasPosition: boolean;
  halted: boolean;
};

export type ProposedOrder = {
  side: "buy" | "sell";
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  quantity: number;
};

export function validatePaperOrder(
  config: RiskConfig,
  account: RiskAccountState,
  proposal: Omit<ProposedOrder, "quantity">,
): { accepted: boolean; quantity: number; checks: RiskCheck[] } {
  const { price, side, stopLoss, takeProfit, riskReward } = proposal;
  const drawdownPct = account.peakEquity > 0 ? ((account.peakEquity - account.equity) / account.peakEquity) * 100 : 100;
  const dailyLossPct = account.dayStartEquity > 0 ? ((account.dayStartEquity - account.equity) / account.dayStartEquity) * 100 : 100;
  const validStops = side === "sell" || (stopLoss !== null && takeProfit !== null && stopLoss > 0 && stopLoss < price && takeProfit > price);
  const riskRewardValid = side === "sell" || (
    riskReward !== null && Number.isFinite(riskReward) && riskReward >= config.minRiskReward
  );
  const checks: RiskCheck[] = [
    { name: "Trading halt", passed: !account.halted || side === "sell", detail: account.halted && side === "buy" ? "Paper trading is halted; risk-reducing exits remain allowed." : "No emergency halt blocks this order." },
    { name: "Daily loss limit", passed: side === "sell" || dailyLossPct < config.maxDailyLossPct, detail: `Current daily loss ${dailyLossPct.toFixed(2)}%; limit ${config.maxDailyLossPct}%.` },
    { name: "Maximum drawdown", passed: side === "sell" || drawdownPct < config.maxDrawdownPct, detail: `Current drawdown ${drawdownPct.toFixed(2)}%; limit ${config.maxDrawdownPct}%.` },
    { name: "Valid protective prices", passed: validStops, detail: side === "sell" ? "Closing a long position." : "A stop-loss below entry and take-profit above entry are required." },
    { name: "Minimum risk/reward", passed: riskRewardValid, detail: side === "sell" ? "Closing a long position." : `Required ratio ${config.minRiskReward}:1; proposed ${riskReward ?? "unavailable"}.` },
    { name: "Position concurrency", passed: side === "sell" || account.hasPosition || account.openPositions < config.maxConcurrentPositions, detail: `Maximum ${config.maxConcurrentPositions} concurrent positions.` },
  ];

  if (side === "sell") {
    checks.push({ name: "No short selling", passed: account.hasPosition, detail: account.hasPosition ? "Sell is restricted to closing an existing BTC long." : "No long position is available to close." });
    return { accepted: checks.every((check) => check.passed), quantity: 0, checks };
  }

  const stopDistance = stopLoss === null ? 0 : price - stopLoss;
  const riskBudget = Math.max(0, account.equity) * config.maxRiskPerTradePct / 100;
  const riskQuantity = stopDistance > 0 ? riskBudget / stopDistance : 0;
  const positionQuantity = price > 0 ? Math.max(0, account.equity) * config.maxPositionPct / 100 / price : 0;
  const exposureQuantity = price > 0
    ? Math.max(0, account.equity * config.maxExposurePct / 100 - account.exposure) / price
    : 0;
  const cashQuantity = price > 0 ? Math.max(0, account.cash) / (price * (1 + config.feeRate)) : 0;
  const quantity = Math.min(riskQuantity, positionQuantity, exposureQuantity, cashQuantity);
  const notional = quantity * price;
  checks.push(
    { name: "Maximum risk per trade", passed: stopDistance > 0 && quantity > 0 && stopDistance * quantity <= riskBudget + 1e-8, detail: `Risk budget ${riskBudget.toFixed(2)} USDT.` },
    { name: "Position size", passed: quantity > 0 && notional <= account.equity * config.maxPositionPct / 100 + 1e-8, detail: `Position is ${account.equity > 0 ? (notional / account.equity * 100).toFixed(2) : "0.00"}% of equity; limit ${config.maxPositionPct}%.` },
    { name: "Total exposure", passed: notional > 0 && account.exposure + notional <= account.equity * config.maxExposurePct / 100 + 1e-8, detail: `Exposure cap ${config.maxExposurePct}% of equity.` },
    { name: "Available cash", passed: notional * (1 + config.feeRate) <= account.cash + 1e-8, detail: "Notional and estimated entry fee must be available as simulated cash." },
  );
  return { accepted: checks.every((check) => check.passed), quantity, checks };
}
