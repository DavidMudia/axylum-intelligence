import { and, desc, eq, inArray, lt, ne, sql } from "drizzle-orm";
import { db } from "@backend/db";
import { audit, getOperatingState } from "@backend/lib/server/state";
import { getRiskConfig } from "@backend/intelligence/service";
import { validateMt5Order, type RiskCheck } from "@backend/intelligence/risk";
import {
  mt5Accounts,
  mt5Bridges,
  mt5Deals,
  mt5Instruments,
  mt5MarketCandles,
  mt5MarketTicks,
  mt5OrderIntents,
  mt5PendingOrders,
  mt5Positions,
} from "@backend/db/schema";
import type { AuthenticatedMt5Bridge } from "./bridge-auth";
import type {
  Mt5AccountSnapshot,
  Mt5ExecutionResult,
  Mt5MarketDataBatch,
  Mt5OrderRequest,
  Mt5PreflightResult,
} from "./validation";

export class Mt5AccountNotFoundError extends Error {
  constructor() {
    super("The bridge account has not synchronized yet.");
    this.name = "Mt5AccountNotFoundError";
  }
}

export class Mt5InstrumentNotFoundError extends Error {
  constructor(symbols: string[]) {
    super(`The bridge account has not mapped these broker symbols: ${symbols.join(", ")}`);
    this.name = "Mt5InstrumentNotFoundError";
  }
}

export class Mt5OrderRequestError extends Error {
  constructor(message: string, readonly status: number = 422, readonly checks: RiskCheck[] = []) {
    super(message);
    this.name = "Mt5OrderRequestError";
  }
}

function demoOrdersEnabled(): boolean {
  return process.env.AXYLUM_MT5_DEMO_TRADING_ENABLED === "true";
}

function maxSpreadPoints(): number {
  const value = Number(process.env.AXYLUM_MT5_MAX_SPREAD_POINTS ?? "30");
  if (!Number.isFinite(value) || value <= 0) throw new Error("AXYLUM_MT5_MAX_SPREAD_POINTS must be a positive number.");
  return value;
}

function isFresh(date: Date | null, maximumAgeMs: number): boolean {
  const now = Date.now();
  return date !== null
    && date.getTime() >= now - maximumAgeMs
    && date.getTime() <= now + 5_000;
}

export async function recordMt5BridgeHeartbeat(
  bridge: AuthenticatedMt5Bridge,
  terminalVersion: string | null = null,
): Promise<void> {
  const now = new Date();
  await db.update(mt5Bridges).set({
    status: "online",
    terminalVersion,
    lastHeartbeatAt: now,
    lastError: null,
    updatedAt: now,
  }).where(eq(mt5Bridges.id, bridge.id));
}

