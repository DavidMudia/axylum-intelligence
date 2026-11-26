import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const { GET: getTrades } = await import("@backend/api/market/trades");
    return getTrades(request);
  });
}
