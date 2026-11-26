export type Mt5Deal = {
  ticket: string;
  orderTicket: string | null;
  positionTicket: string | null;
  brokerSymbol: string;
  side: "buy" | "sell";
  entry: "in" | "out" | "inout" | "out_by";
  volume: string;
  price: string;
  profit: string;
  commission: string;
  swap: string;
  comment: string;
  occurredAt: Date;
};

export type Mt5AccountSnapshot = {
  terminalVersion: string;
  account: {
    login: string;
    server: string;
    broker: string;
    accountType: "demo" | "live" | "contest" | "unknown";
    currency: string;
    leverage: number;
    balance: string;
    equity: string;
    freeMargin: string;
    usedMargin: string;
    marginLevel: string | null;
    floatingProfit: string;
    tradingAllowed: boolean;
    expertAllowed: boolean;
  };
  instruments: Array<{
    brokerSymbol: string;
    canonicalSymbol: string;
    assetClass: "forex" | "metal" | "index" | "commodity" | "crypto" | "other";
    description: string;
    baseCurrency: string | null;
    quoteCurrency: string | null;
    digits: number;
    point: string;
    tickSize: string;
    tickValue: string;
    contractSize: string;
    volumeMin: string;
    volumeMax: string;
    volumeStep: string;
    stopsLevelPoints: number;
  }>;
  positions?: Array<{
    ticket: string;
    brokerSymbol: string;
    side: "buy" | "sell";
    volume: string;
    openPrice: string;
    currentPrice: string;
    stopLoss: string | null;
    takeProfit: string | null;
    profit: string;
    swap: string;
    openedAt: Date;
  }>;
  pendingOrders?: Array<{
    ticket: string;
    brokerSymbol: string;
    orderType: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop";
    side: "buy" | "sell";
    volume: string;
    price: string;
    stopLoss: string | null;
    takeProfit: string | null;
    createdAt: Date;
  }>;
  deals?: Mt5Deal[];
};

export type Mt5MarketDataBatch = {
  login: string;
  server: string;
  ticks: Array<{
    brokerSymbol: string;
    sourceTickId: string;
    tickTime: Date;
    bid: string;
    ask: string;
    last: string | null;
    volume: string | null;
  }>;
  candles: Array<{
    brokerSymbol: string;
    timeframe: "M1" | "M5" | "M15" | "M30" | "H1" | "H4" | "D1" | "W1";
    openTime: Date;
    closeTime: Date;
    open: string;
    high: string;
    low: string;
    close: string;
    tickVolume: string;
    realVolume: string;
    spreadPoints: number;
    isClosed: boolean;
  }>;
};

export type Mt5OrderRequest = {
  accountId: string;
  clientOrderId: string;
  operation: "place_order" | "modify_position" | "close_position" | "cancel_pending";
  brokerSymbol?: string;
  side?: "buy" | "sell";
  orderType?: "market" | "limit" | "stop";
  volume?: string;
  price?: string;
  stopLoss?: string | null;
  takeProfit?: string | null;
  ticket?: string;
};

export class Mt5PayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Mt5PayloadError";
  }
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Mt5PayloadError(`${label} must be an object`);
  }
  return value as JsonRecord;
}

function text(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || value.trim() !== value) {
    throw new Mt5PayloadError(`${label} must be a non-empty string of at most ${maxLength} characters`);
  }
  return value;
}

