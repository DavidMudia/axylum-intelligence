import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { GET: getStrategies } = await import("@backend/api/strategies");
    return getStrategies(user.id);
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = await request.clone().json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    const entitlement = await resolveEntitlement(user.id);
    if (body.action === "backtest") {
      const dailyLimit = Number(entitlement.features.backtests_per_day);
      if (!Number.isInteger(dailyLimit) || dailyLimit < 1) {
        return Response.json({
          error: "Historical backtesting is not included in the current subscription.",
          code: "subscription_upgrade_required",
          requiredFeature: "backtests_per_day",
          currentPlan: entitlement.planId,
        }, { status: entitlement.status === "unavailable" ? 503 : 402 });
      }
      const forwarded = new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify({ ...body, dailyLimit }),
      });
      const { POST: saveStrategy } = await import("@backend/api/strategies");
      return saveStrategy(forwarded, user.id);
    }
    const denied = featureDenied(entitlement, "strategy_builder");
    if (denied) return denied;
    const { POST: saveStrategy } = await import("@backend/api/strategies");
    return saveStrategy(request, user.id);
  });
}
