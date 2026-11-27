import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { getSessionUser } from "@backend/lib/server/user-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const { GET: getIntelligence } = await import("@backend/api/intelligence");
    return getIntelligence(request, user.id);
  });
}
