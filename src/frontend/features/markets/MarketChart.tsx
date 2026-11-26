"use client";

import { useState } from "react";
import { CandleChart, type Indicators } from "@/components/charts/CandleChart";
import { AnimatedNumber, Delta, Panel, Segmented } from "@/components/glass";
import { cn, fmtPrice } from "@/lib/format";
import { useMarket } from "@/hooks/useMarket";
import type { Asset } from "@backend/lib/market";

const CHIPS: Array<{ key: keyof Indicators; label: string }> = [
  { key: "volume", label: "Volume" },
  { key: "ma", label: "MA 20/50" },
  { key: "rsi", label: "RSI" },
  { key: "macd", label: "MACD" },
  { key: "predictions", label: "Forecasts" },
  { key: "events", label: "Events" },
];

export function MarketChart({
  asset,
  actions,
  height = 380,
  className,
}: {
  asset: Asset;
  actions?: React.ReactNode;
  height?: number;
  className?: string;
}) {
  const data = useMarket(asset);
  const [ind, setInd] = useState<Indicators>({ volume: true, ma: true, rsi: false, macd: false, predictions: true, events: true });
  const [range, setRange] = useState<"48" | "96" | "140">("96");

  const last = data?.candles[data.candles.length - 1];
  const ref = data ? data.candles[data.candles.length - 25] : undefined;
  const change = last && ref ? ((last.c - ref.c) / ref.c) * 100 : asset.change24h;

  return (
    <Panel className={cn("flex flex-col", className)} hover={false}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 pt-4">
        <div className="flex items-end gap-4">
          <div>
            <div className="eyebrow">{asset.name} · 1H</div>
            <div className="mt-1 flex items-baseline gap-3">
              <span className="text-[15px] font-medium text-fg">{asset.symbol}</span>
              <AnimatedNumber value={last?.c ?? asset.price} format={(v) => fmtPrice(v)} className="text-[24px] font-medium text-fg" />
              <Delta value={change} className="text-[13px]" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {actions}
          <Segmented
            size="sm"
            value={range}
            onChange={setRange}
            options={[
              { key: "48", label: "2D" },
              { key: "96", label: "4D" },
              { key: "140", label: "6D" },
            ]}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 px-5 pt-3.5">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            onClick={() => setInd((s) => ({ ...s, [c.key]: !s[c.key] }))}
            aria-pressed={ind[c.key]}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              ind[c.key] ? "border-accent/35 bg-accent/10 text-[#9db8f5]" : "border-white/8 text-fg-3 hover:text-fg-2",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="px-3 pb-3 pt-3">
        {data ? (
          <CandleChart candles={data.candles} events={data.events} indicators={ind} visible={Number(range)} height={height} />
        ) : (
          <div style={{ height: height + 24 }} className="grid place-items-center text-[12.5px] text-fg-3">
            Loading market data…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t hairline px-5 py-2.5 text-[11px] text-fg-3">
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3 bg-accent" /> MA 20
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-px w-3 bg-violet" /> MA 50
        </span>
        <span className="flex items-center gap-1.5">
          <span className="grid h-3.5 w-3.5 place-items-center rounded border border-violet/50 bg-violet/15">
            <span className="h-1 w-1 rounded-full bg-fg-2" />
          </span>
          Detected event
        </span>
        <span>▲▼ Model forecast (green correct · red incorrect · hollow pending)</span>
        <span className="ml-auto">Illustrative series</span>
      </div>
    </Panel>
  );
}
