import { authenticateMt5BridgeRequest } from "@backend/mt5/bridge-auth";
import { readMt5JsonBody } from "@backend/mt5/http";
import { synchronizeMt5Account } from "@backend/mt5/service";
import { Mt5PayloadError, parseMt5AccountSnapshot } from "@backend/mt5/validation";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const parsed = await readMt5JsonBody(request, 1_000_000);
    if (!parsed.ok) return parsed.response;
    const bridge = await authenticateMt5BridgeRequest(request, parsed.rawBody);
    if (!bridge) return Response.json({ error: "Bridge authentication failed" }, { status: 401 });

    try {
      const snapshot = parseMt5AccountSnapshot(parsed.value);
      const result = await synchronizeMt5Account(bridge, snapshot);
      return Response.json({ accepted: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Mt5PayloadError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }
  });
}
