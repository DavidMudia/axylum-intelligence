import { getSessionUser } from "@backend/lib/server/user-auth";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { listMt5Accounts } from "@backend/mt5/service";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(user.id), "mt5_demo");
    if (denied) return denied;
    const accounts = await listMt5Accounts(user.id);
    return Response.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
  });
}
