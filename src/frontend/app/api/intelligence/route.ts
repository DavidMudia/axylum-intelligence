import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const { GET: getIntelligence } = await import("@backend/api/intelligence");
    return getIntelligence(request);
  });
}
