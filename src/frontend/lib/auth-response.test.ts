import assert from "node:assert/strict";
import test from "node:test";
import { readAuthResponse } from "./auth-response";

test("auth response parser accepts valid JSON responses", async () => {
  const response = await readAuthResponse(Response.json({ authenticated: false, error: "Invalid credentials" }, { status: 401 }));
  assert.equal(response.authenticated, false);
  assert.equal(response.error, "Invalid credentials");
});

test("auth response parser reports empty and malformed API responses with HTTP status", async () => {
  await assert.rejects(
    readAuthResponse(new Response(null, { status: 500 })),
    /empty response \(HTTP 500\)/,
  );
  await assert.rejects(
    readAuthResponse(new Response("<html>", { status: 502 })),
    /invalid response \(HTTP 502\)/,
  );
});
