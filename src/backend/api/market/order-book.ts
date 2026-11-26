import { getLatestOrderBookSnapshot, getRecentOrderBookUpdates } from "@backend/market-data/store";
import { boundedInteger, isResponse, marketSymbol } from "./request";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const symbol = marketSymbol(params);
  if (isResponse(symbol)) return symbol;

  const depth = boundedInteger(params, "depth", 20, 1, 100);
  if (isResponse(depth)) return depth;
  const updateLimit = boundedInteger(params, "updates", 20, 0, 100);
  if (isResponse(updateLimit)) return updateLimit;

  const [snapshot, updates] = await Promise.all([
    getLatestOrderBookSnapshot(symbol),
    getRecentOrderBookUpdates(symbol, updateLimit),
  ]);
  return Response.json({
    symbol,
    snapshot: snapshot
      ? {
          ...snapshot,
          bids: snapshot.bids.slice(0, depth),
          asks: snapshot.asks.slice(0, depth),
        }
      : null,
    updates,
  });
}
