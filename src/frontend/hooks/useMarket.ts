"use client";

import { useEffect, useState } from "react";
import { genMarket, type Asset, type Candle, type MarketEvent } from "@backend/lib/market";

/** Client-side market series with a gentle simulated live tick on the last candle. */
export function useMarket(asset: Asset, live = true) {
  const [data, setData] = useState<{ candles: Candle[]; events: MarketEvent[] } | null>(null);

  useEffect(() => {
    setData(genMarket(asset));
  }, [asset]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => {
      setData((d) => {
        if (!d) return d;
        const candles = d.candles.slice();
        const last = { ...candles[candles.length - 1] };
        last.c = last.c * (1 + (Math.random() - 0.5) * 0.0007);
        last.h = Math.max(last.h, last.c);
        last.l = Math.min(last.l, last.c);
        last.v += Math.random() * 4;
        candles[candles.length - 1] = last;
        return { ...d, candles };
      });
    }, 1800);
    return () => clearInterval(t);
  }, [live, asset]);

  return data;
}
