"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { LineChart } from "@/components/charts/LineChart";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";
import { fmtDateTime, fmtPrice, fmtUsd } from "@/lib/format";

type Section = "overview" | "markets" | "intelligence" | "strategy-lab" | "trading" | "system";
type Candle = { openTime: string; close: string; baseVolume: string; quoteVolume: string; isClosed: boolean };
type MarketResponse = { symbol: string; interval: string; candles: Candle[] };
type Analysis = {
  observed: { close: number; baseVolume: number; quoteVolume: number };
  indicators: {
    rsi14: number | null;
    macd: { line: number | null; signal: number | null; histogram: number | null };
    ema: Record<string, number | null>;
    sma: Record<string, number | null>;
    bollinger: { upper: number | null; middle: number | null; lower: number | null };
    atr14: number | null;
    volume: { current: number; average20: number | null; ratio: number | null };
    momentum: { change1: number | null; change5: number | null; change20: number | null };
    support: number | null;
    resistance: number | null;
    volatility: { atrPercent: number | null; realizedPercent: number | null };
    liquidity: { averageQuoteVolume20: number | null; spreadBps: number | null };
  };
  regime: { trend: string; volatility: string; label: string };
  confidence: number;
  candleOpenTime: string;
  provenance: { source: string; table: string; candleCount: number; calculatedAt: string };
};
type Decision = {
  id: number;
  strategySlug: string;
  action: string;
  status: string;
  entryPrice: string | null;
  stopLoss: string | null;
  takeProfit: string | null;
  confidence: number;
  regime: string;
  supportingIndicators: string[];
  explanation: string;
  createdAt: string;
};
type IntelligenceResponse = { analysis: Analysis; decisions: Decision[] };
type Strategy = { slug: string; name: string; description: string; version: number; active: boolean; rules: Record<string, number> };
type StrategyResponse = { strategies: Strategy[]; backtests: Array<{ id: number; strategySlug: string; metrics: BacktestMetrics; createdAt: string }> };
type BacktestMetrics = {
  inSample: { totalReturnPct: number; winRatePct: number; profitFactor: number | null; maxDrawdownPct: number; sharpeRatio: number; trades: number; averageProfit: number; averageLoss: number };
  outOfSample: { totalReturnPct: number; winRatePct: number; profitFactor: number | null; maxDrawdownPct: number; sharpeRatio: number; trades: number };
  buyAndHold: { totalReturnPct: number };
  candles: number;
  assumptions: { feeRate: number; slippageRate: number };
};
type BacktestResponse = { result: { metrics: BacktestMetrics; equityCurve: Array<{ time: number; strategy: number; benchmark: number }>; trades: Array<{ entryTime: string; exitTime: string; netPnl: number }> } };
type Position = { symbol: string; qty: number; avgCost: number; mark: number; value: number; unrealized: number; pct: number };
type PaperResponse = {
  state: string;
  portfolio: {
    account: { halted: boolean; updatedAt: string };
    positions: Position[];
    orders: Array<{ id: number; symbol: string; side: string; quantity: number; price: number; fee: number; slippage: number; status: string; reason: string | null; createdAt: string; strategy: string | null }>;
    summary: { equity: number; cash: number; exposure: number; unrealized: number; realized: number; fees: number; slippage: number; filled: number; rejected: number; startingEquity: number; livePrice: number };
  };
  decisions: Decision[];
  engine: { state: string; lastCycleAt: string | null; lastError: string | null } | null;
};
type RiskConfig = {
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
type RiskResponse = { config: RiskConfig };
type AccessResponse = {
  entitlement: {
    planId: string;
    planName: string;
    isComplimentary: boolean;
    features: Record<string, boolean | number>;
  };
};
type HealthResponse = {
  database: { state: string; error?: string };
  collector: { state: string; lastMessageAt: string | null; lastError: string | null; orderBookSequenceHealthy: boolean; reconnectCount: number } | null;
  engines: Array<{ engine: string; state: string; lastCycleAt: string | null; lastError: string | null }>;
  metrics?: {
    process: { cpuPercentOfOneCore: number; rssBytes: number; heapUsedBytes: number };
    host: { totalMemoryBytes: number; freeMemoryBytes: number };
    applicationFilesystem: { totalBytes: number; availableBytes: number; usedPercent: number | null };
    database: { sizeBytes: number };
  };
};
type RequestState = { market: MarketResponse | null; intelligence: IntelligenceResponse | null; strategies: StrategyResponse | null; paper: PaperResponse | null; risk: RiskConfig | null; health: HealthResponse | null };

const EMPTY: RequestState = { market: null, intelligence: null, strategies: null, paper: null, risk: null, health: null };
const fmtPct = (value: number | null | undefined) => value === null || value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}%`;
const fmtValue = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const fmtOptionalPrice = (value: number | null | undefined) => value === null || value === undefined ? "—" : fmtPrice(value);
const fmtBytes = (value: number | undefined) => {
  if (value === undefined || !Number.isFinite(value)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) {
    amount /= 1024;
    index++;
  }
  return `${amount.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Request failed (${response.status})`);
  return body;
}

export function TerminalSection({ section }: { section: Section }) {
  const [data, setData] = useState<RequestState>(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [riskDraft, setRiskDraft] = useState<RiskConfig | null>(null);
  const [backtest, setBacktest] = useState<BacktestResponse | null>(null);
  const [selectedStrategy, setSelectedStrategy] = useState("ema-trend");
  const [notice, setNotice] = useState("");
  const [access, setAccess] = useState<AccessResponse["entitlement"] | null>(null);
  const [accessError, setAccessError] = useState("");

  const load = useCallback(async () => {
    try {
      const [market, intelligence, strategies, paper, risk, health] = await Promise.all([
        getJson<MarketResponse>("/api/market/candles?symbol=BTCUSDT&interval=1m&limit=200"),
        getJson<IntelligenceResponse>("/api/intelligence?symbol=BTCUSDT&interval=1m"),
        getJson<StrategyResponse>("/api/strategies"),
        getJson<PaperResponse>("/api/paper"),
        getJson<RiskResponse>("/api/risk"),
        getJson<HealthResponse>("/api/health"),
      ]);
      setData({ market, intelligence, strategies, paper, risk: risk.config, health });
      setRiskDraft((current) => current ?? risk.config);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => { void load(); }, 0);
    const timer = window.setInterval(() => { void load(); }, 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void getJson<AccessResponse>("/api/billing")
        .then((result) => {
          setAccess(result.entitlement);
          setAccessError("");
        })
        .catch((reason: unknown) => setAccessError(reason instanceof Error ? reason.message : String(reason)));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const act = async (url: string, body: unknown) => {
    setWorking(true);
    setNotice("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string; message?: string; state?: string };
      if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status})`);
      setNotice(result.message ?? result.state ?? "Saved.");
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const runBacktest = async () => {
    setWorking(true);
    setNotice("");
    try {
      const response = await fetch("/api/strategies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backtest", strategySlug: selectedStrategy, interval: "1m", limit: 50_000 }),
      });
      const result = await response.json() as BacktestResponse & { error?: string };
      if (!response.ok) throw new Error(result.error ?? `Backtest failed (${response.status})`);
      setBacktest(result);
      setNotice(`Backtest persisted using ${result.result.metrics.candles.toLocaleString()} closed Binance candles.`);
      await load();
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const saveRisk = () => riskDraft && void act("/api/risk", riskDraft);
  const title: Record<Section, { eyebrow: string; title: string; description: string }> = {
    overview: { eyebrow: "Overview", title: "Axylum Intelligence Terminal", description: "Live BTCUSDT market data, calculated intelligence, autonomous paper trading and system health." },
    markets: { eyebrow: "Markets", title: "BTCUSDT spot", description: "Observed Binance candles and indicators calculated from persisted closed-market data." },
    intelligence: { eyebrow: "Intelligence", title: "Market analysis and decisions", description: "Each observation is distinguished from calculated indicators and rule-based conclusions." },
    "strategy-lab": { eyebrow: "Strategy Lab", title: "Strategies and historical validation", description: "Transparent BTCUSDT rules evaluated against persisted candles with next-candle execution assumptions." },
    trading: { eyebrow: "Trading", title: "Autonomous paper account", description: "Simulated spot-only orders. No authenticated exchange trading or real-money execution is available." },
    system: { eyebrow: "System", title: "Operational health", description: "PostgreSQL, Binance collector, paper engine, strategy and audit activity." },
  };
  const currentPrice = data.intelligence?.analysis.observed.close;
  const candles = data.market?.candles.filter((candle) => candle.isClosed) ?? [];
  const latest = candles[candles.length - 1];
  const previous = candles[candles.length - 2];
  const change = latest && previous ? (Number(latest.close) / Number(previous.close) - 1) * 100 : null;
  const summary = data.paper?.portfolio.summary;
  const engine = data.paper?.engine;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow={title[section].eyebrow} title={title[section].title} description={title[section].description} />
      {error && <Panel tone="crimson" hover={false} className="p-4 text-[13px] text-fg">{error}</Panel>}
      {notice && <Panel hover={false} className="p-3 text-[12.5px] text-fg-2">{notice}</Panel>}
      {accessError && <Panel hover={false} className="border border-amber-400/20 bg-amber-400/5 p-3 text-[12px] text-fg-2">Plan permissions could not be loaded: {accessError}</Panel>}
      {loading && !data.market && <Panel hover={false} className="p-5 text-[13px] text-fg-3">Loading persisted market and engine data…</Panel>}

      {section === "overview" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="BTCUSDT" value={currentPrice ? fmtPrice(currentPrice) : "—"} note={change === null ? "Latest closed candle" : `${change >= 0 ? "+" : ""}${change.toFixed(3)}% · last 1m`} />
            <Metric label="Market regime" value={data.intelligence?.analysis.regime.label ?? "—"} note={`Confidence ${fmtValue(data.intelligence?.analysis.confidence ? data.intelligence.analysis.confidence * 100 : null, 0)}%`} />
            <Metric label="Paper equity" value={summary ? fmtUsd(summary.equity) : "—"} note={`Realized ${summary ? fmtUsd(summary.realized) : "—"} · unrealized ${summary ? fmtUsd(summary.unrealized) : "—"}`} />
            <Metric label="Engine / collector" value={`${engine?.state ?? "offline"} / ${data.health?.collector?.state ?? "unknown"}`} note={`Database ${data.health?.database.state ?? "unknown"}`} />
          </div>
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)]">
            <MarketPanel candles={candles} analysis={data.intelligence?.analysis} />
            <DecisionPanel decisions={data.intelligence?.decisions ?? []} />
          </div>
        </>
      )}

      {section === "markets" && (
        <>
          <MarketPanel candles={candles} analysis={data.intelligence?.analysis} large />
          <IndicatorGrid analysis={data.intelligence?.analysis} />
        </>
      )}

      {section === "intelligence" && (
        <>
          {data.intelligence?.analysis && <AnalysisPanel analysis={data.intelligence.analysis} />}
          <DecisionPanel decisions={data.intelligence?.decisions ?? []} />
        </>
      )}

      {section === "strategy-lab" && (
        <>
          {access && (
            <Panel hover={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <div className="text-[12px] font-medium text-fg">{access.isComplimentary ? "Professional · Complimentary Access" : `${access.planName} plan`}</div>
                <p className="mt-1 text-[11px] text-fg-3">
                  {access.features.strategy_builder
                    ? `Strategy editing is included. ${Number(access.features.backtests_per_day) || 0} backtests per day.`
                    : `Read-only strategies · ${Number(access.features.backtests_per_day) || 0} backtests per day. Upgrade to edit strategies.`}
                </p>
              </div>
              {!access.features.strategy_builder && <Link href="/billing" className="text-[12px] text-[#9db8f5] hover:underline">View plans</Link>}
            </Panel>
          )}
          <Panel hover={false}>
            <PanelHeader eyebrow="Active strategy catalog" title="Versioned, explicit rules" action={<Badge tone="blue">BTCUSDT · Spot · Long-only</Badge>} />
            <div className="divide-y divide-white/[0.06]">
              {data.strategies?.strategies.map((strategy) => (
                <div key={strategy.slug} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                  <div>
                    <div className="flex items-center gap-2 text-[13px] font-medium text-fg">{strategy.name}<Badge>v{strategy.version}</Badge></div>
                    <p className="mt-1 text-[12px] text-fg-3">{strategy.description}</p>
                    <StrategyRuleEditor strategy={strategy} working={working} editable={Boolean(access?.features.strategy_builder)} onSave={(rules) => void act("/api/strategies", { action: "configure", slug: strategy.slug, rules })} />
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone={strategy.active ? "emerald" : "neutral"}>{strategy.active ? "Active" : "Inactive"}</Badge>
                    <Button disabled={working || !access?.features.strategy_builder} onClick={() => void act("/api/strategies", { action: "toggle", slug: strategy.slug, active: !strategy.active })}>
                      {strategy.active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
          <Panel hover={false}>
            <PanelHeader eyebrow="Historical simulation" title="Stored Binance candles" action={
              <div className="flex gap-2">
                <select value={selectedStrategy} onChange={(event) => setSelectedStrategy(event.target.value)} className="rounded-lg border hairline bg-black/30 px-2.5 py-2 text-[12px] text-fg">
                  <option value="ema-trend">EMA Trend Confirmation</option>
                  <option value="rsi-reversal">RSI Support Reversal</option>
                </select>
                <Button variant="primary" disabled={working || !access || !(Number(access.features.backtests_per_day) > 0)} onClick={() => void runBacktest()}>{working ? "Running…" : "Run backtest"}</Button>
              </div>
            } />
            {backtest && <BacktestSummary result={backtest.result} />}
            <div className="divide-y divide-white/[0.06]">
              {data.strategies?.backtests.map((run) => (
                <div key={run.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-[12px] text-fg-2">
                  <span>{run.strategySlug} · {fmtDateTime(run.createdAt)}</span>
                  <span>IS {fmtPct(run.metrics.inSample.totalReturnPct)} · OOS {fmtPct(run.metrics.outOfSample.totalReturnPct)} · {run.metrics.inSample.trades} trades</span>
                </div>
              ))}
              {!data.strategies?.backtests.length && <p className="px-5 py-4 text-[12px] text-fg-3">No persisted backtests yet.</p>}
            </div>
          </Panel>
        </>
      )}

      {section === "trading" && (
        <>
          <Panel hover={false} className="flex flex-wrap items-center justify-between gap-4 p-5">
            <div>
              <div className="flex items-center gap-2"><Badge tone={data.paper?.state === "running" ? "emerald" : "amber"} dot>{data.paper?.state ?? "unknown"}</Badge><Badge tone="blue">Paper only</Badge></div>
              <p className="mt-2 text-[12px] text-fg-3">Worker status: {engine?.state ?? "not reported"}{engine?.lastError ? ` · ${engine.lastError}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={working || data.paper?.state === "running"} onClick={() => void act("/api/paper", { action: data.paper?.state === "paused" ? "resume" : "start" })}>{data.paper?.state === "paused" ? "Resume" : "Start"}</Button>
              <Button disabled={working || data.paper?.state !== "running"} onClick={() => void act("/api/paper", { action: "pause" })}>Pause</Button>
              <Button variant="danger" disabled={working || data.paper?.state === "stopped"} onClick={() => void act("/api/paper", { action: "stop" })}>Stop</Button>
              <Button variant="danger" disabled={working || data.paper?.portfolio.account.halted} onClick={() => void act("/api/paper", { action: "emergency_halt" })}>Emergency halt</Button>
              {data.paper?.portfolio.account.halted && <Button disabled={working || data.paper.state !== "stopped"} onClick={() => void act("/api/paper", { action: "clear_halt" })}>Clear halt</Button>}
            </div>
          </Panel>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Simulated equity" value={summary ? fmtUsd(summary.equity) : "—"} note={`Started ${summary ? fmtUsd(summary.startingEquity) : "—"}`} />
            <Metric label="Cash / exposure" value={summary ? fmtUsd(summary.cash) : "—"} note={`Exposure ${summary ? fmtUsd(summary.exposure) : "—"}`} />
            <Metric label="Realized / unrealized P&L" value={summary ? fmtUsd(summary.realized + summary.unrealized) : "—"} note={`${summary?.filled ?? 0} filled · ${summary?.rejected ?? 0} rejected`} />
            <Metric label="Fees / slippage" value={summary ? fmtUsd(summary.fees + summary.slippage) : "—"} note={`Fees ${summary ? fmtUsd(summary.fees) : "—"}`} />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Panel hover={false}>
              <PanelHeader eyebrow="Position" title="Open BTCUSDT exposure" />
              {data.paper?.portfolio.positions.map((position) => <PositionRow key={position.symbol} position={position} />)}
              {!data.paper?.portfolio.positions.length && <p className="px-5 pb-5 text-[12px] text-fg-3">No open positions.</p>}
            </Panel>
            <Panel hover={false}>
              <PanelHeader eyebrow="Risk controls" title="Paper-only limits" action={
                access?.features.advanced_risk
                  ? <Button disabled={working || !riskDraft} onClick={saveRisk}>Save limits</Button>
                  : <Link href="/billing" className="text-[11px] text-[#9db8f5] hover:underline">Professional required</Link>
              } />
              <div className="grid grid-cols-2 gap-3 px-5 pb-5">
                {([
                  ["maxRiskPerTradePct", "Risk / trade %"],
                  ["maxDailyLossPct", "Daily loss %"],
                  ["maxDrawdownPct", "Max drawdown %"],
                  ["maxPositionPct", "Max position %"],
                  ["minRiskReward", "Minimum R:R"],
                  ["maxExposurePct", "Max exposure %"],
                ] as const).map(([field, label]) => (
                  <label key={field} className="text-[11px] text-fg-3">{label}
                    <input type="number" step="0.1" disabled={!access?.features.advanced_risk} value={riskDraft?.[field] ?? ""} onChange={(event) => setRiskDraft((config) => config ? { ...config, [field]: Number(event.target.value) } : config)} className="mt-1 w-full rounded-lg border hairline bg-black/30 px-2.5 py-2 text-[12px] text-fg disabled:cursor-not-allowed disabled:opacity-50" />
                  </label>
                ))}
                {data.paper?.portfolio.account.halted && <p className="col-span-2 text-[12px] text-down">Risk engine emergency halt is active.</p>}
              </div>
            </Panel>
          </div>
          <Panel hover={false}>
            <PanelHeader eyebrow="Execution ledger" title="Latest simulated orders" />
            <div className="divide-y divide-white/[0.06]">
              {data.paper?.portfolio.orders.slice(0, 20).map((order) => (
                <div key={order.id} className="grid gap-2 px-5 py-3 text-[12px] sm:grid-cols-[1fr_auto_auto_auto] sm:items-center">
                  <span className="text-fg-2">{order.strategy ?? "Strategy"} · {order.side.toUpperCase()} {order.symbol}</span>
                  <span className="num text-fg-2">{order.quantity.toPrecision(5)} @ {fmtPrice(order.price)}</span>
                  <Badge tone={order.status === "filled" ? "emerald" : "crimson"}>{order.status}</Badge>
                  <span className="text-fg-3">{fmtDateTime(order.createdAt)}</span>
                </div>
              ))}
              {!data.paper?.portfolio.orders.length && <p className="px-5 pb-5 text-[12px] text-fg-3">No orders or rejections have been recorded.</p>}
            </div>
          </Panel>
        </>
      )}

      {section === "system" && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="PostgreSQL" value={data.health?.database.state ?? "unknown"} note={data.health?.database.error ?? "Connection readiness"} />
            <Metric label="Binance collector" value={data.health?.collector?.state ?? "not reporting"} note={`Order book sequence ${data.health?.collector?.orderBookSequenceHealthy ? "healthy" : "not confirmed"}`} />
            <Metric label="Paper worker" value={engine?.state ?? "not reporting"} note={engine?.lastCycleAt ? `Last cycle ${fmtDateTime(engine.lastCycleAt)}` : "Separate process required"} />
            <Metric label="Web process CPU / RSS" value={`${fmtValue(data.health?.metrics?.process.cpuPercentOfOneCore)}% / ${fmtBytes(data.health?.metrics?.process.rssBytes)}`} note="Sampled process usage; CPU is relative to one core" />
            <Metric label="Host-reported memory" value={`${fmtBytes(data.health?.metrics?.host.freeMemoryBytes)} free`} note={`${fmtBytes(data.health?.metrics?.host.totalMemoryBytes)} total reported by the runtime`} />
            <Metric label="App filesystem" value={fmtPct(data.health?.metrics?.applicationFilesystem.usedPercent)} note={`${fmtBytes(data.health?.metrics?.applicationFilesystem.availableBytes)} available in the app container filesystem`} />
            <Metric label="PostgreSQL database size" value={fmtBytes(data.health?.metrics?.database.sizeBytes)} note="Current database; excludes backups" />
          </div>
          <Panel hover={false}>
            <PanelHeader eyebrow="Ingestion diagnostics" title="BTCUSDT collector" />
            <div className="grid gap-3 px-5 pb-5 text-[12px] text-fg-2 sm:grid-cols-2">
              <Value label="Last message" value={data.health?.collector?.lastMessageAt ? fmtDateTime(data.health.collector.lastMessageAt) : "—"} />
              <Value label="Reconnect count" value={String(data.health?.collector?.reconnectCount ?? "—")} />
              <Value label="WebSocket status" value={data.health?.collector?.state ?? "—"} />
              <Value label="Last collector error" value={data.health?.collector?.lastError ?? "None reported"} />
            </div>
          </Panel>
          <Panel hover={false}>
            <PanelHeader eyebrow="Recent decisions" title="Persisted paper engine output" />
            <DecisionPanel decisions={data.paper?.decisions ?? []} compact />
          </Panel>
        </>
      )}
    </div>
  );
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <Panel hover={false} className="p-4"><div className="eyebrow">{label}</div><div className="num mt-2 break-words text-[18px] font-medium text-fg">{value}</div><div className="mt-1 text-[11px] text-fg-3">{note}</div></Panel>;
}

function Value({ label, value }: { label: string; value: string }) {
  return <div><div className="eyebrow">{label}</div><div className="mt-1 break-words">{value}</div></div>;
}

function MarketPanel({ candles, analysis, large = false }: { candles: Candle[]; analysis?: Analysis; large?: boolean }) {
  const values = candles.map((candle) => Number(candle.close));
  const latest = values[values.length - 1];
  const prior = values[values.length - 2];
  const delta = latest && prior ? (latest / prior - 1) * 100 : null;
  return (
    <Panel hover={false}>
      <PanelHeader eyebrow={`${analysis?.provenance.candleCount ?? candles.length} persisted candles · ${analysis?.provenance.source ?? "Binance Spot"}`} title="BTCUSDT · 1 minute" action={<Badge tone={analysis?.regime.trend === "bullish" ? "emerald" : analysis?.regime.trend === "bearish" ? "crimson" : "blue"}>{analysis?.regime.label ?? "—"}</Badge>} />
      <div className="flex items-end justify-between px-5">
        <div className="num text-[24px] font-medium text-fg">{latest ? fmtPrice(latest) : "—"}</div>
        <div className={`num text-[12px] ${delta !== null && delta < 0 ? "text-down" : "text-up"}`}>{delta === null ? "—" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}%`}</div>
      </div>
      <div className="px-3 pb-3 pt-2">
        {values.length > 1 ? <LineChart height={large ? 360 : 250} series={[{ data: values, color: "#5b8def", area: true, label: "BTCUSDT close" }]} yFormat={(value) => fmtPrice(value)} xLabels={(index) => `${index + 1}`} /> : <p className="px-2 py-12 text-center text-[12px] text-fg-3">Waiting for persisted candles.</p>}
      </div>
    </Panel>
  );
}

function AnalysisPanel({ analysis }: { analysis: Analysis }) {
  return (
    <Panel hover={false}>
      <PanelHeader eyebrow="Calculated from closed Binance candles" title={`${analysis.regime.label} · confidence ${(analysis.confidence * 100).toFixed(0)}%`} action={<Badge tone="blue">{analysis.provenance.source}</Badge>} />
      <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
        <Value label="Observed close" value={fmtPrice(analysis.observed.close)} />
        <Value label="RSI 14" value={fmtValue(analysis.indicators.rsi14)} />
        <Value label="MACD line / signal" value={`${fmtValue(analysis.indicators.macd.line)} / ${fmtValue(analysis.indicators.macd.signal)}`} />
        <Value label="ATR 14" value={fmtOptionalPrice(analysis.indicators.atr14)} />
        <Value label="EMA 9 / 21 / 50 / 200" value={["9", "21", "50", "200"].map((period) => fmtValue(analysis.indicators.ema[period], 2)).join(" / ")} />
        <Value label="Bollinger lower / upper" value={`${fmtValue(analysis.indicators.bollinger.lower)} / ${fmtValue(analysis.indicators.bollinger.upper)}`} />
        <Value label="Volume vs 20-candle mean" value={`${fmtValue(analysis.indicators.volume.ratio)}x`} />
        <Value label="Momentum 1 / 5 / 20 candles" value={[analysis.indicators.momentum.change1, analysis.indicators.momentum.change5, analysis.indicators.momentum.change20].map((value) => fmtPct(value)).join(" / ")} />
        <Value label="Support / resistance" value={`${fmtOptionalPrice(analysis.indicators.support)} / ${fmtOptionalPrice(analysis.indicators.resistance)}`} />
        <Value label="ATR / realized volatility" value={`${fmtPct(analysis.indicators.volatility.atrPercent)} / ${fmtPct(analysis.indicators.volatility.realizedPercent)}`} />
        <Value label="Average quote volume" value={analysis.indicators.liquidity.averageQuoteVolume20 === null ? "—" : fmtUsd(analysis.indicators.liquidity.averageQuoteVolume20)} />
        <Value label="Best-bid/ask spread" value={analysis.indicators.liquidity.spreadBps === null ? "No current snapshot" : `${analysis.indicators.liquidity.spreadBps.toFixed(2)} bps`} />
      </div>
      <div className="border-t hairline px-5 py-3 text-[11px] text-fg-3">Source table: {analysis.provenance.table} · {analysis.provenance.candleCount} candles · analyzed {fmtDateTime(analysis.provenance.calculatedAt)}</div>
    </Panel>
  );
}

function IndicatorGrid({ analysis }: { analysis?: Analysis }) {
  if (!analysis) return null;
  return <AnalysisPanel analysis={analysis} />;
}

function DecisionPanel({ decisions, compact = false }: { decisions: Decision[]; compact?: boolean }) {
  return (
    <Panel hover={false}>
      <PanelHeader eyebrow="Persisted strategy evaluations" title="Trading decisions" />
      <div className="divide-y divide-white/[0.06]">
        {decisions.slice(0, compact ? 12 : 20).map((decision) => (
          <article key={decision.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2"><Badge tone={decision.action === "BUY" ? "emerald" : decision.action === "SELL" ? "crimson" : "neutral"}>{decision.action}</Badge><span className="text-[12px] text-fg">{decision.strategySlug}</span><Badge>{decision.status}</Badge></div>
              <span className="text-[10px] text-fg-3">{fmtDateTime(decision.createdAt)}</span>
            </div>
            <p className="mt-2 text-[12px] text-fg-2">{decision.explanation || "No decision explanation recorded."}</p>
            {decision.supportingIndicators.length > 0 && <p className="mt-1 text-[11px] text-fg-3">{decision.supportingIndicators.join(" · ")}</p>}
          </article>
        ))}
        {!decisions.length && <p className="px-5 pb-5 text-[12px] text-fg-3">No decisions are persisted yet. Start the paper engine after verifying the separate worker is running.</p>}
      </div>
    </Panel>
  );
}

function BacktestSummary({ result }: { result: BacktestResponse["result"] }) {
  const metrics = result.metrics;
  return (
    <div className="space-y-3 px-5 pb-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Value label="In-sample return" value={fmtPct(metrics.inSample.totalReturnPct)} />
        <Value label="Out-of-sample return" value={fmtPct(metrics.outOfSample.totalReturnPct)} />
        <Value label="Buy-and-hold" value={fmtPct(metrics.buyAndHold.totalReturnPct)} />
        <Value label="Max drawdown / Sharpe" value={`${fmtPct(metrics.inSample.maxDrawdownPct)} / ${fmtValue(metrics.inSample.sharpeRatio)}`} />
        <Value label="Win rate / profit factor" value={`${fmtPct(metrics.inSample.winRatePct)} / ${fmtValue(metrics.inSample.profitFactor)}`} />
        <Value label="Trades / observations" value={`${metrics.inSample.trades} / ${metrics.candles}`} />
        <Value label="Average profit / loss" value={`${fmtUsd(metrics.inSample.averageProfit)} / ${fmtUsd(metrics.inSample.averageLoss)}`} />
        <Value label="Out-of-sample trades" value={String(metrics.outOfSample.trades)} />
      </div>
      <div className="h-px bg-white/[0.07]" />
      <div className="text-[11px] text-fg-3">Execution at next candle open · fees {(metrics.assumptions.feeRate * 100).toFixed(3)}% · slippage {(metrics.assumptions.slippageRate * 100).toFixed(3)}% · stop-loss takes precedence when both stop and target touch.</div>
      {result.equityCurve.length > 1 && <LineChart height={220} series={[{ data: result.equityCurve.map((point) => point.benchmark), color: "rgba(163,171,187,0.7)", dashed: true, label: "Buy and hold" }, { data: result.equityCurve.map((point) => point.strategy), color: "#5b8def", area: true, label: "Strategy" }]} yFormat={(value) => fmtUsd(value, 0)} xLabels={(index) => `${index}`} />}
    </div>
  );
}

function PositionRow({ position }: { position: Position }) {
  return <div className="grid grid-cols-2 gap-3 px-5 pb-5 text-[12px] sm:grid-cols-3"><Value label="Quantity" value={position.qty.toPrecision(6)} /><Value label="Average entry" value={fmtPrice(position.avgCost)} /><Value label="Live mark" value={fmtPrice(position.mark)} /><Value label="Position value" value={fmtUsd(position.value)} /><Value label="Unrealized P&L" value={fmtUsd(position.unrealized)} /><Value label="Return" value={fmtPct(position.pct)} /></div>;
}

function StrategyRuleEditor({ strategy, working, editable, onSave }: { strategy: Strategy; working: boolean; editable: boolean; onSave: (rules: Record<string, number>) => void }) {
  const [rules, setRules] = useState(strategy.rules);
  const labels: Record<string, string> = {
    rsiMin: "RSI entry min",
    rsiMax: "RSI entry max",
    rsiEntry: "RSI oversold",
    rsiExit: "RSI exit",
    volumeRatioMin: "Volume ratio min",
    supportDistancePct: "Support distance %",
    stopAtr: "Stop ATR multiple",
    targetAtr: "Target ATR multiple",
  };
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      {Object.entries(rules).filter(([key, value]) => key in labels && typeof value === "number").map(([key, value]) => (
        <label key={key} className="text-[10px] text-fg-3">{labels[key]}
          <input type="number" step="0.1" disabled={!editable} value={value} onChange={(event) => setRules((current) => ({ ...current, [key]: Number(event.target.value) }))} className="mt-1 block w-24 rounded-md border hairline bg-black/30 px-2 py-1.5 text-[11px] text-fg disabled:cursor-not-allowed disabled:opacity-50" />
        </label>
      ))}
      {editable && <Button disabled={working} onClick={() => onSave(rules)}>Save rules</Button>}
    </div>
  );
}
