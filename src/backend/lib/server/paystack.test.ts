import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  getPaystackCheckoutConfiguration,
  initializePaystackTransaction,
  verifyPaystackWebhookSignature,
} from "./paystack";

const paystackEnvironment = [
  "PAYSTACK_SECRET_KEY",
  "PAYSTACK_STARTER_PLAN_CODE",
  "PAYSTACK_PROFESSIONAL_PLAN_CODE",
  "APP_BASE_URL",
] as const;

type PaystackEnvironmentKey = typeof paystackEnvironment[number];

async function withPaystackEnvironment<T>(
  values: Partial<Record<PaystackEnvironmentKey, string>>,
  callback: () => T | Promise<T>,
): Promise<T> {
  const previous = new Map(paystackEnvironment.map((name) => [name, process.env[name]]));
  for (const name of paystackEnvironment) {
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await callback();
  } finally {
    for (const name of paystackEnvironment) {
      const value = previous.get(name);
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("Paystack webhook signature verification authenticates the exact raw payload", async () => {
  await withPaystackEnvironment({ PAYSTACK_SECRET_KEY: "test-secret" }, () => {
    const rawBody = '{"event":"charge.success","data":{"reference":"ax_123"}}';
    const signature = createHmac("sha512", "test-secret").update(rawBody).digest("hex");
    assert.equal(verifyPaystackWebhookSignature(rawBody, signature), true);
    assert.equal(verifyPaystackWebhookSignature(`${rawBody} `, signature), false);
    assert.equal(verifyPaystackWebhookSignature(rawBody, "bad-signature"), false);
    assert.equal(verifyPaystackWebhookSignature(rawBody, null), false);
  });
});

test("checkout reports all required server configuration when Paystack is not set up", async () => {
  await withPaystackEnvironment({}, () => {
    assert.deepEqual(getPaystackCheckoutConfiguration(), {
      available: false,
      missing: [
        "PAYSTACK_SECRET_KEY",
        "PAYSTACK_STARTER_PLAN_CODE",
        "PAYSTACK_PROFESSIONAL_PLAN_CODE",
        "APP_BASE_URL",
      ],
    });
  });
});

test("checkout requires a secure callback URL outside local development", async () => {
  await withPaystackEnvironment({
    PAYSTACK_SECRET_KEY: "test-secret",
    PAYSTACK_STARTER_PLAN_CODE: "starter-test",
    PAYSTACK_PROFESSIONAL_PLAN_CODE: "professional-test",
    APP_BASE_URL: "http://axylum.example",
  }, () => {
    assert.deepEqual(getPaystackCheckoutConfiguration(), {
      available: false,
      missing: ["APP_BASE_URL"],
    });
  });
});

test("checkout becomes available only when all required configuration is present", async () => {
  await withPaystackEnvironment({
    PAYSTACK_SECRET_KEY: "test-secret",
    PAYSTACK_STARTER_PLAN_CODE: "starter-test",
    PAYSTACK_PROFESSIONAL_PLAN_CODE: "professional-test",
    APP_BASE_URL: "https://axylum.example",
  }, () => {
    assert.deepEqual(getPaystackCheckoutConfiguration(), { available: true, missing: [] });
  });
});

test("checkout initialization does not contact Paystack when plan configuration is missing", async () => {
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    return new Response();
  };
  try {
    await withPaystackEnvironment({}, async () => {
      await assert.rejects(initializePaystackTransaction({
        email: "customer@example.test",
        planId: "starter",
        amountMinor: 500000,
        reference: "ax_123",
        callbackUrl: "https://axylum.example/billing",
        userId: "user-1",
      }), /Paystack monthly plan code is not configured/);
      assert.equal(fetchCalls, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
