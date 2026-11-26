import { authenticateMt5BridgeRequest } from "@backend/mt5/bridge-auth";
import { readMt5JsonBody } from "@backend/mt5/http";
import { recordMt5BridgeHeartbeat } from "@backend/mt5/service";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const parsed = await readMt5JsonBody(request, 16_384);
    if (!parsed.ok) return parsed.response;
    const bridge = await authenticateMt5BridgeRequest(request, parsed.rawBody);
    if (!bridge) return Response.json({ error: "Bridge authentication failed" }, { status: 401 });

    const body = parsed.value;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return Response.json({ error: "Heartbeat body must be an object" }, { status: 400 });
    }
    const terminalVersion = "terminalVersion" in body && typeof body.terminalVersion === "string"
      ? body.terminalVersion.slice(0, 128)
      : null;
    await recordMt5BridgeHeartbeat(bridge, terminalVersion);
    return Response.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
  });
}
