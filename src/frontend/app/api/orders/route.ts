import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(user.id), "paper_trading");
    if (denied) return denied;
    const { GET: getOrders } = await import("@backend/api/orders");
    return getOrders(user.id);
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { POST: createOrder } = await import("@backend/api/orders");
    return createOrder(request);
  });
}
