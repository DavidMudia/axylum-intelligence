import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { verifyPaystackWebhookSignature } from "./paystack";

test("Paystack webhook signature verification authenticates the exact raw payload", () => {
  const previous = process.env.PAYSTACK_SECRET_KEY;
  process.env.PAYSTACK_SECRET_KEY = "test-secret";
  try {
    const rawBody = '{"event":"charge.success","data":{"reference":"ax_123"}}';
    const signature = createHmac("sha512", "test-secret").update(rawBody).digest("hex");
    assert.equal(verifyPaystackWebhookSignature(rawBody, signature), true);
    assert.equal(verifyPaystackWebhookSignature(`${rawBody} `, signature), false);
    assert.equal(verifyPaystackWebhookSignature(rawBody, "bad-signature"), false);
    assert.equal(verifyPaystackWebhookSignature(rawBody, null), false);
  } finally {
    if (previous === undefined) delete process.env.PAYSTACK_SECRET_KEY;
    else process.env.PAYSTACK_SECRET_KEY = previous;
  }
});