function symbol(value: unknown, label: string, maxLength: number): string {
  const result = text(value, label, maxLength);
  if (!/^[A-Za-z0-9._#-]+$/.test(result)) throw new Mt5PayloadError(`${label} contains unsupported characters`);
  return result;
}

function decimal(value: unknown, label: string, options: { positive?: boolean; nonNegative?: boolean } = {}): string {
  if ((typeof value !== "string" && typeof value !== "number") || !/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(String(value))) {
    throw new Mt5PayloadError(`${label} must be a decimal number`);
  }
  const result = String(value);
  const numericValue = Number(result);
  if (!Number.isFinite(numericValue) ||
      (options.positive && numericValue <= 0) ||
      (options.nonNegative && numericValue < 0)) {
    throw new Mt5PayloadError(`${label} is outside its permitted range`);
  }
  return result;
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  const result = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > maximum) {
    throw new Mt5PayloadError(`${label} must be a non-negative integer no greater than ${maximum}`);
  }
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Mt5PayloadError(`${label} must be a boolean`);
  return value;
}

function timestamp(value: unknown, label: string): Date {
  const milliseconds = integer(value, label, 8_640_000_000_000_000);
  const result = new Date(milliseconds);
  if (!Number.isFinite(result.getTime())) throw new Mt5PayloadError(`${label} is not a valid timestamp`);
  return result;
}

function nullableText(value: unknown, label: string, maxLength: number): string | null {
  if (value === null || value === undefined || value === "") return null;
  return text(value, label, maxLength);
}

function nullableDecimal(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === 0 || value === "0" || value === "0.0") return null;
  return decimal(value, label, { positive: true });
}

function digits(value: unknown, label: string, maxLength: number): string {
  const result = text(String(value ?? ""), label, maxLength);
  if (!/^\d+$/.test(result)) throw new Mt5PayloadError(`${label} must contain digits only`);
  return result;
}

function parseSnapshotArray<T>(
  value: unknown,
  label: string,
  maximum: number,
  parse: (item: unknown, index: number) => T,
): T[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > maximum) {
    throw new Mt5PayloadError(`${label} must be an array containing at most ${maximum} entries`);
  }
  return value.map(parse);
}

function parseMt5Deal(value: unknown, index: number, collection: string): Mt5Deal {
  const label = `${collection}[${index}]`;
  const item = record(value, label);
  const entries = new Set(["in", "out", "inout", "out_by"]);
  if (item.side !== "buy" && item.side !== "sell") throw new Mt5PayloadError(`${label}.side is invalid`);
  if (typeof item.entry !== "string" || !entries.has(item.entry)) throw new Mt5PayloadError(`${label}.entry is invalid`);
  return {
    ticket: digits(item.ticket, `${label}.ticket`, 32),
    orderTicket: item.orderTicket === null || item.orderTicket === undefined ? null : digits(item.orderTicket, `${label}.orderTicket`, 32),
    positionTicket: item.positionTicket === null || item.positionTicket === undefined ? null : digits(item.positionTicket, `${label}.positionTicket`, 32),
    brokerSymbol: symbol(item.brokerSymbol, `${label}.brokerSymbol`, 64),
    side: item.side,
    entry: item.entry as Mt5Deal["entry"],
    volume: decimal(item.volume, `${label}.volume`, { nonNegative: true }),
    price: decimal(item.price, `${label}.price`, { positive: true }),
    profit: decimal(item.profit, `${label}.profit`),
    commission: decimal(item.commission, `${label}.commission`),
    swap: decimal(item.swap, `${label}.swap`),
    comment: typeof item.comment === "string" ? item.comment.slice(0, 256) : "",
    occurredAt: timestamp(item.timeMs, `${label}.timeMs`),
  };
}

const ASSET_CLASSES = new Set(["forex", "metal", "index", "commodity", "crypto", "other"]);
const TIMEFRAMES = new Set(["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1"]);
const MT5_ORDER_OPERATIONS = new Set(["place_order", "modify_position", "close_position", "cancel_pending"]);

