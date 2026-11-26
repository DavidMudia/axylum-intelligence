import { getMarketAnalysis, getRecentDecisions } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get("symbol") ?? "BTCUSDT";
  const interval = url.searchParams.get("interval") ?? "1m";
  const { analysis } = await getMarketAnalysis(symbol, interval);
  const decisions = await getRecentDecisions(25);
  return Response.json({ analysis, decisions, generatedAt: new Date().toISOString() });
}
