import { mulberry32 } from "@shared/format";

export type Health = "ok" | "degraded" | "down" | "idle";

export const SERVICES: Array<{ key: string; label: string; status: Health; detail: string }> = [
  { key: "api", label: "API connectivity", status: "ok", detail: "42 ms median" },
  { key: "ingest", label: "Data ingestion", status: "ok", detail: "5 / 5 collectors" },
  { key: "db", label: "Database", status: "ok", detail: "PostgreSQL" },
  { key: "graph", label: "Knowledge graph", status: "ok", detail: "4,218 triples" },
  { key: "model", label: "Model inference", status: "ok", detail: "4 models serving" },
  { key: "exchange", label: "Exchange connection", status: "idle", detail: "Read-only market data" },
];

export type Source = {
  id: string;
  name: string;
  info: string;
  channel: string;
  status: "Connected" | "Degraded";
  lastSuccess: string;
  requests: number;
  errorRate: number;
  freshness: number; // seconds
  latency: number; // ms
  rateLimit: number; // 0-100
  spark: number[];
};

function spark(seed: number, base: number) {
  const r = mulberry32(seed);
  return Array.from({ length: 24 }, () => base * (0.7 + r() * 0.6));
}

// Proposed connectors, not confirmed account connections.
export const SOURCES: Source[] = [
  { id: "binance", name: "Binance API", info: "Market prices, order book, funding", channel: "Market data", status: "Connected", lastSuccess: "2s ago", requests: 184200, errorRate: 0.02, freshness: 1.2, latency: 38, rateLimit: 41, spark: spark(1, 80) },
  { id: "chain", name: "Blockchain provider", info: "Wallet flows, exchange inflows", channel: "On-chain", status: "Connected", lastSuccess: "14s ago", requests: 22400, errorRate: 0.4, freshness: 14, latency: 212, rateLimit: 63, spark: spark(2, 40) },
  { id: "news", name: "News API", info: "Financial news, official releases", channel: "News", status: "Connected", lastSuccess: "41s ago", requests: 8600, errorRate: 0.9, freshness: 41, latency: 340, rateLimit: 28, spark: spark(3, 25) },
  { id: "reddit", name: "Reddit API", info: "Community discussion", channel: "Social", status: "Degraded", lastSuccess: "3m ago", requests: 12900, errorRate: 4.7, freshness: 183, latency: 690, rateLimit: 88, spark: spark(4, 30) },
  { id: "macro", name: "Economic data", info: "Inflation, rates, employment", channel: "Macro", status: "Connected", lastSuccess: "9m ago", requests: 310, errorRate: 0, freshness: 540, latency: 150, rateLimit: 6, spark: spark(5, 8) },
];

export const PIPELINE = [
  { key: "source", label: "Source", count: "5 connectors", throughput: "3.1k msg/min", errors: 0, detail: "Authenticated, rate-limited connections to approved providers. Credentials remain server-side.", log: ["binance · stream open (btcusdt@kline_1m)", "news · poll ok (23 items)", "reddit · 429 rate limit, backing off 30s"] },
  { key: "collector", label: "Collector", count: "5 workers", throughput: "3.1k msg/min", errors: 2, detail: "Retrieves raw payloads (JSON, XML, CSV, HTML). Untrusted input is never executed or interpreted as instructions.", log: ["worker-news · fetched 23 articles", "worker-reddit · retry 2/3", "worker-chain · 412 tx parsed"] },
  { key: "normalizer", label: "Normalizer", count: "UTC aligned", throughput: "3.0k rec/min", errors: 0, detail: "Maps heterogeneous payloads to a common schema, aligns timestamps to UTC and deduplicates records.", log: ["dedupe · 41 duplicates dropped", "schema · v3 mapping applied", "clock skew · +0.4s corrected"] },
  { key: "validator", label: "Validator", count: "12 rules", throughput: "2.9k rec/min", errors: 7, detail: "Range checks, schema validation, source reliability scoring and outlier quarantine.", log: ["quarantine · 3 price outliers", "schema · 4 records missing timestamp", "reliability · source r/CryptoMarkets 0.38"] },
  { key: "storage", label: "Storage", count: "PG + graph", throughput: "2.9k rec/min", errors: 0, detail: "Relational records in PostgreSQL, time-series observations, and RDF triples with provenance.", log: ["pg · 2,884 rows committed", "graph · 12 triples inserted", "snapshot · integrity verified"] },
  { key: "intel", label: "Intelligence", count: "NLP + ML", throughput: "640 evt/min", errors: 0, detail: "Entity extraction, sentiment, event classification, feature generation and model inference.", log: ["nlp · 7 entities extracted", "features · 38 computed for BTC", "model · xgb-btc-4h inference 19ms"] },
];

