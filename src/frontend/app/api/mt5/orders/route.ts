import { getSessionUser } from "@backend/lib/server/user-auth";
import { createMt5OrderIntent, listMt5OrderHistory, Mt5OrderRequestError } from "@backend/mt5/service";
import { Mt5PayloadError, parseMt5OrderRequest } from "@backend/mt5/validation";
import { readMt5JsonBody } from "@backend/mt5/http";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const accountId = new URL(request.url).searchParams.get("accountId") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) {
      return Response.json({ error: "A valid accountId is required" }, { status: 400 });
    }
    return Response.json({ orders: await listMt5OrderHistory(user.id, accountId) }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const parsedBody = await readMt5JsonBody(request, 32_768);
    if (!parsedBody.ok) return parsedBody.response;
    try {
      const order = parseMt5OrderRequest(parsedBody.value);
      const result = await createMt5OrderIntent(user.id, order);
      return Response.json(result, {
        status: result.reused ? 200 : 202,
        headers: { "Cache-Control": "no-store" },
      });
    } catch (error) {
      if (error instanceof Mt5PayloadError) {
        return Response.json({ error: error.message }, { status: 400 });
      }
      if (error instanceof Mt5OrderRequestError) {
        return Response.json({ error: error.message, checks: error.checks }, { status: error.status });
      }
      throw error;
    }
  });
}
