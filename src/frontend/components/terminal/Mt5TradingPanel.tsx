"use client";

import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";

type Account = {
  id: string;
  server: string;
  broker: string;
  accountType: string;
  currency: string;
  leverage: number;
  balance: string;
  equity: string;
  freeMargin: string;
  usedMargin: string;
  marginLevel: string | null;
  floatingProfit: string;
  tradingAllowed: boolean;
  connected: boolean;
  bridgeStatus: string;
  lastSyncAt: string | null;
  loginHint: string;
};
type Instrument = {
  brokerSymbol: string;
  canonicalSymbol: string;
  assetClass: string;
  quoteCurrency: string | null;
  digits: number;
  tickSize: string;
  tickValue: string;
  volumeMin: string;
  volumeStep: string;
  quote: { bid: string; ask: string; tickTime: string } | null;
};
type Position = {
  brokerTicket: string;
  brokerSymbol: string;
  side: "buy" | "sell";
  volume: string;
  openPrice: string;
  currentPrice: string;
  profit: string;
  stopLoss: string | null;
  takeProfit: string | null;
};
type PendingOrder = {
  brokerTicket: string;
  brokerSymbol: string;
  orderType: string;
  side: "buy" | "sell";
  volume: string;
  price: string;
};
type HistoryOrder = {
  id: string;
  operation: string;
  brokerSymbol: string | null;
  side: string | null;
  status: string;
  requestedVolume: string | null;
  filledVolume: string | null;
  price: string | null;
  brokerResult: {
    dealTicket?: string;
    dealTickets?: string[];
    orderTicket?: string;
    price?: string;
    volume?: string;
    retcode?: number;
  } | null;
  error: string | null;
  createdAt: string;
};
type Deal = {
  ticket: string;
  brokerSymbol: string;
  side: "buy" | "sell";
  entry: "in" | "out" | "inout" | "out_by";
  volume: string;
  price: string;
  profit: string;
  commission: string;
  swap: string;
  occurredAt: string;
};
type OrderDraft = {
  accountId: string;
  clientOrderId: string;
  brokerSymbol: string;
  canonicalSymbol: string;
  side: "buy" | "sell";
  orderType: "market" | "limit" | "stop";
  volume: string;
  entryPrice: string;
  referencePrice: string;
  quoteTime: string;
  stopLoss: string;
  takeProfit: string;
};
type TradingData = {
  demoExecutionEnabled: boolean;
  account: Account;
  instruments: Instrument[];
  positions: Position[];
  pendingOrders: PendingOrder[];
  deals: Deal[];
  orders: HistoryOrder[];
};
type ApiError = { error?: string; checks?: Array<{ name: string; passed: boolean; detail: string }> };

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  let body: T & ApiError;
  try {
    body = await response.json() as T & ApiError;
  } catch {
    throw new Error(`The server returned an unreadable response (${response.status}).`);
  }
  if (!response.ok) {
    const checks = body.checks?.filter((check) => !check.passed).map((check) => check.detail).join(" ");
    throw new Error([body.error ?? `Request failed (${response.status})`, checks].filter(Boolean).join(" "));
  }
  return body;
}

