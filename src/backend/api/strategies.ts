import { desc, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { backtestRuns, tradingStrategies } from "@backend/db/schema";
import { getCandles } from "@backend/market-data/store";
import { audit } from "@backend/lib/server/state";
import { runHistoricalBacktest } from "@backend/intelligence/backtest";
import { ensureTradingDefaults, getRiskConfig, PAPER_STARTING_BALANCE } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";
const intervals = new Set(["1m", "5m", "15m", "1h", "4h", "1d"]);

export async function GET() {
  await ensureTradingDefaults();
  const [strategies, runs] = await Promise.all([
    db.select().from(tradingStrategies).orderBy(desc(tradingStrategies.updatedAt)),
    db.select().from(backtestRuns).orderBy(desc(backtestRuns.createdAt)).limit(20),
  ]);
  return Response.json({ strategies, backtests: runs });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  await ensureTradingDefaults();

  if (body.action === "toggle") {
    if (typeof body.slug !== "string" || typeof body.active !== "boolean") {
      return Response.json({ error: "A strategy slug and active boolean are required" }, { status: 400 });
    }
    const [existing] = await db.select().from(tradingStrategies).where(eq(tradingStrategies.slug, body.slug)).limit(1);
    if (!existing) return Response.json({ error: "Unknown strategy" }, { status: 404 });
    const [strategy] = await db.update(tradingStrategies).set({
      active: body.active,
      version: existing.active === body.active ? existing.version : existing.version + 1,
      updatedAt: new Date(),
    }).where(eq(tradingStrategies.slug, existing.slug)).returning();
    await audit("operator", body.active ? "strategy.activated" : "strategy.deactivated", `${strategy.name} v${strategy.version}`);
    return Response.json({ strategy });
  }

  if (body.action === "configure") {
    if (typeof body.slug !== "string" || typeof body.rules !== "object" || body.rules === null || Array.isArray(body.rules)) {
      return Response.json({ error: "A strategy slug and numeric rules object are required" }, { status: 400 });
    }
    const [existing] = await db.select().from(tradingStrategies).where(eq(tradingStrategies.slug, body.slug)).limit(1);
    if (!existing) return Response.json({ error: "Unknown strategy" }, { status: 404 });
    const permitted = existing.slug === "ema-trend"
      ? { rsiMin: [20, 60], rsiMax: [40, 80], volumeRatioMin: [0.1, 5], stopAtr: [0.5, 4], targetAtr: [1, 8] }
      : { rsiEntry: [10, 40], rsiExit: [55, 90], supportDistancePct: [0.1, 3], stopAtr: [0.5, 4], targetAtr: [1, 8] };
    const submitted = body.rules as Record<string, unknown>;
    const rules = { ...existing.rules };
    for (const [key, range] of Object.entries(permitted)) {
      if (!(key in submitted)) continue;
      const value = Number(submitted[key]);
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) {
        return Response.json({ error: `${key} must be between ${range[0]} and ${range[1]}` }, { status: 400 });
      }
      rules[key] = value;
    }
    if (Object.keys(submitted).some((key) => !(key in permitted))) {
      return Response.json({ error: "One or more submitted rules are not configurable for this strategy" }, { status: 400 });
    }
    const configRisk = await getRiskConfig();
    const minimumEntry = Number(rules.rsiMin ?? 40);
    const maximumEntry = Number(rules.rsiMax ?? 68);
    const oversold = Number(rules.rsiEntry ?? 30);
    const exit = Number(rules.rsiExit ?? 68);
    const stopMultiple = Number(rules.stopAtr ?? 1.5);
    const targetMultiple = Number(rules.targetAtr ?? 3);
    if ((existing.slug === "ema-trend" && minimumEntry >= maximumEntry) ||
      (existing.slug === "rsi-reversal" && oversold >= exit) ||
      targetMultiple / stopMultiple < configRisk.minRiskReward) {
      return Response.json({ error: "Entry thresholds must be ordered correctly and target/stop multiples must meet the configured minimum risk/reward." }, { status: 400 });
    }
    const [strategy] = await db.update(tradingStrategies).set({
      rules,
      version: existing.version + 1,
      updatedAt: new Date(),
    }).where(eq(tradingStrategies.slug, existing.slug)).returning();
    await audit("operator", "strategy.rules.updated", `${strategy.name} updated to v${strategy.version}`);
    return Response.json({ strategy });
  }

  if (body.action !== "backtest") {
    return Response.json({ error: "Supported actions are configure, toggle and backtest" }, { status: 400 });
  }
  const strategySlug = typeof body.strategySlug === "string" ? body.strategySlug : "ema-trend";
  if (!["ema-trend", "rsi-reversal"].includes(strategySlug)) {
    return Response.json({ error: "Unsupported strategy" }, { status: 400 });
  }
  const interval = typeof body.interval === "string" ? body.interval : "1m";
  if (!intervals.has(interval)) return Response.json({ error: "Unsupported candle interval" }, { status: 400 });
  const requestedLimit = Number(body.limit ?? 50_000);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 250 || requestedLimit > 100_000) {
    return Response.json({ error: "limit must be an integer from 250 to 100000" }, { status: 400 });
  }
  const [strategy] = await db.select().from(tradingStrategies).where(eq(tradingStrategies.slug, strategySlug)).limit(1);
  if (!strategy) return Response.json({ error: "Strategy is not configured" }, { status: 404 });
  const candles = (await getCandles("BTCUSDT", interval, requestedLimit)).filter((candle) => candle.isClosed);
  if (candles.length < 250) {
    return Response.json({ error: `Backtesting requires at least 250 closed candles; found ${candles.length}` }, { status: 422 });
  }
  const risk = await getRiskConfig();
  let result;
  try {
    result = runHistoricalBacktest(candles, {
      strategySlug,
      symbol: "BTCUSDT",
      interval,
      risk,
      startingEquity: PAPER_STARTING_BALANCE,
      rules: strategy.rules,
    });
  } catch (error) {
    if (error instanceof RangeError) return Response.json({ error: error.message }, { status: 422 });
    throw error;
  }
  const [run] = await db.insert(backtestRuns).values({
    strategySlug,
    strategyVersion: strategy.version,
    symbol: "BTCUSDT",
    interval,
    fromTime: result.fromTime,
    toTime: result.toTime,
    metrics: result.metrics,
    equityCurve: result.equityCurve,
    trades: result.trades,
    createdAt: new Date(),
  }).returning();
  await audit("operator", "backtest.completed", `${strategySlug} v${strategy.version}; ${result.metrics.inSample.trades} simulated trades over ${candles.length} closed Binance candles.`);
  return Response.json({ result: { ...result, runId: run.id, strategyVersion: strategy.version } });
}
