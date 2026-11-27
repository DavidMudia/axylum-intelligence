import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { riskConfigurations } from "@backend/db/schema";
import { audit } from "@backend/lib/server/state";
import { DEFAULT_RISK_CONFIG, getRiskConfig, PAPER_STARTING_BALANCE } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";

export async function GET(ownerUserId: string) {
  const config = await getRiskConfig(ownerUserId);
  return Response.json({ config, startingBalance: PAPER_STARTING_BALANCE, mode: "paper_only" });
}

export async function POST(request: Request, ownerUserId: string) {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const numericFields = Object.keys(DEFAULT_RISK_CONFIG) as Array<keyof typeof DEFAULT_RISK_CONFIG>;
  const proposed = Object.fromEntries(numericFields.map((key) => [key, Number(body[key])])) as typeof DEFAULT_RISK_CONFIG;
  const bounds: Record<keyof typeof DEFAULT_RISK_CONFIG, [number, number]> = {
    maxRiskPerTradePct: [0.1, 1],
    maxDailyLossPct: [0.5, 5],
    maxDrawdownPct: [2, 20],
    maxPositionPct: [1, 10],
    maxConcurrentPositions: [1, 1],
    minRiskReward: [1, 5],
    maxExposurePct: [5, 30],
    feeRate: [0, 0.01],
    slippageRate: [0, 0.005],
  };
  const invalid = numericFields.find((key) => !Number.isFinite(proposed[key]) || proposed[key] < bounds[key][0] || proposed[key] > bounds[key][1]);
  if (invalid) {
    return Response.json({ error: `${invalid} must be between ${bounds[invalid][0]} and ${bounds[invalid][1]}` }, { status: 400 });
  }
  const now = new Date();
  const updated = await db.update(riskConfigurations).set({ ...proposed, updatedAt: now }).where(and(
    eq(riskConfigurations.ownerUserId, ownerUserId),
  )).returning({ id: riskConfigurations.id });
  if (!updated.length) return Response.json({ error: "Risk configuration not found" }, { status: 404 });
  await audit(ownerUserId, "risk.configuration.updated", "Paper trading risk configuration updated.");
  return Response.json({ config: proposed, updatedAt: now });
}
