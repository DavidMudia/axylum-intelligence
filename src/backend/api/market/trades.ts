import { getRecentTrades } from "@backend/market-data/store";
import { boundedInteger, isResponse, marketSymbol } from "./request";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = marketSymbol(params);
  if (isResponse(symbol)) return symbol;

  const limit = boundedInteger(params, "limit", 100, 1, 1000);
  if (isResponse(limit)) return limit;

  const trades = await getRecentTrades(symbol, limit);
  return Response.json({ symbol, trades });
}
