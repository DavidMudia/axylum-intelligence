import { mulberry32 } from "@shared/format";

export type Tone = "pos" | "neg" | "neu";

export type Article = {
  id: string;
  title: string;
  source: string;
  sourceType: "Official" | "Wire" | "Publication" | "Community";
  reliability: number;
  minutesAgo: number;
  asset: string;
  entities: string[];
  sentiment: number;
  eventClass: string;
  status: "Confirmed" | "Speculative";
};

// Illustrative records — not real publications.
export const ARTICLES: Article[] = [
  { id: "a1", title: "Regulator proposes stricter custody requirements for digital-asset exchanges", source: "Regulatory Gazette", sourceType: "Official", reliability: 0.96, minutesAgo: 14, asset: "BTC", entities: ["Regulator", "Exchanges", "Bitcoin"], sentiment: -0.72, eventClass: "Regulatory announcement", status: "Confirmed" },
  { id: "a2", title: "Major venue reports unusually large Bitcoin deposits over six hours", source: "Chain Ledger", sourceType: "Publication", reliability: 0.78, minutesAgo: 31, asset: "BTC", entities: ["Exchange", "Bitcoin", "Wallet cluster"], sentiment: -0.48, eventClass: "Exchange inflow", status: "Speculative" },
  { id: "a3", title: "Core developers schedule network upgrade for next quarter", source: "Ethereum Dev Notes", sourceType: "Official", reliability: 0.91, minutesAgo: 52, asset: "ETH", entities: ["Ethereum Foundation", "Ethereum"], sentiment: 0.44, eventClass: "Project development", status: "Confirmed" },
  { id: "a4", title: "Inflation data softer than consensus, rate-cut expectations rise", source: "Macro Wire", sourceType: "Wire", reliability: 0.93, minutesAgo: 88, asset: "BTC", entities: ["Federal Reserve", "CPI", "US Dollar"], sentiment: 0.36, eventClass: "Economic release", status: "Confirmed" },
  { id: "a5", title: "Solana ecosystem transaction count reaches quarterly high", source: "Chain Ledger", sourceType: "Publication", reliability: 0.8, minutesAgo: 121, asset: "SOL", entities: ["Solana", "Validators"], sentiment: 0.52, eventClass: "Network activity", status: "Confirmed" },
  { id: "a6", title: "Traders speculate on delayed ETF decision as filings circulate", source: "r/CryptoMarkets", sourceType: "Community", reliability: 0.38, minutesAgo: 164, asset: "ETH", entities: ["ETF", "Ethereum"], sentiment: -0.12, eventClass: "Market rumour", status: "Speculative" },
  { id: "a7", title: "Exchange announces temporary pause on BNB Chain withdrawals", source: "Exchange Notice", sourceType: "Official", reliability: 0.94, minutesAgo: 205, asset: "BNB", entities: ["Exchange", "BNB Chain"], sentiment: -0.41, eventClass: "Exchange incident", status: "Confirmed" },
];

export const EVENT_FEED = [
  { id: "e1", kind: "Regulatory announcements", count: 3, tone: "neg" as Tone, latest: "Custody rule proposal classified as restrictive", t: "10:27", assets: ["BTC", "ETH"], confidence: 0.92 },
  { id: "e2", kind: "Exchange incidents", count: 1, tone: "neg" as Tone, latest: "Temporary withdrawal pause on BNB Chain", t: "09:06", assets: ["BNB"], confidence: 0.94 },
  { id: "e3", kind: "Large blockchain transactions", count: 7, tone: "neg" as Tone, latest: "11,200 BTC moved to exchange-labelled address", t: "10:11", assets: ["BTC"], confidence: 0.81 },
  { id: "e4", kind: "Economic releases", count: 2, tone: "pos" as Tone, latest: "CPI below consensus; rate expectations shifted", t: "08:30", assets: ["BTC", "ETH", "SOL"], confidence: 0.95 },
  { id: "e5", kind: "Project developments", count: 4, tone: "pos" as Tone, latest: "Scheduled network upgrade confirmed", t: "09:50", assets: ["ETH"], confidence: 0.9 },
  { id: "e6", kind: "Market anomalies", count: 5, tone: "neu" as Tone, latest: "BTC volume at 3.1σ over trailing 24h", t: "10:42", assets: ["BTC"], confidence: 0.84 },
];

export function sentimentSeries(base: string, n = 48) {
  const seed = base.charCodeAt(0) * 13 + base.charCodeAt(1);
  const rnd = mulberry32(seed);
  let news = base === "BTC" ? -0.1 : 0.1;
  let social = news + 0.1;
  const out: Array<{ i: number; news: number; social: number }> = [];
  for (let i = 0; i < n; i++) {
    news = Math.max(-0.95, Math.min(0.95, news * 0.94 + (rnd() - 0.5) * 0.22 + (i === 36 ? -0.45 : 0)));
    social = Math.max(-0.95, Math.min(0.95, social * 0.9 + (rnd() - 0.46) * 0.3 + (i === 40 ? 0.3 : 0)));
    out.push({ i, news, social });
  }
  return out;
}

export type Evidence = {
  id: string;
  title: string;
  source: string;
  kind: string;
  timestamp: string;
  reliability: number;
  contribution: number; // signed share of model output
  stance: "supports" | "contradicts";
  note: string;
};

export const PREDICTION = {
  id: "pred-btc-4h",
  asset: "BTC/USDT",
  horizon: "4 hours",
  model: "xgb-btc-4h",
  version: "v0.7.2",
  stance: "Bearish",
  strength: 72,
  probUp: 0.34,
  decision: "Monitor — await confirmation",
  rejected: "Signal rejected: contradicting technical evidence, reliability gate not met.",
  generatedAt: "10:39:45 UTC",
};

