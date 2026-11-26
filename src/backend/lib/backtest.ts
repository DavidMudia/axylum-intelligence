import { mulberry32 } from "@shared/format";

export type Condition = { id: string; field: string; op: string; value: string };
export type Rules = { asset: string; model: string; action: "BUY" | "SELL"; conditions: Condition[] };
export type Risk = { maxPositionPct: number; stopLossPct: number; takeProfitPct: number; maxDrawdownPct: number };

export type BacktestResult = {
  equity: number[];
  benchmark: number[];
  metrics: {
    totalReturn: number;
    benchmarkReturn: number;
    sharpe: number;
    maxDrawdown: number;
    winRate: number;
    trades: number;
    profitFactor: number;
    fees: number;
    rejected: number;
  };
};

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic simulated backtest on illustrative data. Stricter conditions yield
 * fewer trades; the independent risk engine rejects a share of signals regardless.
 */
export function runBacktest(rules: Rules, risk: Risk): BacktestResult {
  const rnd = mulberry32(hash(JSON.stringify({ rules, risk })));
  const days = 180;
  const strictness = rules.conditions.length;
  const probCond = rules.conditions.find((c) => c.field === "Prediction probability");
  const threshold = probCond ? Number(probCond.value) || 70 : 60;
  const tradeProb = Math.max(0.03, 0.22 - strictness * 0.035 - (threshold - 55) * 0.003);
  const edge = 0.0006 + (threshold - 55) * 0.00004 + strictness * 0.00012;
  const size = risk.maxPositionPct / 100;
  let eq = 100;
  let bm = 100;
  const equity = [eq];
  const benchmark = [bm];
  let wins = 0;
  let losses = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let trades = 0;
  let rejected = 0;
  let fees = 0;
  let peak = 100;
  let maxDd = 0;
  const dailyRets: number[] = [];
  for (let d = 0; d < days; d++) {
    const mkt = (rnd() - 0.485) * 0.035;
    bm *= 1 + mkt;
    let r = 0;
    if (rnd() < tradeProb) {
      if (rnd() < 0.12) {
        rejected++;
      } else {
        trades++;
        const win = rnd() < 0.5 + edge * 60;
        const mag = (win ? 1 : -1) * (0.008 + rnd() * 0.02);
        const bounded = Math.max(-risk.stopLossPct / 100, Math.min(risk.takeProfitPct / 100, mag * 2));
        const fee = size * 0.002;
        r = size * bounded * 3 - fee;
        fees += fee * eq;
        if (r > 0) {
          wins++;
          grossWin += r;
        } else {
          losses++;
          grossLoss += -r;
        }
      }
    }
    eq *= 1 + r;
    dailyRets.push(r);
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, (peak - eq) / peak);
    equity.push(eq);
    benchmark.push(bm);
  }
  const mean = dailyRets.reduce((s, v) => s + v, 0) / days;
  const sd = Math.sqrt(dailyRets.reduce((s, v) => s + (v - mean) ** 2, 0) / days) || 1e-9;
  return {
    equity,
    benchmark,
    metrics: {
      totalReturn: (eq / 100 - 1) * 100,
      benchmarkReturn: (bm / 100 - 1) * 100,
      sharpe: (mean / sd) * Math.sqrt(365),
      maxDrawdown: maxDd * 100,
      winRate: trades ? (wins / (wins + losses)) * 100 : 0,
      trades,
      profitFactor: grossLoss ? grossWin / grossLoss : grossWin ? 9.99 : 0,
      fees,
      rejected,
    },
  };
}
