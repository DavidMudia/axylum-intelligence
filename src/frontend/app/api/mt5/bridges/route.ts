import { randomUUID } from "node:crypto";
import { db } from "@backend/db";
import { mt5Bridges } from "@backend/db/schema";
import { featureDenied, resolveEntitlement } from "@backend/lib/server/entitlements";
import { createMt5BridgeToken, hashMt5BridgeToken } from "@backend/mt5/bridge-auth";
import { listMt5Bridges } from "@backend/mt5/service";
import { getSessionUser, isSameOriginRequest, isUniqueConstraintViolation } from "@backend/lib/server/user-auth";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    return Response.json({ bridges: await listMt5Bridges(user.id) }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const denied = featureDenied(await resolveEntitlement(user.id), "mt5_demo");
    if (denied) return denied;

    let body: { name?: unknown };
    try {
      body = await request.json() as { name?: unknown };
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (typeof body.name !== "string") {
      return Response.json({ error: "A bridge name is required" }, { status: 400 });
    }
    const name = body.name.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
      return Response.json({ error: "Bridge name must contain 1 to 100 printable characters" }, { status: 400 });
    }

    const id = randomUUID();
    const token = createMt5BridgeToken();
    try {
      const [bridge] = await db.insert(mt5Bridges).values({
        id,
        ownerUserId: user.id,
        name,
        tokenHash: hashMt5BridgeToken(token),
        status: "offline",
      }).returning({
        id: mt5Bridges.id,
        name: mt5Bridges.name,
        status: mt5Bridges.status,
        createdAt: mt5Bridges.createdAt,
      });
      return Response.json({ bridge, token }, {
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        return Response.json({ error: "A bridge with this name already exists on your account" }, { status: 409 });
      }
      throw error;
    }
  });
}
