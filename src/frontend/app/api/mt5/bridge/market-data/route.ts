import { authenticateMt5BridgeRequest } from "@backend/mt5/bridge-auth";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { readMt5JsonBody } from "@backend/mt5/http";
import { Mt5AccountNotFoundError, Mt5InstrumentNotFoundError, ingestMt5MarketData } from "@backend/mt5/service";
import { Mt5PayloadError, parseMt5MarketDataBatch } from "@backend/mt5/validation";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const parsed = await readMt5JsonBody(request, 5_000_000);
    if (!parsed.ok) return parsed.response;
    const bridge = await authenticateMt5BridgeRequest(request, parsed.rawBody);
    if (!bridge) return Response.json({ error: "Bridge authentication failed" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(bridge.ownerUserId), "mt5_demo");
    if (denied) return denied;

    try {
      const batch = parseMt5MarketDataBatch(parsed.value);
      const result = await ingestMt5MarketData(bridge, batch);
      return Response.json({ accepted: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Mt5PayloadError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Mt5AccountNotFoundError || error instanceof Mt5InstrumentNotFoundError) {
        return Response.json({ error: error.message }, { status: 409 });
      }
      throw error;
    }
  });
}
