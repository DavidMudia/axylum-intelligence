import { BinanceSpotProvider } from "./binance-spot-provider";
import type { MarketDataProvider } from "./types";

export function createMarketDataProvider(id = process.env.MARKET_DATA_PROVIDER ?? "binance-spot"): MarketDataProvider {
  if (id === "binance-spot") return new BinanceSpotProvider();
  throw new Error(`Unsupported market data provider: ${id}`);
}
