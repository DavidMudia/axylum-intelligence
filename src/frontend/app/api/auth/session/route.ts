import { operatorSessionResponse } from "@backend/lib/server/operator-auth";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(() => operatorSessionResponse(request));
}
