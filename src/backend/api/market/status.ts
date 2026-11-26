import { getIngestionStatus } from "@backend/market-data/store";
import { isResponse, marketSymbol } from "./request";

const DEFAULT_STALE_AFTER_MS = 15_000;

export async function GET(request: Request) {
  const symbol = marketSymbol(new URL(request.url).searchParams);
  if (isResponse(symbol)) return symbol;

  const status = await getIngestionStatus(symbol);
  if (!status) {
    return Response.json({
      symbol,
      provider: "binance-spot",
      state: "not_started",
      running: false,
      fresh: false,
      ageMs: null,
    });
  }

  const staleAfterMs = Number(process.env.MARKET_STALE_AFTER_MS ?? DEFAULT_STALE_AFTER_MS);
  const ageMs = status.lastMessageAt ? Math.max(0, Date.now() - status.lastMessageAt.getTime()) : null;
  const eventLagMs = status.lastEventAt ? Math.max(0, Date.now() - status.lastEventAt.getTime()) : null;
  const fresh = ageMs !== null && Number.isFinite(staleAfterMs) && staleAfterMs > 0 && ageMs <= staleAfterMs;
  const running = ["starting", "backfilling", "connecting", "connected", "streaming", "reconnecting"].includes(status.state);
  return Response.json({ ...status, running, fresh, ageMs, eventLagMs, staleAfterMs });
}
