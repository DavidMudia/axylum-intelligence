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
    response = await fetch(`https://api.binance.com/sapi/v1/account/apiRestrictions?${query}`, {
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
    if (response.status === 400) {
      throw new BinanceConnectionError(400, "Binance rejected the API credentials or signed request.");
    }
    if (response.status === 451) {
      throw new BinanceConnectionError(503, "Binance is unavailable from this server region.");
    }
    if (response.status === 418 || response.status === 429) {
      throw new BinanceConnectionError(503, "Binance is temporarily rate-limiting credential validation.");
    }
    throw new BinanceConnectionError(502, `Binance credential validation failed (HTTP ${response.status}).`);
  }

  let permissions: Record<string, unknown>;
  try {
    permissions = await response.json() as Record<string, unknown>;
  } catch {
    throw new BinanceConnectionError(502, "Binance returned an invalid API-key permissions response.");
  }

  const restrictedPermissions = [
    "enableSpotAndMarginTrading",
    "enableMargin",
    "enableFutures",
    "enableVanillaOptions",
    "enableWithdrawals",
    "enableInternalTransfer",
    "permitsUniversalTransfer",
  ];
  if (permissions.enableReading !== true || restrictedPermissions.some((permission) => permissions[permission] !== false)) {
    throw new BinanceConnectionError(
      400,
      "Use a read-only Binance key with reading enabled and all trading, withdrawal, and transfer permissions disabled.",
    );
  }
}
