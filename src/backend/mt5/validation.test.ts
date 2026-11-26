import assert from "node:assert/strict";
import test from "node:test";
import {
  Mt5PayloadError,
  parseMt5AccountSnapshot,
  parseMt5ExecutionResult,
  parseMt5MarketDataBatch,
  parseMt5OrderRequest,
  parseMt5PreflightResult,
} from "./validation";

const ACCOUNT_SNAPSHOT = {
  terminalVersion: "5.0.0",
  account: {
    login: "12345678",
    server: "Demo-Server",
    broker: "Demo Broker",
    accountType: "demo",
    currency: "USD",
    leverage: 100,
    balance: 10000,
    equity: 10025,
    freeMargin: 9500,
    usedMargin: 500,
    marginLevel: 2005,
    floatingProfit: 25,
    tradingAllowed: true,
    expertAllowed: true,
  },
  instruments: [{
    brokerSymbol: "EURUSD.a",
    canonicalSymbol: "EURUSD",
    assetClass: "forex",
    description: "Euro vs US Dollar",
    baseCurrency: "EUR",
    quoteCurrency: "USD",
    digits: 5,
    point: 0.00001,
    tickSize: 0.00001,
    tickValue: 1,
    contractSize: 100000,
    volumeMin: 0.01,
    volumeMax: 100,
    volumeStep: 0.01,
    stopsLevelPoints: 10,
  }],
};

test("account snapshots preserve broker-specific symbols and account permissions", () => {
  const result = parseMt5AccountSnapshot(ACCOUNT_SNAPSHOT);
  assert.equal(result.account.accountType, "demo");
  assert.equal(result.account.tradingAllowed, true);
  assert.equal(result.instruments[0].brokerSymbol, "EURUSD.a");
  assert.equal(result.instruments[0].canonicalSymbol, "EURUSD");
  assert.equal(result.instruments[0].tickSize, "0.00001");
  assert.equal(result.positions, undefined);
});

test("account snapshots reject invalid contract and lot metadata", () => {
  const invalid = structuredClone(ACCOUNT_SNAPSHOT);
  invalid.instruments[0].volumeMax = 0.001;
  assert.throws(() => parseMt5AccountSnapshot(invalid), Mt5PayloadError);
});

test("market data accepts MT5 timeframes and validates quote and candle integrity", () => {
  const batch = parseMt5MarketDataBatch({
    login: "12345678",
    server: "Demo-Server",
    ticks: [{
      brokerSymbol: "EURUSD.a",
      sourceTickId: "1795700000000:1.08001:1.08003",
      timeMs: 1_795_700_000_000,
      bid: 1.08001,
      ask: 1.08003,
      last: null,
      volume: 0,
    }],
    candles: [{
      brokerSymbol: "EURUSD.a",
      timeframe: "M30",
      openTimeMs: 1_795_699_000_000,
      closeTimeMs: 1_795_700_800_000,
      open: 1.08,
      high: 1.081,
      low: 1.079,
      close: 1.0805,
      tickVolume: 50,
      realVolume: 0,
      spreadPoints: 2,
      isClosed: true,
    }],
  });
  assert.equal(batch.ticks[0].bid, "1.08001");
  assert.equal(batch.candles[0].timeframe, "M30");
  assert.equal(batch.candles[0].isClosed, true);
});

test("market data rejects crossed quotes, inconsistent OHLC and unsupported timeframes", () => {
  const input = {
    login: "12345678",
    server: "Demo-Server",
    ticks: [{
      brokerSymbol: "EURUSD.a",
      sourceTickId: "1",
      timeMs: 1_795_700_000_000,
      bid: 1.1,
      ask: 1.09,
      last: null,
      volume: 0,
    }],
    candles: [],
  };
  assert.throws(() => parseMt5MarketDataBatch(input), Mt5PayloadError);
  const invalidTimeframe: unknown = {
    login: "12345678",
    server: "Demo-Server",
    ticks: [],
    candles: [{
      brokerSymbol: "EURUSD.a",
      timeframe: "M2",
      openTimeMs: 1_795_699_000_000,
      closeTimeMs: 1_795_700_800_000,
      open: 1.08,
      high: 1.081,
      low: 1.07,
      close: 1.08,
      tickVolume: 1,
      realVolume: 0,
      spreadPoints: 1,
      isClosed: true,
    }],
  };
  assert.throws(() => parseMt5MarketDataBatch(invalidTimeframe), Mt5PayloadError);

  const invalidOhlc = {
    login: "12345678",
    server: "Demo-Server",
    ticks: [],
    candles: [{
      brokerSymbol: "EURUSD.a",
      timeframe: "M1",
      openTimeMs: 1_795_699_000_000,
      closeTimeMs: 1_795_699_059_999,
      open: 1.08,
      high: 1.079,
      low: 1.07,
      close: 1.081,
      tickVolume: 1,
      realVolume: 0,
      spreadPoints: 1,
      isClosed: true,
    }],
  };
  assert.throws(() => parseMt5MarketDataBatch(invalidOhlc), Mt5PayloadError);
});

