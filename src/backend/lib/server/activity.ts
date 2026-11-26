import { db } from "@backend/db";
import { activityEvents } from "@backend/db/schema";
import { desc } from "drizzle-orm";

type Tpl = { kind: string; title: string; detail: string; status: string; asset?: string };

// Illustrative records produced by the simulator. They are not live market observations.
const POOL: Tpl[] = [
  { kind: "anomaly", title: "Market anomaly", detail: "Unusual BTC trading volume detected.", status: "Investigating", asset: "BTC" },
  { kind: "article", title: "New information", detail: "New regulatory article collected and classified.", status: "Processed", asset: "BTC" },
  { kind: "graph", title: "Knowledge graph", detail: "12 new relationships extracted.", status: "Indexed" },
  { kind: "prediction", title: "Prediction", detail: "BTC four-hour forecast updated.", status: "Awaiting confirmation", asset: "BTC" },
  { kind: "entity", title: "Entity extracted", detail: "Exchange “Binance” linked to withdrawal-pause event.", status: "Verified", asset: "BNB" },
  { kind: "evaluation", title: "Model evaluation", detail: "xgb-eth-4h walk-forward evaluation completed.", status: "Completed", asset: "ETH" },
  { kind: "rejected", title: "Signal rejected", detail: "BUY ETH rejected: model reliability gate not met.", status: "Rejected", asset: "ETH" },
  { kind: "article", title: "New information", detail: "Macro release ingested; 3 entities extracted.", status: "Processed" },
  { kind: "graph", title: "Knowledge graph", detail: "Inferred link Exchange inflow → BTC pressure flagged as hypothesis.", status: "Unverified", asset: "BTC" },
  { kind: "anomaly", title: "Market anomaly", detail: "SOL spread widened beyond 2σ.", status: "Monitoring", asset: "SOL" },
  { kind: "rejected", title: "Signal rejected", detail: "SELL BTC rejected: contradicting technical evidence.", status: "Rejected", asset: "BTC" },
  { kind: "prediction", title: "Prediction", detail: "ETH 1-hour forecast updated: 56% upward probability.", status: "Published", asset: "ETH" },
];

export async function getActivity() {
  const latest = await db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(1);
  if (!latest.length) {
    const now = Date.now();
    await db.insert(activityEvents).values(
      POOL.slice(0, 10).map((t, i) => ({ ...t, asset: t.asset ?? null, createdAt: new Date(now - (i + 1) * 47_000) })),
    );
  } else if (Date.now() - latest[0].createdAt.getTime() > 9_000) {
    const t = POOL[Math.floor(Math.random() * POOL.length)];
    await db.insert(activityEvents).values({ ...t, asset: t.asset ?? null });
  }
  return db.select().from(activityEvents).orderBy(desc(activityEvents.createdAt)).limit(24);
}
