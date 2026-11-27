"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Activity, Cable, Clock3, Database, RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader, StatusDot } from "@/components/glass";

type MarketFeedStatus = {
  symbol: string;
  provider: string;
  state: string;
  running: boolean;
  fresh: boolean;
  ageMs: number | null;
  lastMessageAt?: string | null;
  lastEventAt?: string | null;
  lastError?: string | null;
};

function apiError(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function formatAge(ageMs: number | null | undefined) {
  if (ageMs == null || !Number.isFinite(ageMs)) return "Not received";
  if (ageMs < 1000) return "Just now";
  if (ageMs < 60_000) return `${Math.floor(ageMs / 1000)}s ago`;
  return `${Math.floor(ageMs / 60_000)}m ago`;
}

export default function DataSources() {
  const [status, setStatus] = useState<MarketFeedStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/market/status?symbol=BTCUSDT", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load market-data status."));
      if (typeof body !== "object" || body === null || !("state" in body) || !("symbol" in body)) {
        throw new Error("The market-data status response was invalid.");
      }
      setStatus(body as MarketFeedStatus);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load market-data status.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, [refresh]);

  const sourceState = !status
    ? "Unavailable"
    : status.fresh
      ? "Receiving fresh data"
      : status.running
        ? "Running · data is stale"
        : status.state === "not_started"
          ? "Not started"
          : status.state;
  const dotStatus = !status || error ? "down" : status.fresh ? "ok" : status.running ? "degraded" : "down";

  return (
    <>
      <PageHeader
        eyebrow="Data sources"
        title="Collection status"
        description="Live status is read from the market-ingestion service. Other source types are shown only when their collectors are configured."
        actions={
          <Button onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {error && (
        <Panel hover={false} tone="crimson" className="mb-5 p-4">
          <div className="text-[13px] font-medium text-fg">Market-data status unavailable</div>
          <p className="mt-1 text-[12px] text-fg-2">{error}</p>
        </Panel>
      )}

      <Panel hover={false}>
        <PanelHeader eyebrow="Configured collector" title="Binance spot market data" />
        <div className="grid gap-5 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border hairline bg-black/20 p-4">
            <div className="eyebrow">Connection</div>
            <div className="mt-2 flex items-center gap-2 text-[13px] text-fg">
              <StatusDot status={dotStatus} />
              {sourceState}
            </div>
          </div>
          <div className="rounded-xl border hairline bg-black/20 p-4">
            <div className="eyebrow">Market</div>
            <div className="num mt-2 text-[13px] text-fg">{status?.symbol ?? "BTCUSDT"}</div>
          </div>
          <div className="rounded-xl border hairline bg-black/20 p-4">
            <div className="eyebrow">Provider</div>
            <div className="mt-2 text-[13px] text-fg">{status?.provider ?? "Binance Spot"}</div>
          </div>
          <div className="rounded-xl border hairline bg-black/20 p-4">
            <div className="eyebrow">Last message</div>
            <div className="num mt-2 text-[13px] text-fg">{formatAge(status?.ageMs)}</div>
          </div>
        </div>
        {status?.lastError && (
          <div className="mx-5 mb-5 rounded-lg border border-warn/25 bg-warn/[0.06] px-4 py-3 text-[12px] text-fg-2">
            Latest collector error: {status.lastError}
          </div>
        )}
        <div className="flex flex-wrap gap-3 border-t hairline px-5 py-4">
          <Link href="/markets" className="inline-flex items-center gap-2 text-[12.5px] text-[#9db8f5] hover:text-fg">
            <Activity size={14} /> Open market data
          </Link>
          <Link href="/system" className="inline-flex items-center gap-2 text-[12.5px] text-[#9db8f5] hover:text-fg">
            <Database size={14} /> View system health
          </Link>
          {status?.lastMessageAt && (
            <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-fg-3">
              <Clock3 size={12} /> Updated {new Date(status.lastMessageAt).toLocaleString()}
            </span>
          )}
        </div>
      </Panel>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {[
          ["News and sentiment", "No news or sentiment collector is configured."],
          ["On-chain analytics", "No on-chain data source is configured."],
          ["Social signals", "No social-data connector is configured."],
          ["Macroeconomic data", "No macroeconomic-data connector is configured."],
        ].map(([name, description]) => (
          <Panel key={name} hover={false} className="p-5">
            <div className="flex items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border hairline bg-white/[0.03] text-fg-3">
                <Cable size={16} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[13px] font-medium text-fg">{name}</h2>
                  <Badge tone="neutral">Not configured</Badge>
                </div>
                <p className="mt-1.5 text-[12px] leading-relaxed text-fg-3">{description}</p>
              </div>
            </div>
          </Panel>
        ))}
      </div>
    </>
  );
}