export function parseMt5OrderRequest(value: unknown): Mt5OrderRequest {
  const body = record(value, "order");
  if (typeof body.accountId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.accountId)) {
    throw new Mt5PayloadError("accountId must be a UUID");
  }
  if (typeof body.clientOrderId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientOrderId)) {
    throw new Mt5PayloadError("clientOrderId must be a UUID idempotency key");
  }
  if (typeof body.operation !== "string" || !MT5_ORDER_OPERATIONS.has(body.operation)) {
    throw new Mt5PayloadError("operation is not supported");
  }
  const operation = body.operation as Mt5OrderRequest["operation"];
  if (operation === "place_order") {
    if (body.side !== "buy" && body.side !== "sell") throw new Mt5PayloadError("side must be buy or sell");
    if (body.orderType !== "market" && body.orderType !== "limit" && body.orderType !== "stop") {
      throw new Mt5PayloadError("orderType must be market, limit, or stop");
    }
    return {
      accountId: body.accountId,
      clientOrderId: body.clientOrderId,
      operation,
      brokerSymbol: symbol(body.brokerSymbol, "brokerSymbol", 64),
      side: body.side,
      orderType: body.orderType,
      volume: body.volume === undefined || body.volume === null
        ? undefined
        : decimal(body.volume, "volume", { positive: true }),
      price: body.price === undefined || body.price === null
        ? undefined
        : decimal(body.price, "price", { positive: true }),
      stopLoss: body.stopLoss === undefined || body.stopLoss === null
        ? null
        : decimal(body.stopLoss, "stopLoss", { positive: true }),
      takeProfit: body.takeProfit === undefined || body.takeProfit === null
        ? null
        : decimal(body.takeProfit, "takeProfit", { positive: true }),
    };
  }
  const ticket = text(String(body.ticket ?? ""), "ticket", 32);
  if (!/^\d+$/.test(ticket)) throw new Mt5PayloadError("ticket must contain digits only");
  if (operation === "close_position") {
    return {
      accountId: body.accountId,
      clientOrderId: body.clientOrderId,
      operation,
      ticket,
      volume: body.volume === undefined || body.volume === null
        ? undefined
        : decimal(body.volume, "volume", { positive: true }),
    };
  }
  if (operation === "cancel_pending") return { accountId: body.accountId, clientOrderId: body.clientOrderId, operation, ticket };
  if ((body.stopLoss !== null && body.stopLoss !== undefined && typeof body.stopLoss !== "string") ||
      (body.takeProfit !== null && body.takeProfit !== undefined && typeof body.takeProfit !== "string")) {
    throw new Mt5PayloadError("stopLoss and takeProfit must be decimal strings or null");
  }
  return {
    accountId: body.accountId,
    clientOrderId: body.clientOrderId,
    operation,
    ticket,
    stopLoss: body.stopLoss === undefined ? null : decimal(body.stopLoss, "stopLoss", { positive: true }),
    takeProfit: body.takeProfit === undefined ? null : decimal(body.takeProfit, "takeProfit", { positive: true }),
  };
}

export type Mt5PreflightResult = {
  intentId: string;
  marginPerLot: number | null;
  equity: number | null;
  freeMargin: number | null;
  usedMargin: number | null;
  error: string | null;
};

export function parseMt5PreflightResult(value: unknown): Mt5PreflightResult {
  const body = record(value, "preflight");
  const intentId = text(body.intentId, "intentId", 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(intentId)) {
    throw new Mt5PayloadError("intentId must be a UUID");
  }
  const error = body.error === null || body.error === undefined ? null : text(body.error, "error", 512);
  return {
    intentId,
    marginPerLot: error === null ? Number(decimal(body.marginPerLot, "marginPerLot", { positive: true })) : null,
    equity: error === null ? Number(decimal(body.equity, "equity", { positive: true })) : null,
    freeMargin: error === null ? Number(decimal(body.freeMargin, "freeMargin", { nonNegative: true })) : null,
    usedMargin: error === null ? Number(decimal(body.usedMargin, "usedMargin", { nonNegative: true })) : null,
    error,
  };
}

export type Mt5ExecutionResult = {
  intentId: string;
  status: "accepted" | "partially_filled" | "filled" | "rejected" | "unknown" | "cancelled" | "closed";
  filledVolume: string;
  result: Record<string, unknown>;
  deals: Mt5Deal[];
  error: string | null;
};

export function parseMt5ExecutionResult(value: unknown): Mt5ExecutionResult {
  const body = record(value, "execution result");
  const statuses = new Set(["accepted", "partially_filled", "filled", "rejected", "unknown", "cancelled", "closed"]);
  if (typeof body.status !== "string" || !statuses.has(body.status)) {
    throw new Mt5PayloadError("execution result status is invalid");
  }
  return {
    intentId: text(body.intentId, "intentId", 36),
    status: body.status as "accepted" | "partially_filled" | "filled" | "rejected" | "unknown" | "cancelled" | "closed",
    filledVolume: decimal(body.filledVolume ?? 0, "filledVolume", { nonNegative: true }),
    result: record(body.result ?? {}, "result"),
    deals: parseSnapshotArray(body.deals, "deals", 100, (item, index) => parseMt5Deal(item, index, "deals")) ?? [],
    error: body.error === null || body.error === undefined ? null : text(body.error, "error", 512),
  };
}