export const EVIDENCE: Evidence[] = [
  { id: "ev1", title: "Regulator proposes stricter custody requirements", source: "Regulatory Gazette", kind: "News · Official", timestamp: "10:27:04", reliability: 0.96, contribution: -0.31, stance: "supports", note: "Event classified as restrictive; affects exchange-listed assets directly." },
  { id: "ev2", title: "11,200 BTC moved to exchange-labelled address", source: "On-chain provider", kind: "On-chain", timestamp: "10:11:36", reliability: 0.81, contribution: -0.24, stance: "supports", note: "Exchange inflow 2.4σ above 30-day mean. Entity label is inferred." },
  { id: "ev3", title: "Volume 3.1σ above trailing 24h distribution", source: "Binance market data", kind: "Market", timestamp: "10:42:18", reliability: 0.99, contribution: -0.17, stance: "supports", note: "High volume on a down move implies active selling pressure." },
  { id: "ev4", title: "RSI(14) at 29 — oversold territory", source: "Technical engine", kind: "Technical", timestamp: "10:40:00", reliability: 0.88, contribution: 0.19, stance: "contradicts", note: "Historically precedes mean reversion on the 4h horizon in ranging regimes." },
  { id: "ev5", title: "Reddit sentiment shifted negative within 90 minutes", source: "Community feed", kind: "Social", timestamp: "10:33:51", reliability: 0.42, contribution: -0.08, stance: "supports", note: "Low-reliability source; weight reduced by reliability gate." },
];

export type Relation = { rel: string; target: string; status: "verified" | "inferred" };

type AssetKit = {
  chain: string;
  regulator: string;
  venue: string;
  onchain: Array<{ label: string; value: string; note: string; tone: Tone }>;
};

const KITS: Record<string, AssetKit> = {
  BTC: { chain: "Bitcoin network", regulator: "Securities regulator", venue: "Binance", onchain: [
    { label: "Exchange net flow", value: "+11.2k BTC", note: "2.4σ above 30d mean", tone: "neg" },
    { label: "Active addresses", value: "812k", note: "−3.1% 24h", tone: "neu" },
    { label: "Whale transfers", value: "7", note: "Above 1,000 BTC", tone: "neg" },
    { label: "Hash rate", value: "612 EH/s", note: "Stable", tone: "pos" },
  ] },
  ETH: { chain: "Ethereum network", regulator: "Securities regulator", venue: "Coinbase", onchain: [
    { label: "Exchange net flow", value: "−4.8k ETH", note: "Outflow, accumulation signal", tone: "pos" },
    { label: "Active addresses", value: "546k", note: "+1.2% 24h", tone: "pos" },
    { label: "Staked supply", value: "27.6%", note: "+0.1% 7d", tone: "pos" },
    { label: "Gas (median)", value: "14 gwei", note: "Low congestion", tone: "neu" },
  ] },
  SOL: { chain: "Solana network", regulator: "Securities regulator", venue: "Binance", onchain: [
    { label: "Exchange net flow", value: "−0.9M SOL", note: "Outflow", tone: "pos" },
    { label: "Transactions", value: "52M / day", note: "Quarterly high", tone: "pos" },
    { label: "Validators", value: "1,780", note: "Stable", tone: "neu" },
    { label: "DEX volume", value: "$2.1B", note: "+18% 24h", tone: "pos" },
  ] },
  BNB: { chain: "BNB Chain", regulator: "Securities regulator", venue: "Binance", onchain: [
    { label: "Exchange net flow", value: "+120k BNB", note: "Withdrawal pause effect", tone: "neg" },
    { label: "Active addresses", value: "1.4M", note: "−0.8% 24h", tone: "neu" },
    { label: "Burn (quarterly)", value: "1.6M BNB", note: "Scheduled", tone: "pos" },
    { label: "Bridge volume", value: "$310M", note: "Stable", tone: "neu" },
  ] },
};

export function assetIntel(base: string) {
  const kit = KITS[base] ?? KITS.BTC;
  const news = ARTICLES.filter((a) => a.asset === base);
  const fallback = ARTICLES.filter((a) => a.entities.length).slice(0, 2);
  const probs: Record<string, number[]> = {
    BTC: [0.44, 0.39, 0.34, 0.41],
    ETH: [0.53, 0.56, 0.61, 0.58],
    SOL: [0.57, 0.62, 0.66, 0.6],
    BNB: [0.48, 0.47, 0.45, 0.5],
  };
  const p = probs[base] ?? probs.BTC;
  const horizons = ["15 min", "1 hour", "4 hours", "24 hours"];
  const models = ["logreg-15m", "xgb-1h", "xgb-4h", "xgb-24h"];
  return {
    news: news.length ? news : fallback,
    onchain: kit.onchain,
    predictions: horizons.map((h, i) => ({
      horizon: h,
      model: models[i],
      probUp: p[i],
      decision: p[i] > 0.62 ? "Bullish lean" : p[i] < 0.4 ? "Bearish lean" : "Inconclusive",
    })),
    relations: [
      { rel: "tradedOn", target: kit.venue, status: "verified" },
      { rel: "runsOn", target: kit.chain, status: "verified" },
      { rel: "affectedBy", target: kit.regulator, status: base === "BTC" ? "verified" : "inferred" },
      { rel: "correlatedWith", target: base === "BTC" ? "Ethereum" : "Bitcoin", status: "inferred" },
    ] as Relation[],
  };
}
