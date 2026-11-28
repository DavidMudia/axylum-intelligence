import assert from "node:assert/strict";
import test from "node:test";
import { BinanceConnectionError, validateBinanceReadOnlyCredentials } from "./binance-connection";

function readOnlyPermissions(overrides: Record<string, unknown> = {}) {
  return {
    enableReading: true,
    enableSpotAndMarginTrading: false,
    enableMargin: false,
    enableFutures: false,
    enableVanillaOptions: false,
    enableWithdrawals: false,
    enableInternalTransfer: false,
    permitsUniversalTransfer: false,
    ...overrides,
  };
}

test("Binance credential validation checks API-key permissions, not account capabilities", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({
      ...readOnlyPermissions(),
      canTrade: true,
      canWithdraw: true,
    });
  };
  try {
    await validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret");
    assert.match(requestUrl, /^https:\/\/api\.binance\.com\/sapi\/v1\/account\/apiRestrictions\?/);
    assert.equal(new Headers(requestInit?.headers).get("X-MBX-APIKEY"), "example-api-key");
    assert.equal(requestUrl.includes("example-api-secret"), false);

    for (const permissions of [
      readOnlyPermissions({ enableSpotAndMarginTrading: true }),
      readOnlyPermissions({ enableWithdrawals: true }),
      readOnlyPermissions({ enableInternalTransfer: true }),
      readOnlyPermissions({ enableReading: false }),
    ]) {
      globalThis.fetch = async () => Response.json(permissions);
      await assert.rejects(
        validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret"),
        (error: unknown) => error instanceof BinanceConnectionError && error.status === 400,
      );
    }

    globalThis.fetch = async () => Response.json({ enableReading: true });
    await assert.rejects(
      validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret"),
      (error: unknown) => error instanceof BinanceConnectionError && error.status === 400,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Binance regional restrictions and rejected signatures return actionable client-safe statuses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(null, { status: 451 });
    await assert.rejects(
      validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret"),
      (error: unknown) => error instanceof BinanceConnectionError &&
        error.status === 503 && /server region/.test(error.message),
    );

    globalThis.fetch = async () => new Response(null, { status: 400 });
    await assert.rejects(
      validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret"),
      (error: unknown) => error instanceof BinanceConnectionError &&
        error.status === 400 && /rejected/.test(error.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
