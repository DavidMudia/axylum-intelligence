import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeAdministrator } from "@backend/lib/server/operator-auth";
import { getSessionUser } from "@backend/lib/server/user-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { GET: getState } = await import("@backend/api/state");
    return getState();
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const unauthorized = await authorizeAdministrator(request, true);
    if (unauthorized) return unauthorized;
    const { POST: updateState } = await import("@backend/api/state");
    return updateState(request);
  });
}
