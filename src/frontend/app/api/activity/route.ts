import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const unauthorized = await authorizeOperator(request);
    if (unauthorized) return unauthorized;
    const { GET: getActivity } = await import("@backend/api/activity");
    return getActivity();
  });
}
