import { getSessionUser } from "@backend/lib/server/user-auth";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { listMt5TradingData } from "@backend/mt5/service";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ accountId: string }> },
) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(user.id), "mt5_demo");
    if (denied) return denied;
    const { accountId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return Response.json({ error: "Invalid MT5 account ID" }, { status: 400 });
    }
    const data = await listMt5TradingData(user.id, accountId);
    if (!data) return Response.json({ error: "MT5 account not found" }, { status: 404 });
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  });
}