test("market data rejects timestamps materially ahead of UTC", () => {
  const futureTimeMs = Date.now() + 60_000;
  assert.throws(() => parseMt5MarketDataBatch({
    login: "12345678",
    server: "Demo-Server",
    ticks: [{
      brokerSymbol: "EURUSD",
      sourceTickId: "future-tick",
      timeMs: futureTimeMs,
      bid: 1.08,
      ask: 1.0801,
      last: null,
      volume: 0,
    }],
    candles: [],
  }), Mt5PayloadError);

  assert.throws(() => parseMt5MarketDataBatch({
    login: "12345678",
    server: "Demo-Server",
    ticks: [],
    candles: [{
      brokerSymbol: "EURUSD",
      timeframe: "M1",
      openTimeMs: futureTimeMs,
      closeTimeMs: futureTimeMs + 59_999,
      open: 1.08,
      high: 1.081,
      low: 1.079,
      close: 1.0805,
      tickVolume: 1,
      realVolume: 0,
      spreadPoints: 1,
      isClosed: false,
    }],
  }), Mt5PayloadError);
});

test("MT5 order requests require idempotency keys and broker-safe parameters", () => {
  const request = parseMt5OrderRequest({
    accountId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    clientOrderId: "33951cab-50ec-4c7f-9f2d-c06d71e522a7",
    operation: "place_order",
    brokerSymbol: "EURUSD.a",
    side: "buy",
    orderType: "market",
    volume: "0.1",
    stopLoss: "1.09",
    takeProfit: "1.12",
  });
  assert.equal(request.operation, "place_order");
  assert.equal(request.volume, "0.1");
  assert.throws(() => parseMt5OrderRequest({ ...request, clientOrderId: "same-order" }), Mt5PayloadError);
  assert.throws(() => parseMt5OrderRequest({ ...request, orderType: "iceberg" }), Mt5PayloadError);
});

test("bridge preflight and execution results reject malformed identifiers and statuses", () => {
  assert.deepEqual(parseMt5PreflightResult({
    intentId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    marginPerLot: 1200,
    equity: 10000,
    freeMargin: 9000,
    usedMargin: 1000,
  }), {
    intentId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    marginPerLot: 1200,
    equity: 10000,
    freeMargin: 9000,
    usedMargin: 1000,
    error: null,
  });
  assert.throws(() => parseMt5PreflightResult({
    intentId: "not-an-id",
    error: "margin calculation unavailable",
  }), Mt5PayloadError);
  const execution = parseMt5ExecutionResult({
    intentId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    status: "closed",
    filledVolume: "0.02",
    result: { retcode: 10009 },
    deals: [{
      ticket: "12345",
      orderTicket: "67890",
      positionTicket: "54321",
      brokerSymbol: "EURUSD.a",
      side: "sell",
      entry: "out",
      volume: "0.02",
      price: "1.09704",
      profit: "0.04",
      commission: "0",
      swap: "0",
      comment: "AXYL",
      timeMs: 1_795_700_000_000,
    }],
  });
  assert.equal(execution.deals[0].ticket, "12345");
  assert.equal(execution.deals[0].entry, "out");
  assert.equal(execution.deals[0].price, "1.09704");
  assert.throws(() => parseMt5ExecutionResult({
    intentId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    status: "done",
    filledVolume: "0",
    result: {},
  }), Mt5PayloadError);
  assert.throws(() => parseMt5ExecutionResult({
    intentId: "0ec16d79-87dc-49bf-9480-8d679f53b4ba",
    status: "closed",
    result: {},
    deals: [{ ticket: "not-digits" }],
  }), Mt5PayloadError);
});
