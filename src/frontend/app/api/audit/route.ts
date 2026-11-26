import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { authorizeAdministrator } from "@backend/lib/server/operator-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const unauthorized = await authorizeAdministrator(request);
    if (unauthorized) return unauthorized;
    const { GET: getAudit } = await import("@backend/api/audit");
    return getAudit();
  });
}