export function parseMt5AccountSnapshot(value: unknown): Mt5AccountSnapshot {
  const body = record(value, "snapshot");
  const account = record(body.account, "account");
  if (!Array.isArray(body.instruments) || body.instruments.length > 2000) {
    throw new Mt5PayloadError("instruments must be an array containing at most 2000 entries");
  }

  const accountType = account.accountType;
  if (accountType !== "demo" && accountType !== "live" && accountType !== "contest" && accountType !== "unknown") {
    throw new Mt5PayloadError("account.accountType is invalid");
  }

  const instrumentSymbols = new Set<string>();
  const instruments = body.instruments.map((value, index) => {
    const item = record(value, `instruments[${index}]`);
    const assetClass = item.assetClass;
    if (typeof assetClass !== "string" || !ASSET_CLASSES.has(assetClass)) {
      throw new Mt5PayloadError(`instruments[${index}].assetClass is invalid`);
    }
    const volumeMin = decimal(item.volumeMin, `instruments[${index}].volumeMin`, { positive: true });
    const volumeMax = decimal(item.volumeMax, `instruments[${index}].volumeMax`, { positive: true });
    const volumeStep = decimal(item.volumeStep, `instruments[${index}].volumeStep`, { positive: true });
    if (Number(volumeMax) < Number(volumeMin)) {
      throw new Mt5PayloadError(`instruments[${index}].volumeMax must be at least volumeMin`);
    }
    const brokerSymbol = symbol(item.brokerSymbol, `instruments[${index}].brokerSymbol`, 64);
    if (instrumentSymbols.has(brokerSymbol)) {
      throw new Mt5PayloadError(`instruments contains duplicate broker symbol ${brokerSymbol}`);
    }
    instrumentSymbols.add(brokerSymbol);
    return {
      brokerSymbol,
      canonicalSymbol: symbol(item.canonicalSymbol, `instruments[${index}].canonicalSymbol`, 32).toUpperCase(),
      assetClass: assetClass as Mt5AccountSnapshot["instruments"][number]["assetClass"],
      description: typeof item.description === "string" ? item.description.slice(0, 256) : "",
      baseCurrency: nullableText(item.baseCurrency, `instruments[${index}].baseCurrency`, 12),
      quoteCurrency: nullableText(item.quoteCurrency, `instruments[${index}].quoteCurrency`, 12),
      digits: integer(item.digits, `instruments[${index}].digits`, 12),
      point: decimal(item.point, `instruments[${index}].point`, { positive: true }),
      tickSize: decimal(item.tickSize, `instruments[${index}].tickSize`, { positive: true }),
      tickValue: decimal(item.tickValue, `instruments[${index}].tickValue`, { nonNegative: true }),
      contractSize: decimal(item.contractSize, `instruments[${index}].contractSize`, { positive: true }),
      volumeMin,
      volumeMax,
      volumeStep,
      stopsLevelPoints: integer(item.stopsLevelPoints, `instruments[${index}].stopsLevelPoints`),
    };
  });

  const positions = parseSnapshotArray(body.positions, "positions", 2000, (value, index) => {
    const item = record(value, `positions[${index}]`);
    if (item.side !== "buy" && item.side !== "sell") throw new Mt5PayloadError(`positions[${index}].side is invalid`);
    return {
      ticket: digits(item.ticket, `positions[${index}].ticket`, 32),
      brokerSymbol: symbol(item.brokerSymbol, `positions[${index}].brokerSymbol`, 64),
      side: item.side as "buy" | "sell",
      volume: decimal(item.volume, `positions[${index}].volume`, { positive: true }),
      openPrice: decimal(item.openPrice, `positions[${index}].openPrice`, { positive: true }),
      currentPrice: decimal(item.currentPrice, `positions[${index}].currentPrice`, { positive: true }),
      stopLoss: nullableDecimal(item.stopLoss, `positions[${index}].stopLoss`),
      takeProfit: nullableDecimal(item.takeProfit, `positions[${index}].takeProfit`),
      profit: decimal(item.profit, `positions[${index}].profit`),
      swap: decimal(item.swap, `positions[${index}].swap`),
      openedAt: timestamp(item.openedAtMs, `positions[${index}].openedAtMs`),
    };
  });
  const pendingOrderTypes = new Set(["buy_limit", "sell_limit", "buy_stop", "sell_stop"]);
  const pendingOrders = parseSnapshotArray(body.pendingOrders, "pendingOrders", 2000, (value, index) => {
    const item = record(value, `pendingOrders[${index}]`);
    if (typeof item.orderType !== "string" || !pendingOrderTypes.has(item.orderType)) {
      throw new Mt5PayloadError(`pendingOrders[${index}].orderType is invalid`);
    }
    if (item.side !== "buy" && item.side !== "sell") throw new Mt5PayloadError(`pendingOrders[${index}].side is invalid`);
    return {
      ticket: digits(item.ticket, `pendingOrders[${index}].ticket`, 32),
      brokerSymbol: symbol(item.brokerSymbol, `pendingOrders[${index}].brokerSymbol`, 64),
      orderType: item.orderType as "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop",
      side: item.side as "buy" | "sell",
      volume: decimal(item.volume, `pendingOrders[${index}].volume`, { positive: true }),
      price: decimal(item.price, `pendingOrders[${index}].price`, { positive: true }),
      stopLoss: nullableDecimal(item.stopLoss, `pendingOrders[${index}].stopLoss`),
      takeProfit: nullableDecimal(item.takeProfit, `pendingOrders[${index}].takeProfit`),
      createdAt: timestamp(item.createdAtMs, `pendingOrders[${index}].createdAtMs`),
    };
  });
  const deals = parseSnapshotArray(body.deals, "deals", 5000, (value, index) => parseMt5Deal(value, index, "deals"));

  const login = text(String(account.login ?? ""), "account.login", 32);
  if (!/^\d+$/.test(login)) throw new Mt5PayloadError("account.login must contain digits only");
  const leverage = integer(account.leverage, "account.leverage", 1_000_000);
  return {
    terminalVersion: typeof body.terminalVersion === "string" ? body.terminalVersion.slice(0, 128) : "",
    account: {
      login,
      server: text(account.server, "account.server", 255),
      broker: typeof account.broker === "string" ? account.broker.slice(0, 255) : "",
      accountType,
      currency: text(account.currency, "account.currency", 12),
      leverage,
      balance: decimal(account.balance, "account.balance"),
      equity: decimal(account.equity, "account.equity"),
      freeMargin: decimal(account.freeMargin, "account.freeMargin"),
      usedMargin: decimal(account.usedMargin, "account.usedMargin", { nonNegative: true }),
      marginLevel: account.marginLevel === null || account.marginLevel === undefined
        ? null
        : decimal(account.marginLevel, "account.marginLevel", { nonNegative: true }),
      floatingProfit: decimal(account.floatingProfit, "account.floatingProfit"),
      tradingAllowed: boolean(account.tradingAllowed, "account.tradingAllowed"),
      expertAllowed: boolean(account.expertAllowed, "account.expertAllowed"),
    },
    instruments,
    positions,
    pendingOrders,
    deals,
  };
}

