import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { mt5Accounts, mt5Bridges } from "@backend/db/schema";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { createMt5BridgeToken, hashMt5BridgeToken } from "@backend/mt5/bridge-auth";
import { getSessionUser, isSameOriginRequest } from "@backend/lib/server/user-auth";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ bridgeId: string }> },
) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { bridgeId } = await context.params;
    if (!UUID_PATTERN.test(bridgeId)) return Response.json({ error: "Invalid bridge ID" }, { status: 400 });

    let body: { action?: unknown };
    try {
      body = await request.json() as { action?: unknown };
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (body.action !== "rotate" && body.action !== "disconnect") {
      return Response.json({ error: "Action must be rotate or disconnect" }, { status: 400 });
    }
    if (body.action === "rotate") {
      const denied = featureDenied(await resolveEntitlement(user.id), "mt5_demo");
      if (denied) return denied;
    }

    const token = body.action === "rotate" ? createMt5BridgeToken() : null;
    const bridge = await db.transaction(async (tx) => {
      const [updated] = await tx.update(mt5Bridges).set({
        tokenHash: hashMt5BridgeToken(token ?? createMt5BridgeToken()),
        status: "offline",
        lastHeartbeatAt: null,
        lastError: body.action === "disconnect" ? "Bridge access disconnected by account owner" : null,
        updatedAt: new Date(),
      }).where(and(
        eq(mt5Bridges.id, bridgeId),
        eq(mt5Bridges.ownerUserId, user.id),
      )).returning({
        id: mt5Bridges.id,
        name: mt5Bridges.name,
        status: mt5Bridges.status,
      });
      if (!updated) return null;
      await tx.update(mt5Accounts).set({
        connected: false,
        updatedAt: new Date(),
      }).where(eq(mt5Accounts.bridgeId, bridgeId));
      return updated;
    });
    if (!bridge) return Response.json({ error: "MT5 bridge not found" }, { status: 404 });

    return Response.json(body.action === "rotate"
      ? { bridge, token }
      : { bridge, disconnected: true }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}
