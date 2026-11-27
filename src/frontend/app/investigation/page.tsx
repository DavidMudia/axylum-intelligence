"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { Badge, Button, PageHeader, Panel, PanelHeader } from "@/components/glass";
import type { MarketAnalysis } from "@backend/intelligence/indicators";

type IntelligenceResponse = {
  analysis: MarketAnalysis;
  generatedAt: string;
};

function apiError(body: unknown, fallback: string) {
  if (typeof body === "object" && body !== null && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

function metric(value: number | null, digits = 2) {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export default function Investigation() {
  const [analysis, setAnalysis] = useState<MarketAnalysis | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/intelligence?symbol=BTCUSDT&interval=1m", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok) throw new Error(apiError(body, "Unable to load current market analysis."));
      if (typeof body !== "object" || body === null || !("analysis" in body) || !("generatedAt" in body)) {
        throw new Error("The intelligence response was invalid.");
      }
      const result = body as IntelligenceResponse;
      setAnalysis(result.analysis);
      setGeneratedAt(result.generatedAt);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load current market analysis.");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(initial);
  }, [refresh]);

  const observedMetrics: Array<[string, number]> = analysis
    ? [
        ["Open", analysis.observed.open],
        ["High", analysis.observed.high],
        ["Low", analysis.observed.low],
        ["Close", analysis.observed.close],
        ["Base volume", analysis.observed.baseVolume],
        ["Quote volume", analysis.observed.quoteVolume],
      ]
    : [];
  const indicatorMetrics: Array<[string, number | null]> = analysis
    ? [
        ["RSI · 14", analysis.indicators.rsi14],
        ["MACD histogram", analysis.indicators.macd.histogram],
        ["EMA · 9", analysis.indicators.ema[9]],
        ["EMA · 21", analysis.indicators.ema[21]],
        ["EMA · 50", analysis.indicators.ema[50]],
        ["EMA · 200", analysis.indicators.ema[200]],
        ["Support", analysis.indicators.support],
        ["Resistance", analysis.indicators.resistance],
        ["ATR · 14", analysis.indicators.atr14],
      ]
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Market investigation · BTCUSDT · 1m"
        title="Current analysis evidence"
        description="Indicators and market regime are calculated from stored, closed Binance spot candles. This page does not present them as news, on-chain evidence, or a predictive model."
        actions={
          <Button onClick={() => void refresh()} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing" : "Refresh"}
          </Button>
        }
      />

      {error && (
        <Panel hover={false} tone="crimson" className="mb-5 p-4">
          <div className="text-[13px] font-medium text-fg">Analysis unavailable</div>
          <p className="mt-1 text-[12px] text-fg-2">{error}</p>
          <Link href="/data-sources" className="mt-3 inline-flex items-center gap-1.5 text-[12px] text-[#9db8f5] hover:text-fg">
            Check market-data collection <ArrowRight size={13} />
          </Link>
        </Panel>
      )}

      {analysis ? (
        <div className="space-y-5">
          <Panel hover={false} tone="violet">
            <PanelHeader
              eyebrow="Calculated market regime"
              title={analysis.regime.label}
              action={<Badge tone={analysis.regime.trend === "bullish" ? "emerald" : analysis.regime.trend === "bearish" ? "crimson" : "neutral"}>{analysis.regime.trend}</Badge>}
            />
            <div className="grid gap-4 px-5 pb-5 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <div className="eyebrow">Volatility</div>
                <div className="mt-1.5 text-[13px] capitalize text-fg">{analysis.regime.volatility}</div>
              </div>
              <div>
                <div className="eyebrow">Analysis confidence</div>
                <div className="num mt-1.5 text-[13px] text-fg">{metric(analysis.confidence * 100, 1)}%</div>
              </div>
              <div>
                <div className="eyebrow">Input candles</div>
                <div className="num mt-1.5 text-[13px] text-fg">{analysis.provenance.candleCount}</div>
              </div>
              <div>
                <div className="eyebrow">Source</div>
                <div className="mt-1.5 text-[13px] text-fg">{analysis.provenance.source}</div>
              </div>
            </div>
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel hover={false}>
              <PanelHeader eyebrow="Observed candle" title={`${analysis.symbol} · ${analysis.interval}`} />
              <div className="grid grid-cols-2 gap-x-6 px-5 pb-5 sm:grid-cols-3">
                {observedMetrics.map(([label, value]) => (
                  <div key={label} className="border-b hairline py-3">
                    <div className="eyebrow">{label}</div>
                    <div className="num mt-1 text-[13px] text-fg">{metric(value, 4)}</div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel hover={false}>
              <PanelHeader eyebrow="Technical indicators" title="Values from the latest closed candle" />
              <div className="grid grid-cols-2 gap-x-6 px-5 pb-5 sm:grid-cols-3">
                {indicatorMetrics.map(([label, value]) => (
                  <div key={label} className="border-b hairline py-3">
                    <div className="eyebrow">{label}</div>
                    <div className="num mt-1 text-[13px] text-fg">{metric(value, 4)}</div>
                  </div>
                ))}
              </div>
            </Panel>
          </div>

          <Panel hover={false} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="text-[11.5px] text-fg-3">
              Generated {generatedAt ? new Date(generatedAt).toLocaleString() : "—"} · Candle opened {new Date(String(analysis.candleOpenTime)).toLocaleString()}
            </div>
            <Link href="/markets" className="inline-flex items-center gap-1.5 text-[12px] text-[#9db8f5] hover:text-fg">
              Inspect market data <ArrowRight size={13} />
            </Link>
          </Panel>
        </div>
      ) : (
        !error && (
          <Panel hover={false} className="p-8 text-center text-[13px] text-fg-3">
            {refreshing ? "Loading stored market analysis…" : "No market analysis is available yet."}
          </Panel>
        )
      )}
    </>
  );
}
