import { getCandles } from "@backend/market-data/store";
import { boundedInteger, isResponse, marketSymbol } from "./request";

const VALID_INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"];

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = marketSymbol(params);
  if (isResponse(symbol)) return symbol;

  const interval = params.get("interval") ?? process.env.MARKET_INTERVAL ?? "1m";
  if (!VALID_INTERVALS.includes(interval)) {
    return Response.json({ error: `interval must be one of: ${VALID_INTERVALS.join(", ")}` }, { status: 400 });
  }
  const limit = boundedInteger(params, "limit", 500, 1, 1000);
  if (isResponse(limit)) return limit;

  const candles = await getCandles(symbol, interval, limit);
  return Response.json({ symbol, interval, candles });
}
