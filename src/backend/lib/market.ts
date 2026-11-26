import { mulberry32 } from "@shared/format";

export type Asset = {
  symbol: string;
  base: string;
  name: string;
  price: number;
  change24h: number;
  volume24h: number;
  seed: number;
  sentiment: number; // -1..1
};

// Illustrative reference values. Not live quotations.
export const ASSETS: Asset[] = [
  { symbol: "BTC/USDT", base: "BTC", name: "Bitcoin", price: 67420.5, change24h: -1.84, volume24h: 28.4e9, seed: 11, sentiment: -0.31 },
  { symbol: "ETH/USDT", base: "ETH", name: "Ethereum", price: 3512.18, change24h: 0.92, volume24h: 14.1e9, seed: 23, sentiment: 0.12 },
  { symbol: "SOL/USDT", base: "SOL", name: "Solana", price: 168.74, change24h: 3.41, volume24h: 3.2e9, seed: 37, sentiment: 0.38 },
  { symbol: "BNB/USDT", base: "BNB", name: "BNB", price: 596.3, change24h: -0.42, volume24h: 1.1e9, seed: 51, sentiment: 0.04 },
];

export function getAsset(symbol: string) {
  return ASSETS.find((a) => a.symbol === symbol || a.base === symbol) ?? ASSETS[0];
}

export type Candle = { t: number; o: number; h: number; l: number; c: number; v: number };

export type MarketEvent = {
  index: number;
  kind: "Regulatory" | "Exchange" | "On-chain" | "Macro" | "Anomaly" | "Project";
  title: string;
  detail: string;
  tone: "neg" | "pos" | "neu";
  leadMin: number;
  movePct: number;
};

const EVENT_TEMPLATES: Array<Pick<MarketEvent, "kind" | "title" | "detail" | "tone">> = [
  { kind: "Regulatory", title: "Regulatory announcement", detail: "Official statement on digital-asset custody rules classified as restrictive.", tone: "neg" },
  { kind: "On-chain", title: "Large exchange inflow", detail: "Wallet cluster moved a significant balance onto a major exchange.", tone: "neg" },
  { kind: "Macro", title: "Economic release", detail: "Inflation print came in below consensus; risk assets re-priced.", tone: "pos" },
  { kind: "Anomaly", title: "Volume anomaly", detail: "Traded volume exceeded 3.1σ of the trailing 24h distribution.", tone: "neu" },
  { kind: "Exchange", title: "Exchange incident", detail: "Temporary withdrawal pause reported on a top-five venue.", tone: "neg" },
  { kind: "Project", title: "Protocol development", detail: "Core developers announced a scheduled network upgrade.", tone: "pos" },
];

export function genMarket(asset: Asset, n = 140, intervalMs = 3600_000, anchor = Date.now()) {
  const rnd = mulberry32(asset.seed * 7919);
  const gauss = () => {
    let u = 0;
    let v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // Pick event candles first, then inject shocks at those points.
  const eventIdx = [22, 51, 78, 104, 127].map((i) => i + Math.floor(rnd() * 4));
  const events: MarketEvent[] = eventIdx.map((index, k) => {
    const tpl = EVENT_TEMPLATES[(k + asset.seed) % EVENT_TEMPLATES.length];
    return { ...tpl, index, leadMin: 12 + Math.floor(rnd() * 34), movePct: 0 };
  });

  const baseVol = 0.0048;
  // Shared market factor so assets co-move (illustrative correlation structure).
  const crnd = mulberry32(777);
  const common = Array.from({ length: n }, () => {
    const u = crnd() || 0.5;
    const v = crnd() || 0.5;
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  });
  const beta = asset.base === "SOL" ? 1.4 : asset.base === "ETH" ? 1.15 : asset.base === "BNB" ? 0.8 : 1;
  let price = 100;
  const raw: Candle[] = [];
  const t0 = Math.floor(anchor / intervalMs) * intervalMs - (n - 1) * intervalMs;
  let drift = 0;
  for (let i = 0; i < n; i++) {
    drift = drift * 0.92 + gauss() * 0.0006;
    const ev = events.find((e) => e.index === i);
    const shock = ev ? (ev.tone === "neg" ? -1 : ev.tone === "pos" ? 1 : rnd() > 0.5 ? 1 : -1) * (0.016 + rnd() * 0.012) : 0;
    const open = price;
    const ret = drift + gauss() * baseVol * 0.7 + common[i] * baseVol * 0.8 * beta + shock;
    const close = open * (1 + ret);
    const wick = Math.abs(gauss()) * baseVol * 0.7;
    const high = Math.max(open, close) * (1 + wick);
    const low = Math.min(open, close) * (1 - Math.abs(gauss()) * baseVol * 0.7);
    const volume = (900 + Math.abs(ret) * 120000 + rnd() * 500) * (ev ? 2.4 : 1);
    raw.push({ t: t0 + i * intervalMs, o: open, h: high, l: low, c: close, v: volume });
    price = close;
  }
  const scale = asset.price / raw[raw.length - 1].c;
  const candles = raw.map((c) => ({
    t: c.t,
    o: c.o * scale,
    h: c.h * scale,
    l: c.l * scale,
    c: c.c * scale,
    v: c.v * (asset.base === "BTC" ? 1 : asset.base === "ETH" ? 9 : asset.base === "SOL" ? 220 : 60),
  }));
  events.forEach((e) => {
    const c = candles[e.index];
    e.movePct = ((c.c - c.o) / c.o) * 100;
  });
  return { candles, events };
}

export function sma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : v * k + out[i - 1] * (1 - k)));
  return out;
}

export function rsi(closes: number[], period = 14): Array<number | null> {
  const out: Array<number | null> = new Array(closes.length).fill(null);
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = Math.max(d, 0);
    const l = Math.max(-d, 0);
    if (i <= period) {
      gain += g;
      loss += l;
      if (i === period) {
        gain /= period;
        loss /= period;
        out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
      }
    } else {
      gain = (gain * (period - 1) + g) / period;
      loss = (loss * (period - 1) + l) / period;
      out[i] = loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
    }
  }
  return out;
}

export function macd(closes: number[]) {
  const fast = ema(closes, 12);
  const slow = ema(closes, 26);
  const line = closes.map((_, i) => fast[i] - slow[i]);
  const signal = ema(line, 9);
  const hist = line.map((v, i) => v - signal[i]);
  return { line, signal, hist };
}

export function pearson(a: number[], b: number[]) {
  const n = Math.min(a.length, b.length);
  const ma = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
  const mb = b.slice(0, n).reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

export function returns(candles: Candle[]) {
  return candles.slice(1).map((c, i) => Math.log(c.c / candles[i].c));
}
