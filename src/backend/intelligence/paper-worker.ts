import "dotenv/config";
import { desc, eq, sql } from "drizzle-orm";
import { db, pool } from "@backend/db";
import { acquireWorkerLock } from "@backend/lib/server/worker-lock";
import {
  engineHealth,
  engineLogs,
  marketAnalyses,
  paperAccounts,
  paperOrders,
  paperPositions,
  riskConfigurations,
  systemState,
  tradingDecisions,
  tradingStrategies,
} from "@backend/db/schema";
import { getCandles, getLatestOrderBookSnapshot, getRecentTrades } from "@backend/market-data/store";
import { analyzeMarket } from "./indicators";
import { ensureTradingDefaults, PAPER_ACCOUNT_ID, RISK_CONFIG_ID } from "./service";
import { validatePaperOrder, type RiskCheck, type RiskConfig } from "./risk";
import { decide, type StrategyDefinition } from "./strategies";

const ENGINE = "paper-trading";
const SYMBOL = "BTCUSDT";
const INTERVAL = "1m";
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let stopping = false;
let releaseWorkerLock: (() => Promise<void>) | null = null;

function configFromRow(row: typeof riskConfigurations.$inferSelect): RiskConfig {
  return {
    maxRiskPerTradePct: row.maxRiskPerTradePct,
    maxDailyLossPct: row.maxDailyLossPct,
    maxDrawdownPct: row.maxDrawdownPct,
    maxPositionPct: row.maxPositionPct,
    maxConcurrentPositions: row.maxConcurrentPositions,
    minRiskReward: row.minRiskReward,
    maxExposurePct: row.maxExposurePct,
    feeRate: row.feeRate,
    slippageRate: row.slippageRate,
  };
}

async function stateValue(key: string): Promise<string | null> {
  const [row] = await db.select({ value: systemState.value }).from(systemState).where(eq(systemState.key, key)).limit(1);
  return row?.value ?? null;
}

async function setEngineHealth(state: string, lastError: string | null = null, details: Record<string, unknown> = {}) {
  const now = new Date();
  await db.insert(engineHealth).values({ engine: ENGINE, state, lastCycleAt: now, lastError, details, updatedAt: now })
    .onConflictDoUpdate({ target: engineHealth.engine, set: { state, lastCycleAt: now, lastError, details, updatedAt: now } });
}

async function logEvent(level: string, event: string, details: Record<string, unknown>) {
  await db.insert(engineLogs).values({ engine: ENGINE, level, event, details, createdAt: new Date() });
}

async function persistAnalysis(analysis: ReturnType<typeof analyzeMarket>) {
  await db.insert(marketAnalyses).values({
    symbol: analysis.symbol,
    interval: analysis.interval,
    candleOpenTime: analysis.candleOpenTime,
    observed: analysis.observed,
    indicators: analysis.indicators,
    regime: analysis.regime,
    confidence: analysis.confidence,
    provenance: analysis.provenance,
    createdAt: new Date(),
  }).onConflictDoUpdate({
    target: [marketAnalyses.symbol, marketAnalyses.interval, marketAnalyses.candleOpenTime],
    set: {
      observed: analysis.observed,
      indicators: analysis.indicators,
      regime: analysis.regime,
      confidence: analysis.confidence,
      provenance: analysis.provenance,
    },
  });
}

