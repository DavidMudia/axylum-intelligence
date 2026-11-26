import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeOperator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = authorizeOperator(request);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { GET: getPaperState } = await import("@backend/api/paper");
    return getPaperState();
  });
}

export async function POST(request: Request) {
  const unauthorized = authorizeOperator(request, true);
  if (unauthorized) return unauthorized;
  return withDatabaseConfiguration(async () => {
    const { POST: updatePaperState } = await import("@backend/api/paper");
    return updatePaperState(request);
  });
}
