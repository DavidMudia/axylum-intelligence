import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { exchangeConnections } from "@backend/db/schema";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { connectionId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(connectionId)) {
      return Response.json({ error: "Invalid connection ID" }, { status: 400 });
    }
    const deleted = await db.delete(exchangeConnections).where(and(
      eq(exchangeConnections.id, connectionId),
      eq(exchangeConnections.userId, user.id),
      eq(exchangeConnections.exchange, "binance"),
    )).returning({ id: exchangeConnections.id });
    if (!deleted.length) return Response.json({ error: "Binance connection not found" }, { status: 404 });
    return Response.json({ disconnected: true });
  });
}
