import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const { GET: getOrderBook } = await import("@backend/api/market/order-book");
    return getOrderBook(request);
  });
}
