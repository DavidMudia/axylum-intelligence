import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_RISK_CONFIG, validatePaperOrder } from "./risk";

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