export function parseMt5MarketDataBatch(value: unknown): Mt5MarketDataBatch {
  const body = record(value, "market data");
  if (!Array.isArray(body.ticks) || body.ticks.length > 20_000) {
    throw new Mt5PayloadError("ticks must be an array containing at most 20000 entries");
  }
  if (!Array.isArray(body.candles) || body.candles.length > 10_000) {
    throw new Mt5PayloadError("candles must be an array containing at most 10000 entries");
  }
  const maximumFutureTimestampMs = Date.now() + 5_000;

  const tickIds = new Set<string>();
  const ticks = body.ticks.map((value, index) => {
    const tick = record(value, `ticks[${index}]`);
    const brokerSymbol = symbol(tick.brokerSymbol, `ticks[${index}].brokerSymbol`, 64);
    const sourceTickId = text(tick.sourceTickId, `ticks[${index}].sourceTickId`, 180);
    const uniqueId = `${brokerSymbol}:${sourceTickId}`;
    if (tickIds.has(uniqueId)) throw new Mt5PayloadError(`ticks contains duplicate source ID ${sourceTickId}`);
    tickIds.add(uniqueId);
    const bid = decimal(tick.bid, `ticks[${index}].bid`, { positive: true });
    const ask = decimal(tick.ask, `ticks[${index}].ask`, { positive: true });
    if (Number(bid) > Number(ask)) throw new Mt5PayloadError(`ticks[${index}] has a crossed bid/ask`);
    const tickTime = timestamp(tick.timeMs, `ticks[${index}].timeMs`);
    if (tickTime.getTime() > maximumFutureTimestampMs) {
      throw new Mt5PayloadError(`ticks[${index}].timeMs is too far in the future`);
    }
    return {
      brokerSymbol,
      sourceTickId,
      tickTime,
      bid,
      ask,
      last: tick.last === null || tick.last === undefined || Number(tick.last) === 0
        ? null
        : decimal(tick.last, `ticks[${index}].last`, { positive: true }),
      volume: tick.volume === null || tick.volume === undefined
        ? null
        : decimal(tick.volume, `ticks[${index}].volume`, { nonNegative: true }),
    };
  });

  const candleKeys = new Set<string>();
  const candles = body.candles.map((value, index) => {
    const candle = record(value, `candles[${index}]`);
    const timeframe = candle.timeframe;
    if (typeof timeframe !== "string" || !TIMEFRAMES.has(timeframe)) {
      throw new Mt5PayloadError(`candles[${index}].timeframe is invalid`);
    }
    const open = decimal(candle.open, `candles[${index}].open`, { positive: true });
    const high = decimal(candle.high, `candles[${index}].high`, { positive: true });
    const low = decimal(candle.low, `candles[${index}].low`, { positive: true });
    const close = decimal(candle.close, `candles[${index}].close`, { positive: true });
    if (Number(low) > Math.min(Number(open), Number(close)) ||
        Number(high) < Math.max(Number(open), Number(close)) ||
        Number(high) < Number(low)) {
      throw new Mt5PayloadError(`candles[${index}] has inconsistent OHLC values`);
    }
    const openTime = timestamp(candle.openTimeMs, `candles[${index}].openTimeMs`);
    const closeTime = timestamp(candle.closeTimeMs, `candles[${index}].closeTimeMs`);
    if (openTime.getTime() > maximumFutureTimestampMs) {
      throw new Mt5PayloadError(`candles[${index}].openTimeMs is too far in the future`);
    }
    if (closeTime < openTime) throw new Mt5PayloadError(`candles[${index}] closes before it opens`);
    const brokerSymbol = symbol(candle.brokerSymbol, `candles[${index}].brokerSymbol`, 64);
    const candleKey = `${brokerSymbol}:${timeframe}:${openTime.getTime()}`;
    if (candleKeys.has(candleKey)) throw new Mt5PayloadError(`candles contains duplicate ${timeframe} open time`);
    candleKeys.add(candleKey);
    return {
      brokerSymbol,
      timeframe: timeframe as Mt5MarketDataBatch["candles"][number]["timeframe"],
      openTime,
      closeTime,
      open,
      high,
      low,
      close,
      tickVolume: decimal(candle.tickVolume, `candles[${index}].tickVolume`, { nonNegative: true }),
      realVolume: decimal(candle.realVolume, `candles[${index}].realVolume`, { nonNegative: true }),
      spreadPoints: integer(candle.spreadPoints, `candles[${index}].spreadPoints`),
      isClosed: boolean(candle.isClosed, `candles[${index}].isClosed`),
    };
  });

  return {
    login: text(String(body.login ?? ""), "login", 32),
    server: text(body.server, "server", 255),
    ticks,
    candles,
  };
}
