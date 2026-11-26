import { desc, eq, sql } from "drizzle-orm";
import { db } from "@backend/db";
import {
  engineHealth,
  engineLogs,
  marketAnalyses,
  paperAccounts,
  paperOrders,
  paperPositions,
  riskConfigurations,
  tradingDecisions,
  tradingStrategies,
} from "@backend/db/schema";
import { getCandles, getLatestOrderBookSnapshot, getIngestionStatus } from "@backend/market-data/store";
import { analyzeMarket, type CandleInput } from "./indicators";
import { DEFAULT_STRATEGIES } from "./strategies";
import { DEFAULT_RISK_CONFIG, type RiskConfig } from "./risk";

export const PAPER_ACCOUNT_ID = "btc-paper-usdt";
export const RISK_CONFIG_ID = "btc-spot-default";
export const PAPER_STARTING_BALANCE = 100_000;
export { DEFAULT_RISK_CONFIG };

function asCandleInput(candle: Awaited<ReturnType<typeof getCandles>>[number]): CandleInput {
  return {
    openTime: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    baseVolume: candle.baseVolume,
    quoteVolume: candle.quoteVolume,
  };
}

export async function ensureTradingDefaults(): Promise<void> {
  const now = new Date();
  for (const strategy of DEFAULT_STRATEGIES) {
    await db.insert(tradingStrategies).values({ ...strategy, updatedAt: now, createdAt: now })
      .onConflictDoNothing({ target: tradingStrategies.slug });
  }
  await db.insert(riskConfigurations).values({
    id: RISK_CONFIG_ID,
    ...DEFAULT_RISK_CONFIG,
    startingBalance: String(PAPER_STARTING_BALANCE),
    updatedAt: now,
  }).onConflictDoNothing({ target: riskConfigurations.id });
  const today = now.toISOString().slice(0, 10);
  await db.insert(paperAccounts).values({
    id: PAPER_ACCOUNT_ID,
    startingBalance: String(PAPER_STARTING_BALANCE),
    cashBalance: String(PAPER_STARTING_BALANCE),
    realizedPnl: "0",
    peakEquity: String(PAPER_STARTING_BALANCE),
    dayStartEquity: String(PAPER_STARTING_BALANCE),
    dayStartDate: today,
    halted: false,
    updatedAt: now,
  }).onConflictDoNothing({ target: paperAccounts.id });
}

export async function getRiskConfig(): Promise<RiskConfig> {
  await ensureTradingDefaults();
  const [row] = await db.select().from(riskConfigurations).where(eq(riskConfigurations.id, RISK_CONFIG_ID)).limit(1);
  if (!row) throw new Error("Paper trading risk configuration is missing");
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

export async function getMarketAnalysis(symbol = "BTCUSDT", interval = "1m") {
  if (symbol !== "BTCUSDT") throw new RangeError("Phase 2 currently supports BTCUSDT only");
  const candles = (await getCandles(symbol, interval, 500)).filter((candle) => candle.isClosed).map(asCandleInput);
  if (candles.length < 20) throw new Error("Insufficient closed BTCUSDT candles for analysis");
  const orderBook = await getLatestOrderBookSnapshot(symbol);
  const analysis = analyzeMarket(symbol, interval, candles, orderBook ?? undefined);
  await db.insert(marketAnalyses).values({
    symbol,
    interval,
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
  return { analysis, candles };
}

export async function getPaperPortfolio() {
  await ensureTradingDefaults();
  const [account] = await db.select().from(paperAccounts).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID)).limit(1);
  if (!account) throw new Error("Paper account is missing");
  const positions = await db.select().from(paperPositions).orderBy(desc(paperPositions.openedAt));
  const orders = await db.select().from(paperOrders).orderBy(desc(paperOrders.createdAt)).limit(100);
  const latest = (await getCandles("BTCUSDT", "1m", 1))[0];
  const livePrice = latest ? Number(latest.close) : 0;
  const openPositions = positions.map((position) => {
    const mark = position.symbol === "BTCUSDT" && livePrice > 0 ? livePrice : Number(position.markPrice);
    const quantity = Number(position.quantity);
    const avgCost = Number(position.averageEntryPrice);
    return {
      symbol: position.symbol,
      qty: quantity,
      avgCost,
      mark,
      value: quantity * mark,
      unrealized: (mark - avgCost) * quantity,
      pct: avgCost ? (mark / avgCost - 1) * 100 : 0,
    };
  });
  const unrealized = openPositions.reduce((sum, position) => sum + position.unrealized, 0);
  const cash = Number(account.cashBalance);
  const exposure = openPositions.reduce((sum, position) => sum + position.value, 0);
  const equity = cash + exposure;
  const realized = Number(account.realizedPnl);
  const fees = await db.select({ total: sql<number>`coalesce(sum(${paperOrders.fee}), 0)` }).from(paperOrders);
  const slippage = await db.select({ total: sql<number>`coalesce(sum(${paperOrders.slippage}), 0)` }).from(paperOrders);

  return {
    account: { id: account.id, currency: account.currency, halted: account.halted, updatedAt: account.updatedAt },
    positions: openPositions,
    orders: orders.map((order) => ({
      ...order,
      quantity: Number(order.quantity),
      price: Number(order.price),
      fee: Number(order.fee),
      slippage: Number(order.slippage),
    })),
    summary: {
      equity,
      cash,
      exposure,
      exposurePct: equity ? exposure / equity * 100 : 0,
      unrealized,
      realized,
      fees: Number(fees[0]?.total ?? 0),
      slippage: Number(slippage[0]?.total ?? 0),
      filled: orders.filter((order) => order.status === "filled").length,
      rejected: orders.filter((order) => order.status === "rejected").length,
      startingEquity: Number(account.startingBalance),
      livePrice,
    },
  };
}

export async function getEngineOverview() {
  await ensureTradingDefaults();
  const [health, logs, strategies, ingestion] = await Promise.all([
    db.select().from(engineHealth).orderBy(desc(engineHealth.updatedAt)),
    db.select().from(engineLogs).orderBy(desc(engineLogs.createdAt)).limit(50),
    db.select().from(tradingStrategies).orderBy(desc(tradingStrategies.updatedAt)),
    getIngestionStatus("BTCUSDT"),
  ]);
  return { health, logs, strategies, ingestion };
}

export async function getRecentDecisions(limit = 50) {
  return db.select().from(tradingDecisions).where(eq(tradingDecisions.symbol, "BTCUSDT")).orderBy(desc(tradingDecisions.createdAt)).limit(limit);
}