export async function synchronizeMt5Account(
  bridge: AuthenticatedMt5Bridge,
  snapshot: Mt5AccountSnapshot,
): Promise<{ accountId: string; instrumentCount: number }> {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const result = await db.transaction(async (transaction) => {
    const [account] = await transaction
      .insert(mt5Accounts)
      .values({
        bridgeId: bridge.id,
        ownerUserId: bridge.ownerUserId,
        login: snapshot.account.login,
        server: snapshot.account.server,
        broker: snapshot.account.broker,
        accountType: snapshot.account.accountType,
        currency: snapshot.account.currency,
        leverage: snapshot.account.leverage,
        balance: snapshot.account.balance,
        equity: snapshot.account.equity,
        freeMargin: snapshot.account.freeMargin,
        usedMargin: snapshot.account.usedMargin,
        marginLevel: snapshot.account.marginLevel,
        floatingProfit: snapshot.account.floatingProfit,
        dayStartEquity: snapshot.account.equity,
        dayStartDate: today,
        peakEquity: snapshot.account.equity,
        tradingAllowed: snapshot.account.tradingAllowed,
        expertAllowed: snapshot.account.expertAllowed,
        connected: true,
        lastSyncAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [mt5Accounts.bridgeId, mt5Accounts.server, mt5Accounts.login],
        set: {
          broker: snapshot.account.broker,
          accountType: snapshot.account.accountType,
          currency: snapshot.account.currency,
          leverage: snapshot.account.leverage,
          balance: snapshot.account.balance,
          equity: snapshot.account.equity,
          freeMargin: snapshot.account.freeMargin,
          usedMargin: snapshot.account.usedMargin,
          marginLevel: snapshot.account.marginLevel,
          floatingProfit: snapshot.account.floatingProfit,
          dayStartEquity: sql`CASE WHEN ${mt5Accounts.dayStartDate} = ${today} THEN ${mt5Accounts.dayStartEquity} ELSE excluded.equity END`,
          dayStartDate: today,
          peakEquity: sql`GREATEST(${mt5Accounts.peakEquity}, excluded.equity)`,
          tradingAllowed: snapshot.account.tradingAllowed,
          expertAllowed: snapshot.account.expertAllowed,
          connected: true,
          lastSyncAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: mt5Accounts.id });

    if (snapshot.instruments.length) {
      await transaction
        .insert(mt5Instruments)
        .values(snapshot.instruments.map((instrument) => ({
          accountId: account.id,
          ...instrument,
          enabled: true,
          updatedAt: now,
        })))
        .onConflictDoUpdate({
          target: [mt5Instruments.accountId, mt5Instruments.brokerSymbol],
          set: {
            canonicalSymbol: sql`excluded.canonical_symbol`,
            assetClass: sql`excluded.asset_class`,
            description: sql`excluded.description`,
            baseCurrency: sql`excluded.base_currency`,
            quoteCurrency: sql`excluded.quote_currency`,
            digits: sql`excluded.digits`,
            point: sql`excluded.point`,
            tickSize: sql`excluded.tick_size`,
            tickValue: sql`excluded.tick_value`,
            contractSize: sql`excluded.contract_size`,
            volumeMin: sql`excluded.volume_min`,
            volumeMax: sql`excluded.volume_max`,
            volumeStep: sql`excluded.volume_step`,
            stopsLevelPoints: sql`excluded.stops_level_points`,
            enabled: true,
            updatedAt: now,
          },
        });
    }

    if (snapshot.positions !== undefined) {
        await transaction.update(mt5Positions).set({ closedAt: now, updatedAt: now })
          .where(and(eq(mt5Positions.accountId, account.id), sql`${mt5Positions.closedAt} IS NULL`));
    }
    if (snapshot.positions?.length) {
        await transaction.insert(mt5Positions).values(snapshot.positions.map((position) => ({
          accountId: account.id,
          brokerTicket: position.ticket,
          brokerSymbol: position.brokerSymbol,
          side: position.side,
          volume: position.volume,
          openPrice: position.openPrice,
          currentPrice: position.currentPrice,
          stopLoss: position.stopLoss,
          takeProfit: position.takeProfit,
          profit: position.profit,
          swap: position.swap,
          openedAt: position.openedAt,
          updatedAt: now,
          closedAt: null,
        }))).onConflictDoUpdate({
          target: [mt5Positions.accountId, mt5Positions.brokerTicket],
          set: {
            brokerSymbol: sql`excluded.broker_symbol`,
            side: sql`excluded.side`,
            volume: sql`excluded.volume`,
            openPrice: sql`excluded.open_price`,
            currentPrice: sql`excluded.current_price`,
            stopLoss: sql`excluded.stop_loss`,
            takeProfit: sql`excluded.take_profit`,
            profit: sql`excluded.profit`,
            swap: sql`excluded.swap`,
            openedAt: sql`excluded.opened_at`,
            updatedAt: now,
            closedAt: null,
          },
        });
    }

    if (snapshot.pendingOrders !== undefined) {
        await transaction.update(mt5PendingOrders).set({ active: false, updatedAt: now })
          .where(eq(mt5PendingOrders.accountId, account.id));
    }
    if (snapshot.pendingOrders?.length) {
        await transaction.insert(mt5PendingOrders).values(snapshot.pendingOrders.map((order) => ({
          accountId: account.id,
          brokerTicket: order.ticket,
          brokerSymbol: order.brokerSymbol,
          orderType: order.orderType,
          side: order.side,
          volume: order.volume,
          price: order.price,
          stopLoss: order.stopLoss,
          takeProfit: order.takeProfit,
          createdAt: order.createdAt,
          updatedAt: now,
          active: true,
        }))).onConflictDoUpdate({
          target: [mt5PendingOrders.accountId, mt5PendingOrders.brokerTicket],
          set: {
            brokerSymbol: sql`excluded.broker_symbol`,
            orderType: sql`excluded.order_type`,
            side: sql`excluded.side`,
            volume: sql`excluded.volume`,
            price: sql`excluded.price`,
            stopLoss: sql`excluded.stop_loss`,
            takeProfit: sql`excluded.take_profit`,
            createdAt: sql`excluded.created_at`,
            updatedAt: now,
            active: true,
          },
        });
    }

    if (snapshot.deals?.length) {
        await transaction.insert(mt5Deals).values(snapshot.deals.map((deal) => ({
          accountId: account.id,
          brokerTicket: deal.ticket,
          orderTicket: deal.orderTicket,
          positionTicket: deal.positionTicket,
          brokerSymbol: deal.brokerSymbol,
          side: deal.side,
          entry: deal.entry,
          volume: deal.volume,
          price: deal.price,
          profit: deal.profit,
          commission: deal.commission,
          swap: deal.swap,
          comment: deal.comment,
          occurredAt: deal.occurredAt,
          receivedAt: now,
        }))).onConflictDoNothing();
    }

    await transaction.update(mt5Bridges).set({
      status: "online",
      terminalVersion: snapshot.terminalVersion,
      lastHeartbeatAt: now,
      lastError: null,
      updatedAt: now,
    }).where(eq(mt5Bridges.id, bridge.id));
    return account.id;
  });

  return { accountId: result, instrumentCount: snapshot.instruments.length };
}

export async function ingestMt5MarketData(
  bridge: AuthenticatedMt5Bridge,
  batch: Mt5MarketDataBatch,
): Promise<{ ticksAccepted: number; candlesAccepted: number }> {
  const [account] = await db
    .select({ id: mt5Accounts.id })
    .from(mt5Accounts)
    .where(and(
      eq(mt5Accounts.bridgeId, bridge.id),
      eq(mt5Accounts.login, batch.login),
      eq(mt5Accounts.server, batch.server),
    ))
    .limit(1);
  if (!account) throw new Mt5AccountNotFoundError();

  const symbols = [...new Set([
    ...batch.ticks.map((tick) => tick.brokerSymbol),
    ...batch.candles.map((candle) => candle.brokerSymbol),
  ])];
  const instruments = symbols.length
    ? await db
      .select({ id: mt5Instruments.id, brokerSymbol: mt5Instruments.brokerSymbol })
      .from(mt5Instruments)
      .where(and(eq(mt5Instruments.accountId, account.id), inArray(mt5Instruments.brokerSymbol, symbols)))
    : [];
  const instrumentIds = new Map(instruments.map((instrument) => [instrument.brokerSymbol, instrument.id]));
  const missingSymbols = symbols.filter((symbol) => !instrumentIds.has(symbol));
  if (missingSymbols.length) throw new Mt5InstrumentNotFoundError(missingSymbols);
  const instrumentId = (symbol: string) => {
    const id = instrumentIds.get(symbol);
    if (!id) throw new Mt5InstrumentNotFoundError([symbol]);
    return id;
  };

  const receivedAt = new Date();
  await db.transaction(async (transaction) => {
    if (batch.ticks.length) {
      await transaction.insert(mt5MarketTicks).values(batch.ticks.map((tick) => ({
        instrumentId: instrumentId(tick.brokerSymbol),
        sourceTickId: tick.sourceTickId,
        tickTime: tick.tickTime,
        bid: tick.bid,
        ask: tick.ask,
        last: tick.last,
        volume: tick.volume,
        receivedAt,
      }))).onConflictDoNothing();
    }

    if (batch.candles.length) {
      await transaction.insert(mt5MarketCandles).values(batch.candles.map((candle) => ({
        instrumentId: instrumentId(candle.brokerSymbol),
        timeframe: candle.timeframe,
        openTime: candle.openTime,
        closeTime: candle.closeTime,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        tickVolume: candle.tickVolume,
        realVolume: candle.realVolume,
        spreadPoints: candle.spreadPoints,
        isClosed: candle.isClosed,
        receivedAt,
      }))).onConflictDoUpdate({
        target: [mt5MarketCandles.instrumentId, mt5MarketCandles.timeframe, mt5MarketCandles.openTime],
        setWhere: sql`excluded.received_at >= ${mt5MarketCandles.receivedAt}`,
        set: {
          closeTime: sql`excluded.close_time`,
          open: sql`excluded.open`,
          high: sql`excluded.high`,
          low: sql`excluded.low`,
          close: sql`excluded.close`,
          tickVolume: sql`excluded.tick_volume`,
          realVolume: sql`excluded.real_volume`,
          spreadPoints: sql`excluded.spread_points`,
          isClosed: sql`excluded.is_closed`,
          receivedAt: sql`excluded.received_at`,
        },
      });
    }

    await transaction.update(mt5Accounts).set({
      lastSyncAt: receivedAt,
      connected: true,
      updatedAt: receivedAt,
    }).where(eq(mt5Accounts.id, account.id));
    await transaction.update(mt5Bridges).set({
      status: "online",
      lastHeartbeatAt: receivedAt,
      lastError: null,
      updatedAt: receivedAt,
    }).where(eq(mt5Bridges.id, bridge.id));
  });

  return { ticksAccepted: batch.ticks.length, candlesAccepted: batch.candles.length };
}

export async function listMt5Accounts(ownerUserId: string) {
  const rows = await db
    .select({
      id: mt5Accounts.id,
      login: mt5Accounts.login,
      server: mt5Accounts.server,
      broker: mt5Accounts.broker,
      accountType: mt5Accounts.accountType,
      currency: mt5Accounts.currency,
      leverage: mt5Accounts.leverage,
      balance: mt5Accounts.balance,
      equity: mt5Accounts.equity,
      freeMargin: mt5Accounts.freeMargin,
      usedMargin: mt5Accounts.usedMargin,
      marginLevel: mt5Accounts.marginLevel,
      floatingProfit: mt5Accounts.floatingProfit,
      dayStartEquity: mt5Accounts.dayStartEquity,
      dayStartDate: mt5Accounts.dayStartDate,
      peakEquity: mt5Accounts.peakEquity,
      tradingAllowed: mt5Accounts.tradingAllowed,
      expertAllowed: mt5Accounts.expertAllowed,
      connected: mt5Accounts.connected,
      lastSyncAt: mt5Accounts.lastSyncAt,
      bridgeName: mt5Bridges.name,
      bridgeStatus: mt5Bridges.status,
      bridgeLastHeartbeatAt: mt5Bridges.lastHeartbeatAt,
    })
    .from(mt5Accounts)
    .innerJoin(mt5Bridges, eq(mt5Accounts.bridgeId, mt5Bridges.id))
    .where(eq(mt5Accounts.ownerUserId, ownerUserId))
    .orderBy(desc(mt5Accounts.updatedAt));

  const onlineWindow = Date.now() - 60_000;
  return rows.map(({ login, ...account }) => {
    const bridgeIsOnline = account.bridgeStatus === "online" &&
      account.bridgeLastHeartbeatAt !== null &&
      account.bridgeLastHeartbeatAt.getTime() >= onlineWindow;
    return {
      ...account,
      connected: account.connected && bridgeIsOnline,
      bridgeStatus: bridgeIsOnline ? account.bridgeStatus : "offline",
      loginHint: login.length > 4 ? `****${login.slice(-4)}` : "****",
    };
  });
}

export async function listMt5Bridges(ownerUserId: string) {
  const rows = await db.select({
    id: mt5Bridges.id,
    name: mt5Bridges.name,
    status: mt5Bridges.status,
    terminalVersion: mt5Bridges.terminalVersion,
    lastHeartbeatAt: mt5Bridges.lastHeartbeatAt,
    createdAt: mt5Bridges.createdAt,
  }).from(mt5Bridges)
    .where(eq(mt5Bridges.ownerUserId, ownerUserId))
    .orderBy(desc(mt5Bridges.createdAt));
  const onlineWindow = Date.now() - 60_000;
  return rows.map((bridge) => ({
    ...bridge,
    status: bridge.status === "degraded"
      ? "degraded"
      : bridge.status === "online" && bridge.lastHeartbeatAt !== null &&
          bridge.lastHeartbeatAt.getTime() >= onlineWindow
        ? "online"
        : "offline",
  }));
}

export async function listMt5TradingData(ownerUserId: string, accountId: string) {
  const [account] = await db.select({
    id: mt5Accounts.id,
    bridgeId: mt5Accounts.bridgeId,
    login: mt5Accounts.login,
    server: mt5Accounts.server,
    broker: mt5Accounts.broker,
    currency: mt5Accounts.currency,
    accountType: mt5Accounts.accountType,
    leverage: mt5Accounts.leverage,
    balance: mt5Accounts.balance,
    equity: mt5Accounts.equity,
    dayStartEquity: mt5Accounts.dayStartEquity,
    dayStartDate: mt5Accounts.dayStartDate,
    peakEquity: mt5Accounts.peakEquity,
    freeMargin: mt5Accounts.freeMargin,
    usedMargin: mt5Accounts.usedMargin,
    marginLevel: mt5Accounts.marginLevel,
    floatingProfit: mt5Accounts.floatingProfit,
    tradingAllowed: mt5Accounts.tradingAllowed,
    connected: mt5Accounts.connected,
    lastSyncAt: mt5Accounts.lastSyncAt,
    bridgeStatus: mt5Bridges.status,
    bridgeLastHeartbeatAt: mt5Bridges.lastHeartbeatAt,
  }).from(mt5Accounts)
    .innerJoin(mt5Bridges, eq(mt5Accounts.bridgeId, mt5Bridges.id))
    .where(and(eq(mt5Accounts.id, accountId), eq(mt5Accounts.ownerUserId, ownerUserId)))
    .limit(1);
  if (!account) return null;

  const [instruments] = await Promise.all([
    db.select().from(mt5Instruments).where(eq(mt5Instruments.accountId, accountId)).orderBy(mt5Instruments.canonicalSymbol),
  ]);
  const instrumentIds = instruments.map((instrument) => instrument.id);
  const [ticks, positions, pendingOrders, deals, orders] = instrumentIds.length
    ? await Promise.all([
      db.selectDistinctOn([mt5MarketTicks.instrumentId], {
        instrumentId: mt5MarketTicks.instrumentId,
        brokerSymbol: mt5Instruments.brokerSymbol,
        canonicalSymbol: mt5Instruments.canonicalSymbol,
        bid: mt5MarketTicks.bid,
        ask: mt5MarketTicks.ask,
        tickTime: mt5MarketTicks.tickTime,
      }).from(mt5MarketTicks)
        .innerJoin(mt5Instruments, eq(mt5MarketTicks.instrumentId, mt5Instruments.id))
        .where(inArray(mt5MarketTicks.instrumentId, instrumentIds))
        .orderBy(mt5MarketTicks.instrumentId, desc(mt5MarketTicks.tickTime)),
      db.select().from(mt5Positions).where(and(eq(mt5Positions.accountId, accountId), sql`${mt5Positions.closedAt} IS NULL`)),
      db.select().from(mt5PendingOrders).where(and(eq(mt5PendingOrders.accountId, accountId), eq(mt5PendingOrders.active, true))),
      db.select().from(mt5Deals).where(eq(mt5Deals.accountId, accountId)).orderBy(desc(mt5Deals.occurredAt)).limit(100),
      db.select().from(mt5OrderIntents).where(eq(mt5OrderIntents.accountId, accountId)).orderBy(desc(mt5OrderIntents.createdAt)).limit(100),
    ])
    : [[], [], [], [], []];
  const newestTicks = new Map<string, (typeof ticks)[number]>();
  for (const tick of ticks) if (!newestTicks.has(tick.brokerSymbol)) newestTicks.set(tick.brokerSymbol, tick);
  const bridgeIsOnline = account.bridgeStatus === "online" &&
    account.bridgeLastHeartbeatAt !== null &&
    account.bridgeLastHeartbeatAt.getTime() >= Date.now() - 60_000;
  const { login, ...safeAccount } = account;
  return {
    demoExecutionEnabled: demoOrdersEnabled(),
    account: {
      ...safeAccount,
      loginHint: login.length > 4 ? `****${login.slice(-4)}` : "****",
      connected: account.connected && bridgeIsOnline,
      bridgeStatus: bridgeIsOnline ? account.bridgeStatus : "offline",
    },
    instruments: instruments.map((instrument) => ({
      ...instrument,
      quote: newestTicks.get(instrument.brokerSymbol) ?? null,
    })),
    positions,
    pendingOrders,
    deals,
    orders,
  };
}

function requestSnapshot(request: Mt5OrderRequest): Record<string, unknown> {
  return JSON.parse(JSON.stringify(request)) as Record<string, unknown>;
}

function ensureDemoTradingEnabled() {
  if (!demoOrdersEnabled()) {
    throw new Mt5OrderRequestError("MT5 demo trading is disabled by server configuration.", 403);
  }
}

async function assertAccountTradable(ownerUserId: string, accountId: string) {
  const [account] = await db.select({
    account: mt5Accounts,
    bridgeStatus: mt5Bridges.status,
    lastHeartbeatAt: mt5Bridges.lastHeartbeatAt,
  }).from(mt5Accounts)
    .innerJoin(mt5Bridges, eq(mt5Accounts.bridgeId, mt5Bridges.id))
    .where(and(eq(mt5Accounts.id, accountId), eq(mt5Accounts.ownerUserId, ownerUserId)))
    .limit(1);
  if (!account) throw new Mt5OrderRequestError("MT5 account not found.", 404);
  if (account.account.accountType !== "demo") {
    throw new Mt5OrderRequestError("MT5 order execution is restricted to demo accounts.", 403);
  }
  if (!account.account.connected || account.bridgeStatus !== "online" ||
      !isFresh(account.lastHeartbeatAt, 60_000) || !isFresh(account.account.lastSyncAt, 45_000)) {
    throw new Mt5OrderRequestError("MT5 account or bridge is offline or stale.", 409);
  }
  if (!account.account.tradingAllowed) throw new Mt5OrderRequestError("Broker account trading is not permitted.", 403);
  return account.account;
}

async function latestMt5Quote(instrumentId: string) {
  const [quote] = await db.select({
    bid: mt5MarketTicks.bid,
    ask: mt5MarketTicks.ask,
    tickTime: mt5MarketTicks.tickTime,
  }).from(mt5MarketTicks)
    .where(eq(mt5MarketTicks.instrumentId, instrumentId))
    .orderBy(desc(mt5MarketTicks.tickTime))
    .limit(1);
  if (!quote || !isFresh(quote.tickTime, 15_000)) {
    throw new Mt5OrderRequestError("A fresh MT5 quote is required before submitting an order.", 409);
  }
  return quote;
}

function notionalPerLot(price: number, tickValue: number, tickSize: number): number {
  if (
    !Number.isFinite(price)
    || !Number.isFinite(tickValue)
    || !Number.isFinite(tickSize)
    || price <= 0
    || tickValue <= 0
    || tickSize <= 0
  ) return 0;
  return price * tickValue / tickSize;
}

async function getAccountRiskCounts(accountId: string, excludeIntentId?: string) {
  const [positions, pendingOrders, reservations] = await Promise.all([
    db.select({
      volume: mt5Positions.volume,
      price: mt5Positions.currentPrice,
      tickValue: mt5Instruments.tickValue,
      tickSize: mt5Instruments.tickSize,
    }).from(mt5Positions)
      .leftJoin(mt5Instruments, and(
        eq(mt5Instruments.accountId, mt5Positions.accountId),
        eq(mt5Instruments.brokerSymbol, mt5Positions.brokerSymbol),
      ))
      .where(and(eq(mt5Positions.accountId, accountId), sql`${mt5Positions.closedAt} IS NULL`)),
    db.select({
      volume: mt5PendingOrders.volume,
      price: mt5PendingOrders.price,
      tickValue: mt5Instruments.tickValue,
      tickSize: mt5Instruments.tickSize,
    }).from(mt5PendingOrders)
      .leftJoin(mt5Instruments, and(
        eq(mt5Instruments.accountId, mt5PendingOrders.accountId),
        eq(mt5Instruments.brokerSymbol, mt5PendingOrders.brokerSymbol),
      ))
      .where(and(eq(mt5PendingOrders.accountId, accountId), eq(mt5PendingOrders.active, true))),
    db.select({
      volume: mt5OrderIntents.requestedVolume,
      price: mt5OrderIntents.price,
      payload: mt5OrderIntents.payload,
      tickValue: mt5Instruments.tickValue,
      tickSize: mt5Instruments.tickSize,
    }).from(mt5OrderIntents)
      .leftJoin(mt5Instruments, and(
        eq(mt5Instruments.accountId, mt5OrderIntents.accountId),
        eq(mt5Instruments.brokerSymbol, mt5OrderIntents.brokerSymbol),
      ))
      .where(and(
        eq(mt5OrderIntents.accountId, accountId),
        excludeIntentId ? ne(mt5OrderIntents.id, excludeIntentId) : undefined,
        inArray(mt5OrderIntents.status, ["preflight", "validated", "submitted", "partially_filled"]),
        eq(mt5OrderIntents.operation, "place_order"),
      )),
  ]);
  const reservedExposures = reservations.map((row) => {
    const payload = row.payload;
    const entryPrice = row.price ?? payload.requestedEntryPrice ?? payload.approvedPrice;
    return {
      price: entryPrice,
      volume: row.volume,
      tickValue: row.tickValue,
      tickSize: row.tickSize,
    };
  });
  const existingExposure = [...positions, ...pendingOrders, ...reservedExposures].reduce((total, row) => {
    const perLot = notionalPerLot(Number(row.price), Number(row.tickValue), Number(row.tickSize));
    const volume = Number(row.volume);
    if (perLot <= 0 || !Number.isFinite(volume) || volume < 0) return Number.POSITIVE_INFINITY;
    const exposure = perLot * volume;
    return Number.isFinite(exposure) ? total + exposure : Number.POSITIVE_INFINITY;
  }, 0);
  return {
    openPositions: positions.length,
    pendingOrders: pendingOrders.length + reservations.length,
    existingExposure,
  };
}

function assertPendingPrice(
  side: "buy" | "sell",
  orderType: "limit" | "stop",
  price: number,
  bid: number,
  ask: number,
) {
  const valid = orderType === "limit"
    ? side === "buy" ? price < ask : price > bid
    : side === "buy" ? price > ask : price < bid;
  if (!valid) {
    throw new Mt5OrderRequestError("Pending order price is inconsistent with its side, order type, and live quote.", 422);
  }
}

export async function createMt5OrderIntent(ownerUserId: string, request: Mt5OrderRequest) {
  ensureDemoTradingEnabled();
  const operatingState = await getOperatingState();
  const riskConfig = await getRiskConfig(ownerUserId);
  const maxSpread = maxSpreadPoints();
  const account = await assertAccountTradable(ownerUserId, request.accountId);

  const [existing] = await db.select().from(mt5OrderIntents)
    .where(and(
      eq(mt5OrderIntents.accountId, request.accountId),
      eq(mt5OrderIntents.clientOrderId, request.clientOrderId),
    ))
    .limit(1);
  if (existing) {
    if (JSON.stringify(existing.payload.request) !== JSON.stringify(requestSnapshot(request))) {
      throw new Mt5OrderRequestError("clientOrderId was already used for a different order request.", 409);
    }
    return { id: existing.id, status: existing.status, volume: existing.requestedVolume, riskChecks: existing.riskChecks, reused: true };
  }

  const result = await db.transaction(async (transaction) => {
    const [lockedAccount] = await transaction.select().from(mt5Accounts)
      .where(and(eq(mt5Accounts.id, request.accountId), eq(mt5Accounts.ownerUserId, ownerUserId)))
      .for("update")
      .limit(1);
    if (!lockedAccount) throw new Mt5OrderRequestError("MT5 account not found.", 404);
    const [prior] = await transaction.select().from(mt5OrderIntents)
      .where(and(
        eq(mt5OrderIntents.accountId, request.accountId),
        eq(mt5OrderIntents.clientOrderId, request.clientOrderId),
      ))
      .limit(1);
    if (prior) {
      if (JSON.stringify(prior.payload.request) !== JSON.stringify(requestSnapshot(request))) {
        throw new Mt5OrderRequestError("clientOrderId was already used for a different order request.", 409);
      }
      return {
        id: prior.id,
        status: prior.status,
        volume: prior.requestedVolume,
        riskChecks: prior.riskChecks,
        reused: true,
      };
    }
    const [bridge] = await transaction.select().from(mt5Bridges).where(eq(mt5Bridges.id, lockedAccount.bridgeId)).limit(1);
    if (!bridge || bridge.status !== "online" || !isFresh(bridge.lastHeartbeatAt, 60_000)) {
      throw new Mt5OrderRequestError("MT5 bridge is offline.", 409);
    }

    const payload: Record<string, unknown> = { request: requestSnapshot(request) };
    let status: "preflight" | "validated" = "validated";
    let brokerSymbol: string | null = null;
    let side: "buy" | "sell" | null = request.side ?? null;
    let orderType: string | null = request.orderType ?? null;
    let volume: string | null = request.volume ?? null;
    let price: string | null = request.price ?? null;
    let stopLoss: string | null = request.stopLoss ?? null;
    let takeProfit: string | null = request.takeProfit ?? null;
    let riskChecks: RiskCheck[] = [];

    if (request.operation === "place_order") {
      if (operatingState.killSwitch) throw new Mt5OrderRequestError("The global emergency kill switch blocks new MT5 orders.", 423);
      const [instrument] = await transaction.select().from(mt5Instruments)
        .where(and(
          eq(mt5Instruments.accountId, request.accountId),
          eq(mt5Instruments.brokerSymbol, request.brokerSymbol!),
          eq(mt5Instruments.enabled, true),
        ))
        .limit(1);
      if (!instrument) throw new Mt5OrderRequestError("Instrument is not enabled for this MT5 account.", 404);
      const quote = await latestMt5Quote(instrument.id);
      const bid = Number(quote.bid);
      const ask = Number(quote.ask);
      const spreadPoints = (ask - bid) / Number(instrument.point);
      const entryPrice = request.orderType === "market"
        ? request.side === "buy" ? ask : bid
        : Number(request.price);
      if (request.orderType !== "market" && request.price === undefined) {
        throw new Mt5OrderRequestError("Pending orders require an entry price.", 422);
      }
      if (request.orderType !== "market") {
        assertPendingPrice(request.side!, request.orderType!, entryPrice, bid, ask);
      }
      const counts = await getAccountRiskCounts(request.accountId);
      const risk = validateMt5Order(riskConfig, {
        accountType: account.accountType,
        equity: Number(account.equity),
        dayStartEquity: Number(account.dayStartEquity),
        peakEquity: Number(account.peakEquity),
        existingExposure: counts.existingExposure,
        freeMargin: Number(account.freeMargin),
        usedMargin: Number(account.usedMargin),
        openPositions: counts.openPositions,
        pendingOrders: counts.pendingOrders,
        tradingAllowed: account.tradingAllowed,
      }, {
        point: Number(instrument.point),
        tickSize: Number(instrument.tickSize),
        tickValue: Number(instrument.tickValue),
        volumeMin: Number(instrument.volumeMin),
        volumeMax: Number(instrument.volumeMax),
        volumeStep: Number(instrument.volumeStep),
        stopsLevelPoints: instrument.stopsLevelPoints,
      }, {
        side: request.side!,
        price: entryPrice,
        stopLoss: request.stopLoss === null ? null : Number(request.stopLoss),
        takeProfit: request.takeProfit === null ? null : Number(request.takeProfit),
        requestedVolume: request.volume === undefined ? null : Number(request.volume),
        spreadPoints,
        notionalPerLot: notionalPerLot(entryPrice, Number(instrument.tickValue), Number(instrument.tickSize)),
        marginPerLot: null,
        maxSpreadPoints: maxSpread,
        emergencyHalt: operatingState.killSwitch,
        demoOrdersEnabled: demoOrdersEnabled(),
      });
      riskChecks = risk.checks;
      if (!risk.accepted) throw new Mt5OrderRequestError("MT5 order failed risk validation.", 422, risk.checks);
      status = "preflight";
      brokerSymbol = instrument.brokerSymbol;
      volume = String(risk.volume);
      price = request.orderType === "market" ? null : String(entryPrice);
      payload.autoSized = request.volume === undefined;
      payload.resolvedVolume = risk.volume;
      payload.spreadPointsAtRequest = spreadPoints;
      payload.maxSpreadPoints = maxSpread;
      payload.requestedEntryPrice = entryPrice;
    } else {
      if (request.operation === "close_position" || request.operation === "modify_position") {
        const [position] = await transaction.select().from(mt5Positions)
          .where(and(
            eq(mt5Positions.accountId, request.accountId),
            eq(mt5Positions.brokerTicket, request.ticket!),
            sql`${mt5Positions.closedAt} IS NULL`,
          ))
          .limit(1);
        if (!position) throw new Mt5OrderRequestError("Open MT5 position was not found.", 404);
        brokerSymbol = position.brokerSymbol;
        if (request.operation === "close_position") {
          const closeVolume = request.volume === undefined ? Number(position.volume) : Number(request.volume);
          const [instrument] = await transaction.select().from(mt5Instruments)
            .where(and(eq(mt5Instruments.accountId, request.accountId), eq(mt5Instruments.brokerSymbol, position.brokerSymbol)))
            .limit(1);
          if (!instrument || closeVolume > Number(position.volume) ||
              Math.abs(closeVolume / Number(instrument.volumeStep) - Math.round(closeVolume / Number(instrument.volumeStep))) > 1e-8) {
            throw new Mt5OrderRequestError("Close volume exceeds the open position or violates the broker volume step.", 422);
          }
          volume = String(closeVolume);
          side = position.side === "buy" ? "sell" : "buy";
        } else {
          const stop = request.stopLoss === null ? null : Number(request.stopLoss);
          const oldStop = position.stopLoss === null ? null : Number(position.stopLoss);
          const current = Number(position.currentPrice);
          const tightens = stop !== null &&
            (position.side === "buy" ? stop < current && (oldStop === null || stop >= oldStop) : stop > current && (oldStop === null || stop <= oldStop));
          if (!tightens) throw new Mt5OrderRequestError("A position update must set a valid stop-loss and may not loosen existing protection.", 422);
          stopLoss = String(stop);
          takeProfit = request.takeProfit === null ? null : String(request.takeProfit);
        }
      } else {
        const [pending] = await transaction.select().from(mt5PendingOrders)
          .where(and(
            eq(mt5PendingOrders.accountId, request.accountId),
            eq(mt5PendingOrders.brokerTicket, request.ticket!),
            eq(mt5PendingOrders.active, true),
          ))
          .limit(1);
        if (!pending) throw new Mt5OrderRequestError("Active MT5 pending order was not found.", 404);
        brokerSymbol = pending.brokerSymbol;
        side = pending.side === "buy" ? "sell" : "buy";
        volume = pending.volume;
      }
      payload.brokerTicket = request.ticket;
      if (request.operation === "cancel_pending" || request.operation === "close_position") {
        payload.volume = volume;
      }
    }

    const [created] = await transaction.insert(mt5OrderIntents).values({
      accountId: request.accountId,
      bridgeId: lockedAccount.bridgeId,
      ownerUserId,
      clientOrderId: request.clientOrderId,
      operation: request.operation,
      status,
      brokerSymbol,
      side,
      orderType,
      requestedVolume: volume,
      price,
      stopLoss,
      takeProfit,
      riskChecks,
      payload,
      createdAt: new Date(),
      updatedAt: new Date(),
    }).returning({ id: mt5OrderIntents.id, status: mt5OrderIntents.status });
    return { ...created, volume, riskChecks, reused: false };
  });

  await audit(ownerUserId, "mt5.order.requested", `MT5 demo order ${result.id} entered ${result.status}.`);
  return result;
}

export async function getMt5BridgeCommands(bridge: AuthenticatedMt5Bridge) {
  return db.transaction(async (transaction) => {
    const preflight = await transaction.select().from(mt5OrderIntents)
      .where(and(eq(mt5OrderIntents.bridgeId, bridge.id), eq(mt5OrderIntents.status, "preflight")))
      .orderBy(mt5OrderIntents.createdAt)
      .limit(10);
    const queued = await transaction.select().from(mt5OrderIntents)
      .where(and(eq(mt5OrderIntents.bridgeId, bridge.id), eq(mt5OrderIntents.status, "validated")))
      .orderBy(mt5OrderIntents.createdAt)
      .limit(10)
      .for("update", { skipLocked: true });
    const reconcile = await transaction.select().from(mt5OrderIntents)
      .where(and(
        eq(mt5OrderIntents.bridgeId, bridge.id),
        eq(mt5OrderIntents.status, "submitted"),
        lt(mt5OrderIntents.submittedAt, new Date(Date.now() - 60_000)),
      ))
      .orderBy(mt5OrderIntents.submittedAt)
      .limit(10);
    const submittedAt = new Date();
    for (const order of queued) {
      await transaction.update(mt5OrderIntents).set({ status: "submitted", submittedAt, updatedAt: submittedAt })
        .where(and(eq(mt5OrderIntents.id, order.id), eq(mt5OrderIntents.status, "validated")));
    }
    const withAccountIdentity = async (order: typeof preflight[number]) => {
      const [account] = await transaction.select({
        login: mt5Accounts.login,
        server: mt5Accounts.server,
        accountType: mt5Accounts.accountType,
      }).from(mt5Accounts).where(eq(mt5Accounts.id, order.accountId)).limit(1);
      if (!account) throw new Error(`MT5 account ${order.accountId} is missing for order ${order.id}`);
      return {
        id: order.id,
        accountLogin: account.login,
        accountServer: account.server,
        accountType: account.accountType,
        operation: order.operation,
        brokerSymbol: order.brokerSymbol,
        side: order.side,
        orderType: order.orderType,
        volume: order.requestedVolume,
        price: order.price,
        stopLoss: order.stopLoss,
        takeProfit: order.takeProfit,
        payload: order.payload,
      };
    };
    return {
      preflight: await Promise.all(preflight.map(withAccountIdentity)),
      execute: await Promise.all(queued.map(withAccountIdentity)),
      reconcile: await Promise.all(reconcile.map(withAccountIdentity)),
    };
  });
}

export async function validateMt5BridgePreflight(
  bridge: AuthenticatedMt5Bridge,
  result: Mt5PreflightResult,
): Promise<{ status: string; checks: RiskCheck[]; volume: string | null }> {
  ensureDemoTradingEnabled();
  const [intent] = await db.select().from(mt5OrderIntents)
    .where(and(eq(mt5OrderIntents.id, result.intentId), eq(mt5OrderIntents.bridgeId, bridge.id)))
    .limit(1);
  if (!intent) throw new Mt5OrderRequestError("Order intent was not found.", 404);
  if (intent.status !== "preflight") return { status: intent.status, checks: intent.riskChecks, volume: intent.requestedVolume };
  if (intent.operation !== "place_order" || !intent.brokerSymbol || !intent.side || !intent.orderType) {
    throw new Mt5OrderRequestError("Order intent cannot be preflighted.", 409);
  }
  if (
    result.error
    || result.marginPerLot === null
    || result.equity === null
    || result.freeMargin === null
    || result.usedMargin === null
  ) {
    const checks: RiskCheck[] = [{
      name: "Broker margin estimate",
      passed: false,
      detail: result.error ?? "MT5 did not return a margin estimate.",
    }];
    await db.update(mt5OrderIntents).set({
      status: "rejected",
      riskChecks: checks,
      error: checks[0].detail,
      updatedAt: new Date(),
      completedAt: new Date(),
    }).where(and(eq(mt5OrderIntents.id, intent.id), eq(mt5OrderIntents.status, "preflight")));
    return { status: "rejected", checks, volume: intent.requestedVolume };
  }
  const account = await assertAccountTradable(intent.ownerUserId, intent.accountId);
  await db.update(mt5Accounts).set({
    equity: String(result.equity),
    freeMargin: String(result.freeMargin),
    usedMargin: String(result.usedMargin),
    updatedAt: new Date(),
  }).where(eq(mt5Accounts.id, intent.accountId));
  const [instrument] = await db.select().from(mt5Instruments)
    .where(and(eq(mt5Instruments.accountId, intent.accountId), eq(mt5Instruments.brokerSymbol, intent.brokerSymbol)))
    .limit(1);
  if (!instrument) throw new Mt5OrderRequestError("Instrument is no longer available.", 409);
  const quote = await latestMt5Quote(instrument.id);
  const bid = Number(quote.bid);
  const ask = Number(quote.ask);
  const request = intent.payload.request as Mt5OrderRequest;
  const price = request.orderType === "market"
    ? request.side === "buy" ? ask : bid
    : Number(request.price);
  if (request.orderType !== "market") assertPendingPrice(request.side!, request.orderType!, price, bid, ask);
  const counts = await getAccountRiskCounts(intent.accountId, intent.id);
  const operatingState = await getOperatingState();
  const risk = validateMt5Order(await getRiskConfig(intent.ownerUserId), {
    accountType: account.accountType,
    equity: result.equity,
    dayStartEquity: Number(account.dayStartEquity),
    peakEquity: Number(account.peakEquity),
    existingExposure: counts.existingExposure,
    freeMargin: result.freeMargin,
    usedMargin: result.usedMargin,
    openPositions: counts.openPositions,
    pendingOrders: counts.pendingOrders,
    tradingAllowed: account.tradingAllowed,
  }, {
    point: Number(instrument.point),
    tickSize: Number(instrument.tickSize),
    tickValue: Number(instrument.tickValue),
    volumeMin: Number(instrument.volumeMin),
    volumeMax: Number(instrument.volumeMax),
    volumeStep: Number(instrument.volumeStep),
    stopsLevelPoints: instrument.stopsLevelPoints,
  }, {
    side: request.side!,
    price,
    stopLoss: request.stopLoss === null ? null : Number(request.stopLoss),
    takeProfit: request.takeProfit === null ? null : Number(request.takeProfit),
    requestedVolume: request.volume === undefined ? null : Number(request.volume),
    spreadPoints: (ask - bid) / Number(instrument.point),
    notionalPerLot: notionalPerLot(price, Number(instrument.tickValue), Number(instrument.tickSize)),
    marginPerLot: result.marginPerLot,
    maxSpreadPoints: maxSpreadPoints(),
    emergencyHalt: operatingState.killSwitch,
    demoOrdersEnabled: demoOrdersEnabled(),
  });
  const status = risk.accepted ? "validated" : "rejected";
  await db.update(mt5OrderIntents).set({
    status,
    requestedVolume: String(risk.volume),
    price: String(price),
    estimatedMargin: String(risk.estimatedMargin),
    riskChecks: risk.checks,
    error: risk.accepted ? null : "MT5 order failed final risk and margin validation.",
    payload: { ...intent.payload, marginPerLot: result.marginPerLot, approvedPrice: price },
    updatedAt: new Date(),
    completedAt: risk.accepted ? null : new Date(),
  }).where(and(eq(mt5OrderIntents.id, intent.id), eq(mt5OrderIntents.status, "preflight")));
  return { status, checks: risk.checks, volume: String(risk.volume) };
}

export async function recordMt5ExecutionResult(bridge: AuthenticatedMt5Bridge, result: Mt5ExecutionResult) {
  const completed = ["filled", "rejected", "unknown", "cancelled", "closed"].includes(result.status);
  const outcome = await db.transaction(async (transaction) => {
    const [intent] = await transaction.select().from(mt5OrderIntents)
      .where(and(eq(mt5OrderIntents.id, result.intentId), eq(mt5OrderIntents.bridgeId, bridge.id)))
      .for("update")
      .limit(1);
    if (!intent) throw new Mt5OrderRequestError("Order intent was not found.", 404);
    const idempotent = intent.status !== "submitted" &&
      intent.status === result.status &&
      JSON.stringify(intent.brokerResult) === JSON.stringify(result.result);
    if (intent.status !== "submitted" && !idempotent) {
      throw new Mt5OrderRequestError("Order intent is not awaiting an execution result.", 409);
    }

    const now = new Date();
    if (!idempotent) {
      await transaction.update(mt5OrderIntents).set({
        status: result.status,
        filledVolume: result.filledVolume,
        brokerResult: result.result,
        error: result.error,
        updatedAt: now,
        completedAt: completed ? now : null,
      }).where(and(eq(mt5OrderIntents.id, intent.id), eq(mt5OrderIntents.status, "submitted")));
    }
    if (result.deals.length > 0) {
      await transaction.insert(mt5Deals).values(result.deals.map((deal) => ({
        accountId: intent.accountId,
        brokerTicket: deal.ticket,
        orderTicket: deal.orderTicket,
        positionTicket: deal.positionTicket,
        brokerSymbol: deal.brokerSymbol,
        side: deal.side,
        entry: deal.entry,
        volume: deal.volume,
        price: deal.price,
        profit: deal.profit,
        commission: deal.commission,
        swap: deal.swap,
        comment: deal.comment,
        occurredAt: deal.occurredAt,
        receivedAt: now,
      }))).onConflictDoNothing();
    }
    return { ownerUserId: intent.ownerUserId, idempotent };
  });
  if (outcome.idempotent) return { accepted: true, status: result.status, idempotent: true };
  await audit(outcome.ownerUserId, "mt5.order.result", `MT5 demo order ${result.intentId} reported ${result.status}.`, result.status === "rejected" || result.status === "unknown" ? "warn" : "info");
  return { accepted: true, status: result.status, idempotent: false };
}

export async function listMt5OrderHistory(ownerUserId: string, accountId: string) {
  const [account] = await db.select({ id: mt5Accounts.id }).from(mt5Accounts)
    .where(and(eq(mt5Accounts.id, accountId), eq(mt5Accounts.ownerUserId, ownerUserId)))
    .limit(1);
  if (!account) return [];
  return db.select({
    id: mt5OrderIntents.id,
    clientOrderId: mt5OrderIntents.clientOrderId,
    operation: mt5OrderIntents.operation,
    status: mt5OrderIntents.status,
    brokerSymbol: mt5OrderIntents.brokerSymbol,
    side: mt5OrderIntents.side,
    orderType: mt5OrderIntents.orderType,
    requestedVolume: mt5OrderIntents.requestedVolume,
    filledVolume: mt5OrderIntents.filledVolume,
    price: mt5OrderIntents.price,
    stopLoss: mt5OrderIntents.stopLoss,
    takeProfit: mt5OrderIntents.takeProfit,
    estimatedMargin: mt5OrderIntents.estimatedMargin,
    riskChecks: mt5OrderIntents.riskChecks,
    brokerResult: mt5OrderIntents.brokerResult,
    error: mt5OrderIntents.error,
    createdAt: mt5OrderIntents.createdAt,
    updatedAt: mt5OrderIntents.updatedAt,
    submittedAt: mt5OrderIntents.submittedAt,
    completedAt: mt5OrderIntents.completedAt,
  }).from(mt5OrderIntents)
    .where(eq(mt5OrderIntents.accountId, accountId))
    .orderBy(desc(mt5OrderIntents.createdAt))
    .limit(100);
}