function amount(value: string | number | null | undefined, currency: string, digits = 2) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })} ${currency}` : "—";
}

function price(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 5 }) : "—";
}

function quantity(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 4 }) : "—";
}

function timestamp(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function isFreshQuote(quote: Instrument["quote"]): boolean {
  if (!quote) return false;
  const tickTime = new Date(quote.tickTime).getTime();
  const ageMs = Date.now() - tickTime;
  return Number.isFinite(tickTime) && ageMs <= 15_000 && ageMs >= -5_000;
}

function priceDistance(value: string, level: string, instrument: Instrument) {
  const distance = Math.abs(Number(value) - Number(level));
  if (!Number.isFinite(distance)) return "—";
  if (instrument.assetClass === "forex") {
    const pipSize = instrument.quoteCurrency === "JPY" ? 0.01 : 0.0001;
    return `${(distance / pipSize).toFixed(1)} pips`;
  }
  return `${price(distance)} price units`;
}

function estimatedMove(value: string, level: string, volume: string, instrument: Instrument) {
  const tickSize = Number(instrument.tickSize);
  const tickValue = Number(instrument.tickValue);
  const lots = Number(volume);
  const distance = Math.abs(Number(value) - Number(level));
  if (![tickSize, tickValue, lots, distance].every(Number.isFinite) || tickSize <= 0 || tickValue < 0 || lots <= 0) {
    return null;
  }
  return distance / tickSize * tickValue * lots;
}

export function Mt5TradingPanel() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("");
  const [data, setData] = useState<TradingData | null>(null);
  const [symbol, setSymbol] = useState("");
  const [instrumentSearch, setInstrumentSearch] = useState("");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<"market" | "limit" | "stop">("market");
  const [entryPrice, setEntryPrice] = useState("");
  const [volume, setVolume] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [modifyTicket, setModifyTicket] = useState("");
  const [modifyStopLoss, setModifyStopLoss] = useState("");
  const [modifyTakeProfit, setModifyTakeProfit] = useState("");
  const [orderDraft, setOrderDraft] = useState<OrderDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [refreshingQuote, setRefreshingQuote] = useState(false);
  const [quoteRefreshMessage, setQuoteRefreshMessage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await requestJson<{ accounts: Account[] }>("/api/mt5/accounts");
      setAccounts(response.accounts);
      const selectedId = response.accounts.some((account) => account.id === accountId)
        ? accountId
        : response.accounts[0]?.id || "";
      if (!selectedId) {
        setData(null);
        setAccountId("");
        setError("");
        return;
      }
      if (selectedId !== accountId) setAccountId(selectedId);
      const detail = await requestJson<TradingData>(`/api/mt5/accounts/${selectedId}`);
      setData(detail);
      setSymbol((current) => detail.instruments.some((instrument) => instrument.brokerSymbol === current)
        ? current
        : detail.instruments[0]?.brokerSymbol || "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const refreshQuote = async () => {
    if (!data) return;
    const quoteSymbol = orderDraft?.brokerSymbol ?? symbol;
    const activeDraft = orderDraft;
    setRefreshingQuote(true);
    setQuoteRefreshMessage("");
    setError("");
    try {
      const refreshedData = await requestJson<TradingData>(`/api/mt5/accounts/${data.account.id}`);
      setData(refreshedData);
      const quote = refreshedData.instruments.find((instrument) => instrument.brokerSymbol === quoteSymbol)?.quote;
      if (!quote) throw new Error("No MT5 quote is available for this symbol yet. Check the bridge and try again.");
      if (!isFreshQuote(quote)) {
        throw new Error("The latest MT5 tick is still older than 15 seconds. Wait for a new tick from the bridge, then refresh again.");
      }
      if (activeDraft?.orderType === "market") {
        setOrderDraft((current) => current?.clientOrderId === activeDraft.clientOrderId
          ? {
            ...current,
            referencePrice: activeDraft.side === "buy" ? quote.ask : quote.bid,
            quoteTime: quote.tickTime,
          }
          : current);
      }
      setQuoteRefreshMessage(`Fresh quote updated ${timestamp(quote.tickTime)}. Your order inputs are unchanged.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRefreshingQuote(false);
    }
  };

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 10_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [load]);

  const reviewOrder = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const instrument = data?.instruments.find((item) => item.brokerSymbol === symbol);
    if (!data || !instrument?.quote) return;
    const referencePrice = orderType === "market"
      ? side === "buy" ? instrument.quote.ask : instrument.quote.bid
      : entryPrice;
    setError("");
    setNotice("");
    setOrderDraft({
      accountId: data.account.id,
      clientOrderId: globalThis.crypto.randomUUID(),
      brokerSymbol: instrument.brokerSymbol,
      canonicalSymbol: instrument.canonicalSymbol,
      side,
      orderType,
      volume,
      entryPrice,
      referencePrice,
      quoteTime: instrument.quote.tickTime,
      stopLoss,
      takeProfit,
    });
  };

  const confirmOrder = async () => {
    if (!data || !orderDraft) return;
    if (data.account.id !== orderDraft.accountId) {
      setOrderDraft(null);
      setError("The selected account changed. Review the order again before submitting.");
      return;
    }
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{ status: string; reused?: boolean }>("/api/mt5/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: orderDraft.accountId,
          clientOrderId: orderDraft.clientOrderId,
          operation: "place_order",
          brokerSymbol: orderDraft.brokerSymbol,
          side: orderDraft.side,
          orderType: orderDraft.orderType,
          volume: orderDraft.volume,
          ...(orderDraft.orderType === "market" ? {} : { price: orderDraft.entryPrice }),
          stopLoss: orderDraft.stopLoss,
          takeProfit: orderDraft.takeProfit,
        }),
      });
      setOrderDraft(null);
      setNotice(result.status === "preflight"
        ? `Request sent for broker margin preflight${result.reused ? " (existing request)" : ""}. This is not a confirmed fill; check Execution requests for the final broker status.`
        : `Request status: ${result.status}${result.reused ? " (existing request)" : ""}. Check Execution requests for the final broker status.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const submitAction = async (request: Record<string, unknown>, successMessage: string) => {
    if (!data) return;
    setWorking(true);
    setError("");
    setNotice("");
    try {
      const result = await requestJson<{ status: string }>("/api/mt5/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: data.account.id,
          clientOrderId: globalThis.crypto.randomUUID(),
          ...request,
        }),
      });
      setNotice(`${successMessage} Request status: ${result.status}.`);
      setModifyTicket("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const selectedAccount = accounts.find((account) => account.id === accountId) ?? data?.account;
  const selectedInstrument = data?.instruments.find((instrument) => instrument.brokerSymbol === symbol);
  const reviewInstrument = orderDraft
    ? data?.instruments.find((instrument) => instrument.brokerSymbol === orderDraft.brokerSymbol)
    : undefined;
  const synchronizedDealTickets = new Set(data?.deals.map((deal) => deal.ticket) ?? []);
  const executionReceipts = data?.orders.filter((order) => {
    if (!["filled", "closed", "partially_filled"].includes(order.status) || !order.brokerResult) return false;
    const tickets = [
      ...(order.brokerResult.dealTickets ?? []),
      ...(order.brokerResult.dealTicket && order.brokerResult.dealTicket !== "0" ? [order.brokerResult.dealTicket] : []),
    ];
    return tickets.some((ticket) => !synchronizedDealTickets.has(ticket));
  }) ?? [];
  const visibleInstruments = data?.instruments.filter((instrument) =>
    `${instrument.canonicalSymbol} ${instrument.brokerSymbol} ${instrument.assetClass}`
      .toLowerCase()
      .includes(instrumentSearch.trim().toLowerCase()),
  ) ?? [];

  return (
    <section className="space-y-4">
      <PageHeader
        eyebrow="MetaTrader 5"
        title="Broker account and demo terminal"
        description="MT5 account and market data are synchronized by the Windows bridge. Orders are restricted to demo accounts and require server-side demo execution enablement."
        actions={accounts.length > 0 ? (
          <label className="flex items-center gap-2 text-[12px] text-fg-3">
            Account
            <select
              aria-label="MT5 account"
              value={accountId}
              onChange={(event) => {
                setAccountId(event.target.value);
                setData(null);
                setOrderDraft(null);
              }}
              className="rounded-lg border border-white/10 bg-ink-2 px-3 py-2 text-fg"
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.loginHint} · {account.server}</option>
              ))}
            </select>
          </label>
        ) : undefined}
      />

      {error && <Panel tone="crimson" hover={false} className="p-3 text-[12px] text-fg">{error}</Panel>}
      {notice && <Panel hover={false} className="p-3 text-[12px] text-fg-2">{notice}</Panel>}

      {!data && !loading && accounts.length === 0 && (
        <Panel hover={false} className="space-y-2 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium text-fg">No MT5 account has synchronized yet</div>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-3">
                Start the read-only bridge on the Windows machine with an authenticated MT5 terminal, then provision its bridge token through the server-side setup command. Broker credentials stay in MT5.
              </p>
            </div>
            <Badge tone="amber">Bridge required</Badge>
          </div>
        </Panel>
      )}
      {!data && loading && <Panel hover={false} className="p-5 text-[12px] text-fg-3">Loading MT5 accounts…</Panel>}

      {data && selectedAccount && (
        <>
          <Panel hover={false} className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={selectedAccount.accountType === "demo" ? "emerald" : "crimson"}>{selectedAccount.accountType.toUpperCase()}</Badge>
                <Badge tone={selectedAccount.connected ? "emerald" : "amber"} dot>{selectedAccount.connected ? "Bridge online" : "Bridge offline"}</Badge>
                <Badge tone={selectedAccount.tradingAllowed ? "emerald" : "amber"}>{selectedAccount.tradingAllowed ? "Broker permits trading" : "Broker blocks trading"}</Badge>
                <Badge tone={data.demoExecutionEnabled ? "emerald" : "amber"}>{data.demoExecutionEnabled ? "Demo execution enabled" : "Demo execution disabled"}</Badge>
                <span className="text-[12px] text-fg-3">{selectedAccount.broker || selectedAccount.server} · {selectedAccount.loginHint} · {selectedAccount.currency} · 1:{selectedAccount.leverage}</span>
              </div>
              <span className="text-[11px] text-fg-3">Last sync {timestamp(selectedAccount.lastSyncAt)}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <AccountMetric label="Balance" value={amount(selectedAccount.balance, selectedAccount.currency)} />
              <AccountMetric label="Equity" value={amount(selectedAccount.equity, selectedAccount.currency)} />
              <AccountMetric label="Free margin" value={amount(selectedAccount.freeMargin, selectedAccount.currency)} />
              <AccountMetric label="Used margin" value={amount(selectedAccount.usedMargin, selectedAccount.currency)} />
              <AccountMetric label="Margin level" value={selectedAccount.marginLevel === null ? "—" : `${price(selectedAccount.marginLevel)}%`} />
              <AccountMetric label="Floating P/L" value={amount(selectedAccount.floatingProfit, selectedAccount.currency)} />
            </div>
            {selectedAccount.accountType !== "demo" && (
              <p className="mt-3 text-[11px] text-down">Order entry is disabled for non-demo accounts.</p>
            )}
          </Panel>

          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <Panel hover={false} className="overflow-hidden">
              <PanelHeader
                title="MT5 market watch"
                eyebrow="Broker-mapped instruments"
                action={<input aria-label="Search MT5 instruments" value={instrumentSearch} onChange={(event) => setInstrumentSearch(event.target.value)} placeholder="Search symbols" className="w-full rounded-lg border border-white/10 bg-ink-2 px-2.5 py-2 text-[11px] text-fg outline-none focus:border-accent/50 sm:w-40" />}
              />
              <div className="divide-y divide-white/[0.06] md:hidden">
                {visibleInstruments.map((instrument) => {
                  const spread = instrument.quote ? (Number(instrument.quote.ask) - Number(instrument.quote.bid)).toPrecision(3) : "—";
                  const selected = symbol === instrument.brokerSymbol;
                  return (
                    <button
                      key={instrument.brokerSymbol}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSymbol(instrument.brokerSymbol)}
                      className={`flex min-h-[68px] w-full items-center justify-between gap-3 px-4 py-2.5 text-left ${selected ? "bg-accent/[0.07]" : ""}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-fg">{instrument.canonicalSymbol}</span>
                        <span className="mt-0.5 block truncate text-[10px] text-fg-3">{instrument.brokerSymbol} · {instrument.assetClass}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="num block text-[11px] text-fg-2">{price(instrument.quote?.bid)} / {price(instrument.quote?.ask)}</span>
                        <span className="mt-0.5 block text-[10px] text-fg-3">Spread {spread} · {timestamp(instrument.quote?.tickTime)}</span>
                      </span>
                    </button>
                  );
                })}
                {data.instruments.length === 0 && <p className="px-4 py-4 text-[11px] text-fg-3">Waiting for bridge symbol discovery and tick ingestion.</p>}
                {data.instruments.length > 0 && visibleInstruments.length === 0 && <p className="px-4 py-4 text-[11px] text-fg-3">No instruments match this search.</p>}
              </div>
              <div className="overflow-x-auto">
                <table className="hidden w-full text-left text-[12px] md:table">
                  <thead className="border-y hairline text-[10px] uppercase tracking-wider text-fg-3">
                    <tr><th className="px-4 py-2">Instrument</th><th className="px-4 py-2">Bid</th><th className="px-4 py-2">Ask</th><th className="px-4 py-2">Spread</th><th className="px-4 py-2">Updated</th></tr>
                  </thead>
                  <tbody>
                    {visibleInstruments.map((instrument) => (
                      <tr key={instrument.brokerSymbol} className="border-b hairline last:border-0">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-fg">{instrument.canonicalSymbol}</div>
                          <div className="text-[10px] text-fg-3">{instrument.brokerSymbol} · {instrument.assetClass}</div>
                        </td>
                        <td className="num px-4 py-2.5 text-fg-2">{price(instrument.quote?.bid)}</td>
                        <td className="num px-4 py-2.5 text-fg-2">{price(instrument.quote?.ask)}</td>
                        <td className="num px-4 py-2.5 text-fg-3">
                          {instrument.quote ? (Number(instrument.quote.ask) - Number(instrument.quote.bid)).toPrecision(3) : "—"}
                        </td>
                        <td className="px-4 py-2.5 text-[10px] text-fg-3">{timestamp(instrument.quote?.tickTime)}</td>
                      </tr>
                    ))}
                    {data.instruments.length === 0 && <tr><td className="px-4 py-4 text-fg-3" colSpan={5}>Waiting for bridge symbol discovery and tick ingestion.</td></tr>}
                    {data.instruments.length > 0 && visibleInstruments.length === 0 && <tr><td className="px-4 py-4 text-fg-3" colSpan={5}>No instruments match this search.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>

            <Panel hover={false} className="p-4">
              <h3 className="text-sm font-medium text-fg">Place a demo order</h3>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-3">
                Volume is in lots. Stop loss and take profit are price levels, not pip amounts. Review the exact order before sending.
              </p>
              <div className="mt-3 rounded-lg border border-warn/20 bg-warn/5 p-2.5">
                <div className="flex flex-col items-start justify-between gap-2 sm:flex-row sm:items-center">
                  <p className="min-w-0 text-[10px] leading-relaxed text-fg-3">
                    {selectedInstrument?.quote
                      ? `${isFreshQuote(selectedInstrument.quote) ? "Live quote" : "Last quote"}: bid ${price(selectedInstrument.quote.bid)} · ask ${price(selectedInstrument.quote.ask)} · updated ${timestamp(selectedInstrument.quote.tickTime)}. Stop and target inputs are prices.`
                      : "No live quote yet. Orders remain blocked until the bridge provides a valid market quote."}
                  </p>
                  <Button
                    disabled={refreshingQuote || working}
                    onClick={() => void refreshQuote()}
                    className="min-h-8 shrink-0 px-2.5 py-1 text-[10px]"
                  >
                    <RefreshCw size={12} className={refreshingQuote ? "animate-spin" : ""} />
                    {refreshingQuote ? "Refreshing…" : "Refresh quote"}
                  </Button>
                </div>
                {quoteRefreshMessage && <p role="status" className="mt-2 text-[10px] text-up">{quoteRefreshMessage}</p>}
              </div>
              {!data.demoExecutionEnabled && (
                <div role="status" className="mt-3 rounded-lg border border-warn/20 bg-warn/5 p-2.5 text-[10px] leading-relaxed text-fg-3">
                  Demo execution is disabled by server configuration. You may review an order, but it cannot be sent.
                </div>
              )}
              {orderDraft ? (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-fg">Review this order</div>
                      <Badge tone={orderDraft.side === "buy" ? "emerald" : "crimson"}>DEMO · {orderDraft.side.toUpperCase()}</Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 text-[11px]">
                      <ReviewValue label="Instrument / type" value={`${orderDraft.canonicalSymbol} · ${orderDraft.orderType}`} />
                      <ReviewValue label="Volume" value={`${quantity(orderDraft.volume)} lots`} />
                      <ReviewValue label={orderDraft.orderType === "market" ? "Reference quote" : "Entry price"} value={price(orderDraft.referencePrice)} detail={orderDraft.orderType === "market" ? timestamp(orderDraft.quoteTime) : undefined} />
                      <ReviewValue label="Stop-loss price" value={price(orderDraft.stopLoss)} detail={reviewInstrument ? priceDistance(orderDraft.referencePrice, orderDraft.stopLoss, reviewInstrument) : undefined} />
                      <ReviewValue label="Estimated loss at stop" value={reviewInstrument ? amount(estimatedMove(orderDraft.referencePrice, orderDraft.stopLoss, orderDraft.volume, reviewInstrument), data.account.currency) : "—"} />
                      <ReviewValue label="Take-profit price" value={price(orderDraft.takeProfit)} detail={reviewInstrument ? priceDistance(orderDraft.referencePrice, orderDraft.takeProfit, reviewInstrument) : undefined} />
                      <ReviewValue label="Estimated gain at target" value={reviewInstrument ? amount(estimatedMove(orderDraft.referencePrice, orderDraft.takeProfit, orderDraft.volume, reviewInstrument), data.account.currency) : "—"} />
                    </dl>
                    <p className="mt-3 text-[10px] leading-relaxed text-fg-3">
                      Estimates use the broker’s tick values and exclude price movement, fees, and slippage. A market fill may differ from this reference quote. Server-side risk checks and broker preflight still apply.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button disabled={working} onClick={() => setOrderDraft(null)}>Back to edit</Button>
                    <Button
                      type="button"
                      variant={orderDraft.side === "buy" ? "primary" : "danger"}
                      disabled={working || !data.demoExecutionEnabled || !data.account.connected || data.account.accountType !== "demo" || !data.account.tradingAllowed}
                      onClick={() => void confirmOrder()}
                    >
                      {working ? "Sending request…" : `Confirm demo ${orderDraft.side}`}
                    </Button>
                  </div>
                </div>
              ) : (
                <form className="mt-4 space-y-3" onSubmit={reviewOrder}>
                  <label className="block text-[11px] text-fg-3">
                    Instrument
                    <select required value={symbol} onChange={(event) => setSymbol(event.target.value)} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-2 px-3 py-2.5 text-[12px] text-fg">
                      {data.instruments.map((instrument) => <option key={instrument.brokerSymbol} value={instrument.brokerSymbol}>{instrument.canonicalSymbol} · {instrument.brokerSymbol}</option>)}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] text-fg-3">
                      Direction
                      <select value={side} onChange={(event) => setSide(event.target.value as "buy" | "sell")} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-2 px-3 py-2.5 text-[12px] text-fg">
                        <option value="buy">Buy</option><option value="sell">Sell</option>
                      </select>
                    </label>
                    <Field
                      label="Volume (lots)"
                      value={volume}
                      onChange={setVolume}
                      placeholder="e.g. 0.01"
                      helper={selectedInstrument ? `Minimum ${quantity(selectedInstrument.volumeMin)} lots; volume step ${quantity(selectedInstrument.volumeStep)}.` : "Enter an explicit volume."}
                      min={selectedInstrument?.volumeMin ?? "0.01"}
                      step={selectedInstrument?.volumeStep ?? "0.01"}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-[11px] text-fg-3">
                      Order type
                      <select value={orderType} onChange={(event) => setOrderType(event.target.value as "market" | "limit" | "stop")} className="mt-1 w-full rounded-lg border border-white/10 bg-ink-2 px-3 py-2.5 text-[12px] text-fg">
                        <option value="market">Market</option><option value="limit">Limit</option><option value="stop">Stop</option>
                      </select>
                    </label>
                    {orderType !== "market" && <Field label="Entry price" value={entryPrice} onChange={setEntryPrice} placeholder="Broker price" min="0" step={selectedInstrument?.tickSize ?? "any"} required />}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Stop-loss price" value={stopLoss} onChange={setStopLoss} placeholder="e.g. 1.09500" helper="Absolute broker price" min="0" step={selectedInstrument?.tickSize ?? "any"} required />
                    <Field label="Take-profit price" value={takeProfit} onChange={setTakeProfit} placeholder="e.g. 1.10100" helper="Absolute broker price" min="0" step={selectedInstrument?.tickSize ?? "any"} required />
                  </div>
                  <Button className="w-full" type="submit" variant={side === "buy" ? "primary" : "danger"} disabled={working || !data.account.connected || data.account.accountType !== "demo" || !data.account.tradingAllowed || !selectedInstrument?.quote}>
                    Review order
                  </Button>
                </form>
              )}
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel hover={false} className="overflow-hidden">
              <PanelHeader title={`Open positions · ${data.positions.length}`} eyebrow="Broker-synchronized" />
              <div className="divide-y divide-white/[0.06] md:hidden">
                {data.positions.map((position) => (
                  <article key={position.brokerTicket} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-fg">{position.brokerSymbol}</div>
                        <div className="mt-0.5 text-[10px] text-fg-3">Ticket #{position.brokerTicket}</div>
                      </div>
                      <Badge tone={position.side === "buy" ? "emerald" : "crimson"}>{position.side} · {quantity(position.volume)} lots</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[10.5px]">
                      <div><span className="block text-fg-3">Open / current</span><span className="num text-fg-2">{price(position.openPrice)} / {price(position.currentPrice)}</span></div>
                      <div><span className="block text-fg-3">Floating P/L</span><span className={`num ${Number(position.profit) >= 0 ? "text-up" : "text-down"}`}>{amount(position.profit, data.account.currency)}</span></div>
                      <div><span className="block text-fg-3">Stop loss</span><span className="num text-fg-2">{position.stopLoss ? price(position.stopLoss) : "—"}</span></div>
                      <div><span className="block text-fg-3">Take profit</span><span className="num text-fg-2">{position.takeProfit ? price(position.takeProfit) : "—"}</span></div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button disabled={working || !data.account.connected || data.account.accountType !== "demo"} onClick={() => void submitAction({ operation: "close_position", ticket: position.brokerTicket }, "Close requested.")}>Close position</Button>
                      <Button disabled={working || !data.account.connected || data.account.accountType !== "demo"} onClick={() => {
                        setModifyTicket(position.brokerTicket);
                        setModifyStopLoss(position.stopLoss ?? "");
                        setModifyTakeProfit(position.takeProfit ?? "");
                      }}>Manage stops</Button>
                    </div>
                  </article>
                ))}
                {data.positions.length === 0 && <p className="px-4 py-4 text-[11px] text-fg-3">No open positions reported by the broker.</p>}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-y hairline text-[10px] uppercase tracking-wider text-fg-3">
                    <tr><th className="px-4 py-2">Symbol / ticket</th><th className="px-4 py-2">Side / lots</th><th className="px-4 py-2">Open / current</th><th className="px-4 py-2">P/L</th><th className="px-4 py-2">Actions</th></tr>
                  </thead>
                  <tbody>
                    {data.positions.map((position) => (
                      <tr key={position.brokerTicket} className="border-b hairline last:border-0">
                        <td className="px-4 py-2.5"><div>{position.brokerSymbol}</div><div className="text-fg-3">#{position.brokerTicket}</div></td>
                        <td className="px-4 py-2.5">{position.side} · {quantity(position.volume)} lots</td>
                        <td className="num px-4 py-2.5">{price(position.openPrice)} / {price(position.currentPrice)}</td>
                        <td className={`num px-4 py-2.5 ${Number(position.profit) >= 0 ? "text-up" : "text-down"}`}>{amount(position.profit, data.account.currency)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            <Button disabled={working || !data.account.connected || data.account.accountType !== "demo"} className="px-2 py-1 text-[10px]" onClick={() => void submitAction({ operation: "close_position", ticket: position.brokerTicket }, "Close requested.")}>Close</Button>
                            <Button disabled={working || !data.account.connected || data.account.accountType !== "demo"} className="px-2 py-1 text-[10px]" onClick={() => {
                              setModifyTicket(position.brokerTicket);
                              setModifyStopLoss(position.stopLoss ?? "");
                              setModifyTakeProfit(position.takeProfit ?? "");
                            }}>Stops</Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {data.positions.length === 0 && <tr><td className="px-4 py-4 text-fg-3" colSpan={5}>No open positions reported by the broker.</td></tr>}
                  </tbody>
                </table>
              </div>
              {modifyTicket && (
                <form className="m-4 flex flex-wrap items-end gap-2 rounded-lg border hairline p-3" onSubmit={(event) => {
                  event.preventDefault();
                  void submitAction({ operation: "modify_position", ticket: modifyTicket, stopLoss: modifyStopLoss || null, takeProfit: modifyTakeProfit || null }, "Position protection update requested.");
                }}>
                  <Field label="Stop loss" value={modifyStopLoss} onChange={setModifyStopLoss} />
                  <Field label="Take profit" value={modifyTakeProfit} onChange={setModifyTakeProfit} />
                  <Button type="submit" variant="primary" disabled={working}>Save stops</Button>
                  <Button onClick={() => setModifyTicket("")} disabled={working}>Cancel</Button>
                </form>
              )}
            </Panel>

            <Panel hover={false} className="overflow-hidden">
              <PanelHeader title={`Pending orders · ${data.pendingOrders.length}`} eyebrow="Broker-synchronized" />
              <div className="divide-y divide-white/[0.06] md:hidden">
                {data.pendingOrders.map((order) => (
                  <article key={order.brokerTicket} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-medium text-fg">{order.brokerSymbol}</div>
                        <div className="mt-0.5 text-[10px] text-fg-3">Ticket #{order.brokerTicket}</div>
                      </div>
                      <Badge tone={order.side === "buy" ? "emerald" : "crimson"}>{order.side} {order.orderType}</Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-[10.5px]">
                      <div><span className="block text-fg-3">Volume</span><span className="num text-fg-2">{quantity(order.volume)} lots</span></div>
                      <div><span className="block text-fg-3">Entry price</span><span className="num text-fg-2">{price(order.price)}</span></div>
                    </div>
                    <Button className="mt-3 w-full" disabled={working || !data.account.connected || data.account.accountType !== "demo"} onClick={() => void submitAction({ operation: "cancel_pending", ticket: order.brokerTicket }, "Cancel requested.")}>Cancel pending order</Button>
                  </article>
                ))}
                {data.pendingOrders.length === 0 && <p className="px-4 py-4 text-[11px] text-fg-3">No pending orders reported by the broker.</p>}
              </div>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-left text-[11px]">
                  <thead className="border-y hairline text-[10px] uppercase tracking-wider text-fg-3">
                    <tr><th className="px-4 py-2">Symbol / ticket</th><th className="px-4 py-2">Type</th><th className="px-4 py-2">Lots / price</th><th className="px-4 py-2">Action</th></tr>
                  </thead>
                  <tbody>
                    {data.pendingOrders.map((order) => (
                      <tr key={order.brokerTicket} className="border-b hairline last:border-0">
                        <td className="px-4 py-2.5">{order.brokerSymbol}<div className="text-fg-3">#{order.brokerTicket}</div></td>
                        <td className="px-4 py-2.5">{order.side} {order.orderType}</td>
                        <td className="num px-4 py-2.5">{quantity(order.volume)} lots / {price(order.price)}</td>
                        <td className="px-4 py-2.5"><Button disabled={working || !data.account.connected || data.account.accountType !== "demo"} className="px-2 py-1 text-[10px]" onClick={() => void submitAction({ operation: "cancel_pending", ticket: order.brokerTicket }, "Cancel requested.")}>Cancel</Button></td>
                      </tr>
                    ))}
                    {data.pendingOrders.length === 0 && <tr><td className="px-4 py-4 text-fg-3" colSpan={4}>No pending orders reported by the broker.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Panel>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <Panel hover={false} className="overflow-hidden">
              <PanelHeader title="Execution requests" eyebrow="Backend idempotency and state" />
              <div className="divide-y divide-white/[0.06]">
                {data.orders.slice(0, 12).map((order) => (
                  <div key={order.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px]">
                    <div><span className="text-fg">{order.operation.replaceAll("_", " ")} {order.brokerSymbol ?? ""}</span><div className="mt-0.5 text-[10px] text-fg-3">{timestamp(order.createdAt)} {order.error ? `· ${order.error}` : ""}</div></div>
                    <div className="flex items-center gap-2"><span className="num text-fg-2">{order.requestedVolume ? `${quantity(order.requestedVolume)} lots` : "—"}</span><Badge tone={order.status === "filled" || order.status === "closed" ? "emerald" : order.status === "rejected" || order.status === "unknown" ? "crimson" : "amber"}>{order.status}</Badge></div>
                  </div>
                ))}
                {data.orders.length === 0 && <div className="px-4 py-4 text-[11px] text-fg-3">No execution requests have been recorded.</div>}
              </div>
            </Panel>
            <Panel hover={false} className="overflow-hidden">
              <PanelHeader title="Recent broker activity" eyebrow="Synced deals and execution receipts" />
              <div className="divide-y divide-white/[0.06]">
                {data.deals.slice(0, 12).map((deal) => (
                  <div key={deal.ticket} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px]">
                    <div className="min-w-0">
                      <span className="text-fg">{deal.brokerSymbol} · {deal.side} {dealEntryLabel(deal.entry)}</span>
                      <div className="mt-0.5 text-[10px] text-fg-3">{quantity(deal.volume)} lots @ {price(deal.price)} · {timestamp(deal.occurredAt)} · #{deal.ticket}</div>
                      <div className="mt-0.5 text-[10px] text-fg-3">Profit {amount(deal.profit, data.account.currency)} · commission {amount(deal.commission, data.account.currency)} · swap {amount(deal.swap, data.account.currency)}</div>
                    </div>
                    <div className="text-right">
                      <div className="eyebrow">Net P/L</div>
                      <span className={`num ${Number(deal.profit) + Number(deal.commission) + Number(deal.swap) >= 0 ? "text-up" : "text-down"}`}>
                        {amount(Number(deal.profit) + Number(deal.commission) + Number(deal.swap), data.account.currency)}
                      </span>
                    </div>
                  </div>
                ))}
                {executionReceipts.slice(0, 12).map((order) => {
                  const tickets = [
                    ...(order.brokerResult?.dealTickets ?? []),
                    ...(order.brokerResult?.dealTicket && order.brokerResult.dealTicket !== "0" ? [order.brokerResult.dealTicket] : []),
                  ].filter((ticket) => !synchronizedDealTickets.has(ticket));
                  return (
                    <div key={`receipt-${order.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px]">
                      <div className="min-w-0">
                        <span className="text-fg">{order.brokerSymbol} · {order.operation.replaceAll("_", " ")}</span>
                        <div className="mt-0.5 text-[10px] text-fg-3">
                          {quantity(order.filledVolume ?? order.requestedVolume)} lots @ {price(order.brokerResult?.price ?? order.price)} · {timestamp(order.createdAt)}
                          {tickets.length > 0 ? ` · deal #${tickets.join(", ")}` : ""}
                        </div>
                        <div className="mt-0.5 text-[10px] text-fg-3">Broker-confirmed. Profit, commission, and swap are waiting for deal-history sync.</div>
                      </div>
                      <Badge tone={order.status === "partially_filled" ? "amber" : "emerald"}>{order.status === "partially_filled" ? "Partial fill" : "Confirmed"}</Badge>
                    </div>
                  );
                })}
                {data.deals.length === 0 && executionReceipts.length === 0 && <div className="px-4 py-4 text-[11px] text-fg-3">No broker deals have been synchronized.</div>}
              </div>
            </Panel>
          </div>
        </>
      )}
    </section>
  );
}

function AccountMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border hairline bg-black/10 p-3"><div className="eyebrow">{label}</div><div className="num mt-1 text-[14px] text-fg">{value}</div></div>;
}

function dealEntryLabel(entry: Deal["entry"]) {
  if (entry === "in") return "open";
  if (entry === "out") return "close";
  if (entry === "inout") return "reverse";
  return "close by";
}

function ReviewValue({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-fg-3">{label}</dt>
      <dd className="num mt-0.5 break-words text-[12px] text-fg">{value}</dd>
      {detail && <dd className="mt-0.5 text-[10px] text-fg-3">{detail}</dd>}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  helper,
  min = 0,
  step = "any",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  helper?: string;
  min?: number | string;
  step?: number | string;
}) {
  return (
    <label className="block min-w-0 flex-1 text-[11px] text-fg-3">
      {label}
      <input
        required={required}
        type="number"
        step={step}
        min={min}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-white/10 bg-ink-2 px-3 py-2.5 text-[12px] text-fg outline-none focus:border-accent/50"
      />
      {helper && <span className="mt-1 block text-[10px] text-fg-3">{helper}</span>}
    </label>
  );
}
