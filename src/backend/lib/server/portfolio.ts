import { db } from "@backend/db";
import { paperOrders } from "@backend/db/schema";
import { asc } from "drizzle-orm";
import { ASSETS } from "@backend/lib/market";

export const STARTING_EQUITY = 100_000;
export const LIMITS = {
  maxOrderPct: 0.1,
  maxExposurePct: 0.3,
  feeRate: 0.001,
  slippageRate: 0.0005,
};

export type Position = {
  symbol: string;
  qty: number;
  avgCost: number;
  mark: number;
  value: number;
  unrealized: number;
  pct: number;
};

export async function ensureSeed() {
  const existing = await db.select({ id: paperOrders.id }).from(paperOrders).limit(1);
  if (existing.length) return;
  const now = Date.now();
  const mk = (symbol: string, side: string, quantity: number, price: number, mins: number, status = "filled", reason: string | null = null) => ({
    symbol,
    side,
    quantity,
    price,
    fee: status === "filled" ? quantity * price * LIMITS.feeRate : 0,
    slippage: status === "filled" ? quantity * price * LIMITS.slippageRate : 0,
    status,
    reason,
    strategy: "Momentum + sentiment",
    riskChecks: status === "filled" ? 6 : 4,
    createdAt: new Date(now - mins * 60_000),
  });
  await db.insert(paperOrders).values([
    mk("BTC/USDT", "buy", 0.1, 66850, 1440),
    mk("ETH/USDT", "buy", 1.5, 3420, 1100),
    mk("SOL/USDT", "buy", 40, 161.2, 600),
    mk("ETH/USDT", "sell", 0.5, 3498, 240),
    mk("BTC/USDT", "buy", 2, 67100, 95, "rejected", "Notional exceeds 10% single-order limit"),
  ]);
}

export async function getPortfolio() {
  await ensureSeed();
  const orders = await db.select().from(paperOrders).orderBy(asc(paperOrders.id));
  const pos = new Map<string, { qty: number; cost: number }>();
  let cash = STARTING_EQUITY;
  let realized = 0;
  let fees = 0;
  let slip = 0;
  let filled = 0;
  let rejected = 0;
  for (const o of orders) {
    if (o.status !== "filled") {
      rejected++;
      continue;
    }
    filled++;
    fees += o.fee;
    slip += o.slippage;
    const p = pos.get(o.symbol) ?? { qty: 0, cost: 0 };
    const notional = o.quantity * o.price;
    if (o.side === "buy") {
      cash -= notional + o.fee;
      p.qty += o.quantity;
      p.cost += notional;
    } else {
      const avg = p.qty ? p.cost / p.qty : o.price;
      realized += (o.price - avg) * o.quantity - o.fee;
      cash += notional - o.fee;
      p.cost -= avg * o.quantity;
      p.qty -= o.quantity;
    }
    pos.set(o.symbol, p);
  }
  const positions: Position[] = [];
  for (const [symbol, p] of pos) {
    if (p.qty <= 1e-9) continue;
    const mark = ASSETS.find((a) => a.symbol === symbol)?.price ?? 0;
    const avgCost = p.cost / p.qty;
    const value = p.qty * mark;
    positions.push({ symbol, qty: p.qty, avgCost, mark, value, unrealized: (mark - avgCost) * p.qty, pct: ((mark - avgCost) / avgCost) * 100 });
  }
  const exposure = positions.reduce((s, p) => s + p.value, 0);
  const unrealized = positions.reduce((s, p) => s + p.unrealized, 0);
  const equity = cash + exposure;
  return {
    orders: [...orders].reverse(),
    positions,
    summary: { equity, cash, exposure, exposurePct: (exposure / equity) * 100, unrealized, realized, fees, slippage: slip, filled, rejected, startingEquity: STARTING_EQUITY },
  };
}
