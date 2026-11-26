import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizeOperator(request);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { GET: getStrategies } = await import("@backend/api/strategies");
    return getStrategies();
  });
}

export async function POST(request: Request) {
  const unauthorized = authorizeOperator(request, true);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { POST: saveStrategy } = await import("@backend/api/strategies");
    return saveStrategy(request);
  });
}
