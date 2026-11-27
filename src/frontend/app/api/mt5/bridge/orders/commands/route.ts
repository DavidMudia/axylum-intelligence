import { authenticateMt5BridgeRequest } from "@backend/mt5/bridge-auth";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { readMt5JsonBody } from "@backend/mt5/http";
import { getMt5BridgeCommands } from "@backend/mt5/service";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const parsed = await readMt5JsonBody(request, 16_384);
    if (!parsed.ok) return parsed.response;
    const bridge = await authenticateMt5BridgeRequest(request, parsed.rawBody);
    if (!bridge) return Response.json({ error: "Bridge authentication failed" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(bridge.ownerUserId), "mt5_demo");
    if (denied) return denied;
    if (typeof parsed.value !== "object" || parsed.value === null || Array.isArray(parsed.value)) {
      return Response.json({ error: "Command request must be an object" }, { status: 400 });
    }
    const commands = await getMt5BridgeCommands(bridge);
    return Response.json({ accepted: true, ...commands }, { headers: { "Cache-Control": "no-store" } });
  });
}
