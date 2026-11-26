import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const unauthorized = await authorizeOperator(request);
    if (unauthorized) return unauthorized;
    const { GET: getRisk } = await import("@backend/api/risk");
    return getRisk();
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const unauthorized = await authorizeOperator(request, true);
    if (unauthorized) return unauthorized;
    const { POST: updateRisk } = await import("@backend/api/risk");
    return updateRisk(request);
  });
}