async function processStrategy(
  strategy: StrategyDefinition,
  analysis: ReturnType<typeof analyzeMarket>,
  previous: ReturnType<typeof analyzeMarket>["indicators"] | null,
  execution: { time: Date; open: number; high: number; low: number; close: number },
) {
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(83710421)`);
    const inserted = await tx.insert(tradingDecisions).values({
      strategySlug: strategy.slug,
      strategyVersion: strategy.version,
      symbol: SYMBOL,
      interval: INTERVAL,
      candleOpenTime: analysis.candleOpenTime,
      action: "HOLD",
      status: "pending",
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      confidence: 0,
      regime: analysis.regime.label,
      supportingIndicators: [],
      explanation: "",
      invalidation: [],
      riskChecks: null,
      orderId: null,
      createdAt: new Date(),
    }).onConflictDoNothing({
      target: [
        tradingDecisions.strategySlug,
        tradingDecisions.symbol,
        tradingDecisions.interval,
        tradingDecisions.candleOpenTime,
      ],
    }).returning({ id: tradingDecisions.id });
    const decisionId = inserted[0]?.id;
    if (!decisionId) return;

    const [account] = await tx.select().from(paperAccounts).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID)).for("update").limit(1);
    if (!account) throw new Error("Paper account is missing");
    const [riskRow] = await tx.select().from(riskConfigurations).where(eq(riskConfigurations.id, RISK_CONFIG_ID)).limit(1);
    if (!riskRow) throw new Error("Paper risk configuration is missing");
    const positions = await tx.select().from(paperPositions).for("update");
    const position = positions.find((row) => row.symbol === SYMBOL);
    const accountRisk = configFromRow(riskRow);
    const today = new Date().toISOString().slice(0, 10);
    const cash = Number(account.cashBalance);
    const quantity = position ? Number(position.quantity) : 0;
    const markPrice = position ? execution.close : 0;
    if (position) {
      await tx.update(paperPositions).set({ markPrice: String(markPrice), updatedAt: new Date() })
        .where(eq(paperPositions.symbol, SYMBOL));
    }
    const equity = cash + quantity * markPrice;
    const peak = Math.max(Number(account.peakEquity), equity);
    const dayStartEquity = account.dayStartDate === today ? Number(account.dayStartEquity) : equity;
    const dailyLossPct = dayStartEquity > 0 ? (dayStartEquity - equity) / dayStartEquity * 100 : 100;
    const drawdownPct = peak > 0 ? (peak - equity) / peak * 100 : 100;
    const autoHalt = dailyLossPct >= accountRisk.maxDailyLossPct || drawdownPct >= accountRisk.maxDrawdownPct;
    const halted = account.halted || autoHalt;
    await tx.update(paperAccounts).set({
      peakEquity: String(peak),
      dayStartEquity: String(dayStartEquity),
      dayStartDate: today,
      halted,
      updatedAt: new Date(),
    }).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID));

    const signal = decide(strategy, analysis, previous);
    const holding = Boolean(position && quantity > 0);
    const heldExposure = holding ? quantity * execution.close : 0;
    const accountState = {
      equity,
      cash,
      exposure: heldExposure,
      dayStartEquity,
      peakEquity: peak,
      openPositions: holding ? 1 : 0,
      hasPosition: holding,
      halted,
    };

    const protectionHit = holding && position
      ? execution.low <= Number(position.stopLoss)
        ? { price: Math.min(execution.open, Number(position.stopLoss)), reason: "Stop-loss triggered; stop is evaluated before take-profit when both are touched." }
        : execution.high >= Number(position.takeProfit)
          ? { price: Math.max(execution.open, Number(position.takeProfit)), reason: "Take-profit level reached." }
          : null
      : null;
    const action = protectionHit ? "SELL" : signal.action === "SELL" && !holding ? "HOLD" : signal.action;
    const price = protectionHit?.price ?? execution.open;
    const proposedEntry = action === "BUY" ? price * (1 + accountRisk.slippageRate) : price;
    const stopLoss = signal.stopLoss;
    const takeProfit = signal.takeProfit;
    const reward = action === "BUY" && takeProfit !== null ? takeProfit - proposedEntry : null;
    const loss = action === "BUY" && stopLoss !== null ? proposedEntry - stopLoss : null;
    const riskReward = reward !== null && loss !== null && loss > 0 ? reward / loss : null;

    let checks: RiskCheck[] = [];
    let status = "hold";
    let orderId: number | null = null;
    let orderQuantity = 0;
    let orderPrice = proposedEntry;
    let fee = 0;
    let slippage = 0;
    let realizedPnl = 0;
    let explanation = protectionHit?.reason ?? (
      signal.action === "SELL" && !holding
        ? "Exit condition met, but no position is open; remain in cash."
        : signal.explanation
    );
    let finalAction: "BUY" | "SELL" | "HOLD" = action;
    let finalSignal = signal;

    if (action === "HOLD") {
      await tx.update(tradingDecisions).set({
        action: "HOLD",
        status: "hold",
        confidence: signal.confidence,
        regime: analysis.regime.label,
        supportingIndicators: signal.supportingIndicators,
        explanation: signal.explanation,
        invalidation: signal.invalidation,
        createdAt: new Date(),
      }).where(eq(tradingDecisions.id, decisionId));
      return;
    }

    const validation = validatePaperOrder(accountRisk, accountState, {
      side: action === "BUY" ? "buy" : "sell",
      price: proposedEntry,
      stopLoss: action === "BUY" ? stopLoss : null,
      takeProfit: action === "BUY" ? takeProfit : null,
      riskReward,
    });
    orderQuantity = action === "BUY" ? validation.quantity : quantity;
    checks = validation.checks;
    if (action === "SELL" && !protectionHit && !holding) {
      checks = [...checks, { name: "Position required", passed: false, detail: "No long BTCUSDT position is open to sell." }];
    }
    if (action === "BUY" && holding) {
      checks = [...checks, { name: "No duplicate position", passed: false, detail: "A BTCUSDT paper position is already open." }];
    }
    const accepted = validation.accepted && !(action === "SELL" && !holding) && !(action === "BUY" && holding);
    status = accepted ? "executed" : "rejected";
    finalAction = action;
    finalSignal = protectionHit ? {
      ...signal,
      action: "SELL",
      confidence: 1,
      supportingIndicators: ["Protective stop/target price reached on the next closed Binance candle."],
      explanation: protectionHit.reason,
    } : signal;

    if (accepted && action === "BUY") {
      orderPrice = proposedEntry;
      fee = orderQuantity * orderPrice * accountRisk.feeRate;
      slippage = orderQuantity * Math.abs(orderPrice - price);
      await tx.update(paperAccounts).set({
        cashBalance: String(cash - orderQuantity * orderPrice - fee),
        realizedPnl: String(Number(account.realizedPnl) - fee),
        updatedAt: new Date(),
      }).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID));
      await tx.insert(paperPositions).values({
        symbol: SYMBOL,
        quantity: String(orderQuantity),
        averageEntryPrice: String(orderPrice),
        markPrice: String(execution.close),
        stopLoss: stopLoss === null ? null : String(stopLoss),
        takeProfit: takeProfit === null ? null : String(takeProfit),
        realizedPnl: "0",
        openedAt: execution.time,
        updatedAt: new Date(),
      });
    } else if (accepted && action === "SELL" && position) {
      orderPrice = price * (1 - accountRisk.slippageRate);
      fee = orderQuantity * orderPrice * accountRisk.feeRate;
      slippage = orderQuantity * Math.abs(price - orderPrice);
      realizedPnl = (orderPrice - Number(position.averageEntryPrice)) * orderQuantity - fee;
      await tx.update(paperAccounts).set({
        cashBalance: String(cash + orderQuantity * orderPrice - fee),
        realizedPnl: String(Number(account.realizedPnl) + realizedPnl),
        updatedAt: new Date(),
      }).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID));
      await tx.delete(paperPositions).where(eq(paperPositions.symbol, SYMBOL));
    }

    const [order] = await tx.insert(paperOrders).values({
      clientOrderId: `paper:${strategy.slug}:${analysis.candleOpenTime.getTime()}`,
      symbol: SYMBOL,
      side: action.toLowerCase(),
      orderType: "market",
      quantity: orderQuantity,
      price: orderPrice,
      fee: accepted ? fee : 0,
      slippage: accepted ? slippage : 0,
      realizedPnl: accepted ? realizedPnl : 0,
      status: accepted ? "filled" : "rejected",
      reason: accepted ? null : checks.find((check) => !check.passed)?.detail ?? "Rejected by independent risk validation",
      strategy: strategy.slug,
      decisionId,
      riskChecks: checks.filter((check) => check.passed).length,
      riskDetails: checks,
      createdAt: new Date(),
      executedAt: accepted ? new Date() : null,
      stopLoss: action === "BUY" && stopLoss !== null ? String(stopLoss) : null,
      takeProfit: action === "BUY" && takeProfit !== null ? String(takeProfit) : null,
    }).returning({ id: paperOrders.id });
    orderId = order.id;
    await tx.update(tradingDecisions).set({
      action: finalAction,
      status,
      entryPrice: action === "BUY" ? String(orderPrice) : null,
      stopLoss: action === "BUY" && stopLoss !== null ? String(stopLoss) : null,
      takeProfit: action === "BUY" && takeProfit !== null ? String(takeProfit) : null,
      riskReward,
      confidence: finalSignal.confidence,
      regime: analysis.regime.label,
      supportingIndicators: finalSignal.supportingIndicators,
      explanation: accepted ? explanation : checks.find((check) => !check.passed)?.detail ?? explanation,
      invalidation: finalSignal.invalidation,
      riskChecks: checks,
      orderId,
    }).where(eq(tradingDecisions.id, decisionId));
    await tx.insert(engineLogs).values({
      engine: ENGINE,
      level: accepted ? "info" : "warn",
      event: accepted ? "paper_order_filled" : "paper_order_rejected",
      details: { strategy: strategy.slug, decisionId, orderId, checks, entryPrice: orderPrice, quantity: orderQuantity },
      createdAt: new Date(),
    });
  });
}

async function cycle(): Promise<void> {
  const mode = await stateValue("paper_trading_state");
  if (mode !== "running") {
    await setEngineHealth(mode === "paused" ? "paused" : "stopped");
    return;
  }
  const candles = (await getCandles(SYMBOL, INTERVAL, 503)).filter((candle) => candle.isClosed);
  if (candles.length < 201) {
    await setEngineHealth("waiting_for_data", null, { closedCandles: candles.length, required: 201 });
    return;
  }
  const signalCandles = candles;
  const signalRow = signalCandles[signalCandles.length - 1];
  const [latestTrade] = await getRecentTrades(SYMBOL, 1);
  if (!latestTrade || latestTrade.tradeTime <= signalRow.closeTime || Date.now() - latestTrade.receivedAt.getTime() > 120_000) {
    await setEngineHealth("waiting_for_fresh_data", null, { lastClosedCandle: signalRow.openTime.toISOString() });
    return;
  }
  const orderBook = await getLatestOrderBookSnapshot(SYMBOL);
  const analysis = analyzeMarket(SYMBOL, INTERVAL, signalCandles.slice(-250), orderBook ?? undefined);
  const previous = signalCandles.length > 1
    ? analyzeMarket(SYMBOL, INTERVAL, signalCandles.slice(-251, -1), orderBook ?? undefined).indicators
    : null;
  const execution = {
    time: latestTrade.tradeTime,
    open: Number(latestTrade.price),
    high: Number(latestTrade.price),
    low: Number(latestTrade.price),
    close: Number(latestTrade.price),
  };
  await persistAnalysis(analysis);
  const active = await db.select().from(tradingStrategies).where(eq(tradingStrategies.active, true)).orderBy(desc(tradingStrategies.slug));
  for (const strategy of active) {
    await processStrategy(strategy, analysis, previous, execution);
  }
  await setEngineHealth("running", null, {
    symbol: SYMBOL,
    interval: INTERVAL,
    lastDecisionCandle: signalRow.openTime.toISOString(),
    activeStrategies: active.map((strategy) => strategy.slug),
  });
}

async function main() {
  releaseWorkerLock = await acquireWorkerLock(pool, 83_710_423, "paper-trading", (error) => {
    console.error(`[paper-trading] worker lock connection failed: ${error.message}`);
    process.exitCode = 1;
    process.kill(process.pid, "SIGTERM");
  });
  await ensureTradingDefaults();
  const intervalMs = Number(process.env.PAPER_TRADING_POLL_MS ?? 5_000);
  if (!Number.isInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 60_000) {
    throw new Error("PAPER_TRADING_POLL_MS must be between 1000 and 60000");
  }
  process.once("SIGINT", () => { stopping = true; });
  process.once("SIGTERM", () => { stopping = true; });
  await setEngineHealth("stopped");
  await logEvent("info", "engine_started", { symbol: SYMBOL, interval: INTERVAL, pollMs: intervalMs, paperOnly: true });

  while (!stopping) {
    try {
      await cycle();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[paper-trading] ${message}`);
      await setEngineHealth("degraded", message);
      await logEvent("error", "cycle_failed", { message });
    }
    await wait(intervalMs);
  }

  await setEngineHealth("stopped");
  await logEvent("info", "engine_stopped", { at: new Date().toISOString() });
  if (releaseWorkerLock) await releaseWorkerLock();
  await pool.end();
}

main().catch(async (error: unknown) => {
  console.error(`[paper-trading] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  if (releaseWorkerLock) await releaseWorkerLock().catch((lockError: unknown) => {
    console.error(`[paper-trading] worker lock release failed: ${String(lockError)}`);
  });
  await pool.end();
  process.exitCode = 1;
});
