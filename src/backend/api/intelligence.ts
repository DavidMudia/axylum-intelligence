import { getMarketAnalysis, getRecentDecisions, InsufficientClosedCandlesError } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ownerUserId: string) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
  const interval = url.searchParams.get("interval") ?? "1m";
  try {
    const { analysis } = await getMarketAnalysis(symbol, interval);
    const decisions = await getRecentDecisions(ownerUserId, 25);
    return Response.json({ analysis, decisions, generatedAt: new Date().toISOString() });
  } catch (error) {
    if (error instanceof InsufficientClosedCandlesError) {
      return Response.json({
        error: error.message,
        code: "market_data_not_ready",
        availableCandles: error.availableCandles,
        requiredCandles: error.requiredCandles,
      }, { status: 503 });
    }
    if (error instanceof RangeError) {
      return Response.json({ error: error.message }, { status: 422 });
    }
    throw error;
  }
}
