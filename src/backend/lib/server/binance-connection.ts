import { createHmac } from "node:crypto";

export class BinanceConnectionError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function validateBinanceReadOnlyCredentials(apiKey: string, apiSecret: string): Promise<void> {
  const query = new URLSearchParams({
    recvWindow: "5000",
    timestamp: String(Date.now()),
  });
  const signature = createHmac("sha256", apiSecret).update(query.toString()).digest("hex");
  query.set("signature", signature);

  let response: Response;
  try {
    response = await fetch(`https://api.binance.com/api/v3/account?${query}`, {
      headers: { "X-MBX-APIKEY": apiKey },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new BinanceConnectionError(502, "Could not reach Binance to validate this API key.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new BinanceConnectionError(400, "Binance rejected the API credentials.");
    }
    throw new BinanceConnectionError(502, `Binance credential validation failed (HTTP ${response.status}).`);
  }

  let account: { canTrade?: unknown; canWithdraw?: unknown };
  try {
    account = await response.json() as typeof account;
  } catch {
    throw new BinanceConnectionError(502, "Binance returned an invalid account response.");
  }
  if (account.canTrade !== false || account.canWithdraw !== false) {
    throw new BinanceConnectionError(400, "Use a read-only Binance key with trading and withdrawal permissions disabled.");
  }
}
