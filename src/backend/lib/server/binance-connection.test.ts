import assert from "node:assert/strict";
import test from "node:test";
import { BinanceConnectionError, validateBinanceReadOnlyCredentials } from "./binance-connection";

test("Binance credential validation sends the key in a header and rejects trading or withdrawal permissions", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestInit = init;
    return Response.json({ canTrade: false, canWithdraw: false });
  };
  try {
    await validateBinanceReadOnlyCredentials("example-api-key", "example-api-secret");
    assert.match(requestUrl, /^https:\/\/api\.binance\.com\/api\/v3\/account\?/);
    assert.equal(new Headers(requestInit?.headers).get("X-MBX-APIKEY"), "example-api-key");
    assert.equal(requestUrl.includes("example-api-secret"), false);

    globalThis.fetch = async () => Response.json({ canTrade: true, canWithdraw: false });
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
