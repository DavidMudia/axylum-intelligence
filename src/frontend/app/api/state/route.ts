import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  return withDatabaseConfiguration(async () => {
    const { GET: getState } = await import("@backend/api/state");
    return getState();
  });
}

export async function POST(request: Request) {
  const unauthorized = authorizeOperator(request, true);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { POST: updateState } = await import("@backend/api/state");
    return updateState(request);
  });
}
