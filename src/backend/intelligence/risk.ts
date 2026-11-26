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

export type Mt5RiskAccount = {
  accountType: string;
  equity: number;
  dayStartEquity: number;
  peakEquity: number;
  existingExposure: number;
  freeMargin: number;
  usedMargin: number;
  openPositions: number;
  pendingOrders: number;
  tradingAllowed: boolean;
};

export type Mt5RiskInstrument = {
  point: number;
  tickSize: number;
  tickValue: number;
  volumeMin: number;
  volumeMax: number;
  volumeStep: number;
  stopsLevelPoints: number;
};

export type Mt5OrderProposal = {
  side: "buy" | "sell";
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  requestedVolume: number | null;
  spreadPoints: number;
  notionalPerLot: number;
  marginPerLot: number | null;
  maxSpreadPoints: number;
  emergencyHalt: boolean;
  demoOrdersEnabled: boolean;
};

export type Mt5RiskResult = {
  accepted: boolean;
  volume: number;
  estimatedMargin: number;
  riskReward: number | null;
  checks: RiskCheck[];
};

export function validateMt5Order(
  config: RiskConfig,
  account: Mt5RiskAccount,
  instrument: Mt5RiskInstrument,
  proposal: Mt5OrderProposal,
): Mt5RiskResult {
  const { price, stopLoss, takeProfit, side } = proposal;
  const dailyLossPct = account.dayStartEquity > 0
    ? Math.max(0, (account.dayStartEquity - account.equity) / account.dayStartEquity * 100)
    : 100;
  const drawdownPct = account.peakEquity > 0
    ? Math.max(0, (account.peakEquity - account.equity) / account.peakEquity * 100)
    : 100;
  const stopDistance = stopLoss === null ? 0 : Math.abs(price - stopLoss);
  const rewardDistance = takeProfit === null ? 0 : Math.abs(takeProfit - price);
  const validStops = price > 0 && stopLoss !== null && takeProfit !== null &&
    (side === "buy" ? stopLoss < price && takeProfit > price : takeProfit < price && stopLoss > price) &&
    stopDistance >= instrument.stopsLevelPoints * instrument.point;
  const riskReward = validStops && stopDistance > 0 ? rewardDistance / stopDistance : null;
  const riskPerLot = instrument.tickSize > 0 ? stopDistance / instrument.tickSize * instrument.tickValue : 0;
  const riskBudget = Math.max(0, account.equity) * config.maxRiskPerTradePct / 100;
  const riskVolume = riskPerLot > 0 ? riskBudget / riskPerLot : 0;
  const marginVolume = proposal.marginPerLot === null
    ? instrument.volumeMax
    : proposal.marginPerLot > 0 ? Math.max(0, account.freeMargin) / proposal.marginPerLot : 0;
  const positionVolume = proposal.notionalPerLot > 0
    ? Math.max(0, account.equity) * config.maxPositionPct / 100 / proposal.notionalPerLot
    : 0;
  const exposureVolume = proposal.notionalPerLot > 0
    ? Math.max(0, account.equity * config.maxExposurePct / 100 - account.existingExposure) / proposal.notionalPerLot
    : 0;
  const maxVolume = Math.floor(
    Math.min(riskVolume, marginVolume, positionVolume, exposureVolume, instrument.volumeMax) / instrument.volumeStep + 1e-10,
  ) * instrument.volumeStep;
  const volume = proposal.requestedVolume ?? Number(maxVolume.toPrecision(12));
  const estimatedMargin = proposal.marginPerLot === null ? 0 : volume * proposal.marginPerLot;
  const volumeAligned = instrument.volumeStep > 0 &&
    Math.abs(volume / instrument.volumeStep - Math.round(volume / instrument.volumeStep)) < 1e-8;
  const checks: RiskCheck[] = [
    { name: "Demo account", passed: account.accountType === "demo", detail: "MT5 execution is restricted to demo accounts." },
    { name: "Demo execution enabled", passed: proposal.demoOrdersEnabled, detail: "Demo orders require explicit server-side enablement." },
    { name: "Trading permission", passed: account.tradingAllowed, detail: "The broker account must permit trading." },
    { name: "Emergency halt", passed: !proposal.emergencyHalt, detail: proposal.emergencyHalt ? "The global emergency kill switch is active." : "The emergency kill switch is inactive." },
    { name: "Daily loss limit", passed: dailyLossPct < config.maxDailyLossPct, detail: `Daily loss ${dailyLossPct.toFixed(2)}%; limit ${config.maxDailyLossPct}%.` },
    { name: "Maximum drawdown", passed: drawdownPct < config.maxDrawdownPct, detail: `Drawdown ${drawdownPct.toFixed(2)}%; limit ${config.maxDrawdownPct}%.` },
    { name: "Spread", passed: Number.isFinite(proposal.spreadPoints) && proposal.spreadPoints >= 0 && proposal.spreadPoints <= proposal.maxSpreadPoints, detail: `Spread ${proposal.spreadPoints} points; limit ${proposal.maxSpreadPoints}.` },
    { name: "Protective stops", passed: validStops, detail: "A valid stop-loss and take-profit are required and must respect broker stop distance." },
    { name: "Minimum risk/reward", passed: riskReward !== null && riskReward + 1e-10 >= config.minRiskReward, detail: `Required ratio ${config.minRiskReward}:1; proposed ${riskReward?.toFixed(2) ?? "unavailable"}.` },
    { name: "Position concurrency", passed: account.openPositions + account.pendingOrders < config.maxConcurrentPositions, detail: `Open positions and pending orders count toward the ${config.maxConcurrentPositions} position limit.` },
    { name: "Broker margin estimate", passed: proposal.marginPerLot === null || (Number.isFinite(proposal.marginPerLot) && proposal.marginPerLot > 0), detail: proposal.marginPerLot === null ? "Broker margin will be checked during bridge preflight." : "The bridge must provide a positive MT5 order_calc_margin estimate." },
    { name: "Exposure estimate", passed: Number.isFinite(proposal.notionalPerLot) && proposal.notionalPerLot > 0 && Number.isFinite(account.existingExposure), detail: "Notional exposure is calculated in the account currency using the broker tick value." },
    { name: "Volume limits", passed: volume >= instrument.volumeMin && volume <= instrument.volumeMax && volumeAligned, detail: `Volume must align to broker range ${instrument.volumeMin}–${instrument.volumeMax} by ${instrument.volumeStep}.` },
    { name: "Risk and margin budget", passed: maxVolume >= instrument.volumeMin && volume <= maxVolume, detail: `Maximum permitted volume is ${Number(maxVolume.toPrecision(12))} lots.` },
    { name: "Position notional", passed: proposal.notionalPerLot > 0 && volume * proposal.notionalPerLot <= Math.max(0, account.equity) * config.maxPositionPct / 100 + 1e-8, detail: `Position notional must not exceed ${config.maxPositionPct}% of equity.` },
    { name: "Aggregate exposure", passed: proposal.notionalPerLot > 0 && account.existingExposure + volume * proposal.notionalPerLot <= Math.max(0, account.equity) * config.maxExposurePct / 100 + 1e-8, detail: `Account exposure must not exceed ${config.maxExposurePct}% of equity.` },
    { name: "Free margin", passed: proposal.marginPerLot === null || estimatedMargin <= account.freeMargin, detail: proposal.marginPerLot === null ? "Free margin will be checked against the broker estimate during preflight." : `Estimated margin ${estimatedMargin.toFixed(2)}; free margin ${account.freeMargin.toFixed(2)}.` },
  ];
  return {
    accepted: checks.every((check) => check.passed),
    volume: Number(volume.toPrecision(12)),
    estimatedMargin: Number(estimatedMargin.toPrecision(12)),
    riskReward,
    checks,
  };
}

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