export const MODELS = [
  { id: "xgb-btc-4h", asset: "BTC/USDT", horizon: "4h", algo: "XGBoost", version: "v0.7.2", status: "Serving", trainedOn: "2023-01 → 2025-09", evaluated: "2 days ago", accuracy: 0.564, precision: 0.58, recall: 0.54, brier: 0.241, baselineBrier: 0.25, profitFactor: 1.18 },
  { id: "xgb-btc-1h", asset: "BTC/USDT", horizon: "1h", algo: "XGBoost", version: "v0.6.9", status: "Serving", trainedOn: "2023-01 → 2025-09", evaluated: "2 days ago", accuracy: 0.537, precision: 0.54, recall: 0.52, brier: 0.248, baselineBrier: 0.25, profitFactor: 1.04 },
  { id: "logreg-btc-15m", asset: "BTC/USDT", horizon: "15m", algo: "Logistic regression", version: "v0.4.1", status: "Serving", trainedOn: "2024-03 → 2025-09", evaluated: "5 days ago", accuracy: 0.512, precision: 0.51, recall: 0.5, brier: 0.2497, baselineBrier: 0.25, profitFactor: 0.97 },
  { id: "xgb-eth-4h", asset: "ETH/USDT", horizon: "4h", algo: "XGBoost", version: "v0.5.0", status: "Shadow", trainedOn: "2023-06 → 2025-09", evaluated: "1 day ago", accuracy: 0.548, precision: 0.55, recall: 0.57, brier: 0.244, baselineBrier: 0.25, profitFactor: 1.09 },
];

export const FEATURES = [
  { name: "News sentiment (4h)", value: 0.24 },
  { name: "Exchange inflows", value: 0.19 },
  { name: "Trading volume z-score", value: 0.17 },
  { name: "RSI (14)", value: 0.14 },
  { name: "Realised volatility", value: 0.11 },
  { name: "Social sentiment", value: 0.07 },
  { name: "Funding rate", value: 0.05 },
  { name: "Macro surprise index", value: 0.03 },
];

export const REGIMES = [
  { name: "Trending", accuracy: 0.59, n: 412 },
  { name: "Ranging", accuracy: 0.55, n: 688 },
  { name: "High volatility", accuracy: 0.51, n: 233 },
  { name: "Event-driven", accuracy: 0.62, n: 96 },
];

// Reliability diagram: predicted probability vs observed frequency
export const CALIBRATION = [
  [0.1, 0.14], [0.2, 0.22], [0.3, 0.33], [0.4, 0.43], [0.5, 0.49], [0.6, 0.55], [0.7, 0.62], [0.8, 0.66], [0.9, 0.71],
];

export function predictionHistory(n = 36) {
  const r = mulberry32(99);
  return Array.from({ length: n }, (_, i) => {
    const p = 0.3 + r() * 0.5;
    const actual = r() < p * 0.9 + 0.05 ? 1 : 0;
    return { i, p, actual, ret: (r() - 0.46) * 3.2 };
  });
}

export const AUDIT_SEED = [
  { actor: "system", action: "credential.verify", detail: "Binance read-only key verified (scopes: market-data)", severity: "info" },
  { actor: "operator", action: "auth.login", detail: "Interactive login from trusted device", severity: "info" },
  { actor: "system", action: "request.denied", detail: "Order submission blocked: live trading disabled", severity: "warn" },
  { actor: "system", action: "source.degraded", detail: "Reddit API error rate 4.7% exceeded threshold", severity: "warn" },
];
