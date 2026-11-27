import assert from "node:assert/strict";
import test from "node:test";
import {
  createMt5BridgeToken,
  hashMt5BridgeToken,
  signMt5BridgeBody,
  verifyMt5BridgeSignature,
} from "./bridge-auth";

const TOKEN = "a".repeat(64);
const BODY = '{"status":"healthy"}';
const NOW = 1_800_000_000;

test("MT5 bridge signatures authenticate the exact body within the allowed time window", () => {
  const timestamp = String(NOW);
  const signature = signMt5BridgeBody(TOKEN, timestamp, BODY);
  assert.equal(verifyMt5BridgeSignature(TOKEN, timestamp, signature, BODY, NOW), true);
  assert.equal(verifyMt5BridgeSignature(TOKEN, timestamp, signature, `${BODY} `, NOW), false);
  assert.equal(verifyMt5BridgeSignature(TOKEN, String(NOW - 301), signature, BODY, NOW), false);
});

test("MT5 bridge signature validation rejects malformed tokens and signatures", () => {
  assert.equal(verifyMt5BridgeSignature("short", String(NOW), "bad", BODY, NOW), false);
  assert.equal(hashMt5BridgeToken(TOKEN).length, 64);
});

test("MT5 bridge credentials use a one-time random token suitable for HMAC authentication", () => {
  const token = createMt5BridgeToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(hashMt5BridgeToken(token).length, 64);
  assert.notEqual(createMt5BridgeToken(), token);
});
