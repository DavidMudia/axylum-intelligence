import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RISK_CONFIG, validateMt5Order, validatePaperOrder } from "./risk";

const MT5_ACCOUNT = {
  accountType: "demo",
  equity: 10_000,
  dayStartEquity: 10_000,
  peakEquity: 10_000,
  existingExposure: 0,
  freeMargin: 9_000,
  usedMargin: 1_000,
  openPositions: 0,
  pendingOrders: 0,
  tradingAllowed: true,
};
const MT5_INSTRUMENT = {
  point: 0.00001,
  tickSize: 0.00001,
  tickValue: 1,
  volumeMin: 0.01,
  volumeMax: 100,
  volumeStep: 0.01,
  stopsLevelPoints: 10,
};
const MT5_PROPOSAL = {
  side: "buy" as const,
  price: 1.1,
  stopLoss: 1.099,
  takeProfit: 1.102,
  requestedVolume: 0.1,
  spreadPoints: 2,
  notionalPerLot: 110_000,
  marginPerLot: 1_000,
  maxSpreadPoints: 30,
  emergencyHalt: false,
  demoOrdersEnabled: true,
};

test("MT5 sizing applies lot steps, tick-value risk and broker-calculated margin limits", () => {
  const config = { ...DEFAULT_RISK_CONFIG, maxPositionPct: 200, maxExposurePct: 300 };
  const result = validateMt5Order(config, MT5_ACCOUNT, MT5_INSTRUMENT, MT5_PROPOSAL);
  assert.equal(result.accepted, true, JSON.stringify(result.checks));
  assert.equal(result.volume, 0.1);
  assert.equal(result.estimatedMargin, 100);
  assert.ok(Math.abs((result.riskReward ?? 0) - 2) < 1e-8);
});

test("MT5 preflight can validate risk before broker margin is available", () => {
  const config = { ...DEFAULT_RISK_CONFIG, maxPositionPct: 200, maxExposurePct: 300 };
  const result = validateMt5Order(config, MT5_ACCOUNT, MT5_INSTRUMENT, {
    ...MT5_PROPOSAL,
    marginPerLot: null,
  });
  assert.equal(result.accepted, true, JSON.stringify(result.checks));
  assert.equal(result.estimatedMargin, 0);
});

test("MT5 risk limits include current aggregate notional exposure", () => {
  const config = { ...DEFAULT_RISK_CONFIG, maxPositionPct: 20 };
  const result = validateMt5Order(config, { ...MT5_ACCOUNT, existingExposure: 2_000 }, MT5_INSTRUMENT, {
    ...MT5_PROPOSAL,
    requestedVolume: 0.01,
  });
  assert.equal(result.accepted, false);
  assert.ok(result.checks.some((check) => check.name === "Aggregate exposure" && !check.passed));
});

test("MT5 rejects live accounts, unsafe stops, excessive spread, and volumes above risk", () => {
  const live = validateMt5Order(DEFAULT_RISK_CONFIG, { ...MT5_ACCOUNT, accountType: "live" }, MT5_INSTRUMENT, MT5_PROPOSAL);
  assert.equal(live.accepted, false);
  assert.ok(live.checks.some((check) => check.name === "Demo account" && !check.passed));

  const wideSpread = validateMt5Order(DEFAULT_RISK_CONFIG, MT5_ACCOUNT, MT5_INSTRUMENT, {
    ...MT5_PROPOSAL,
    spreadPoints: 31,
  });
  assert.equal(wideSpread.accepted, false);

  const oversized = validateMt5Order(DEFAULT_RISK_CONFIG, MT5_ACCOUNT, MT5_INSTRUMENT, {
    ...MT5_PROPOSAL,
    requestedVolume: 1,
  });
  assert.equal(oversized.accepted, false);

  const invalidStops = validateMt5Order(DEFAULT_RISK_CONFIG, MT5_ACCOUNT, MT5_INSTRUMENT, {
    ...MT5_PROPOSAL,
    stopLoss: 1.101,
  });
  assert.equal(invalidStops.accepted, false);
});

test("sizing caps risk, position notional and available cash", () => {
  const result = validatePaperOrder(DEFAULT_RISK_CONFIG, {
    equity: 10_000,
    cash: 10_000,
    exposure: 0,
    dayStartEquity: 10_000,
    peakEquity: 10_000,
    openPositions: 0,
    hasPosition: false,
    halted: false,
  }, {
    side: "buy",
    price: 100,
    stopLoss: 99,
    takeProfit: 102,
    riskReward: 2,
  });
  assert.equal(result.accepted, true);
  assert.ok(result.quantity <= 50);
  assert.ok(result.quantity * 100 <= 1_000);
});

test("risk violations reject entries while allowing protective exits", () => {
  const account = {
    equity: 8_000,
    cash: 2_000,
    exposure: 6_000,
    dayStartEquity: 10_000,
    peakEquity: 10_000,
    openPositions: 1,
    hasPosition: true,
    halted: true,
  };
  const entry = validatePaperOrder(DEFAULT_RISK_CONFIG, account, {
    side: "buy",
    price: 100,
    stopLoss: 99,
    takeProfit: 102,
    riskReward: 2,
  });
  assert.equal(entry.accepted, false);
  const exit = validatePaperOrder(DEFAULT_RISK_CONFIG, account, {
    side: "sell",
    price: 100,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
  });
  assert.equal(exit.accepted, true);
});
