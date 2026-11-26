import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizeOperator(request);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { GET: getRisk } = await import("@backend/api/risk");
    return getRisk();
  });
}

export async function POST(request: Request) {
  const unauthorized = authorizeOperator(request, true);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { POST: updateRisk } = await import("@backend/api/risk");
    return updateRisk(request);
  });
}
