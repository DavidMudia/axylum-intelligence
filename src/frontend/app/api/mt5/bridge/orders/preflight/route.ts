import { authenticateMt5BridgeRequest } from "@backend/mt5/bridge-auth";
import { readMt5JsonBody } from "@backend/mt5/http";
import { Mt5OrderRequestError, validateMt5BridgePreflight } from "@backend/mt5/service";
import { Mt5PayloadError, parseMt5PreflightResult } from "@backend/mt5/validation";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const parsed = await readMt5JsonBody(request, 16_384);
    if (!parsed.ok) return parsed.response;
    const bridge = await authenticateMt5BridgeRequest(request, parsed.rawBody);
    if (!bridge) return Response.json({ error: "Bridge authentication failed" }, { status: 401 });
    try {
      return Response.json({
        accepted: true,
        ...(await validateMt5BridgePreflight(bridge, parseMt5PreflightResult(parsed.value))),
      }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Mt5PayloadError) return Response.json({ error: error.message }, { status: 400 });
      if (error instanceof Mt5OrderRequestError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }
  });
}
