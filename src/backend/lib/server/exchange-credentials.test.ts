import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decryptExchangeCredential, encryptExchangeCredential } from "./exchange-credentials";

test("exchange credentials are encrypted with an authenticated context", () => {
  const previous = process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
  process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  try {
    const encrypted = encryptExchangeCredential("sample-secret", "connection:123:api-secret");
    assert.notEqual(encrypted.ciphertext, "sample-secret");
    assert.equal(decryptExchangeCredential(encrypted, "connection:123:api-secret"), "sample-secret");
    assert.throws(() => decryptExchangeCredential(encrypted, "connection:456:api-secret"));
  } finally {
    if (previous === undefined) delete process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY = previous;
  }
});

test("exchange credential encryption refuses missing or malformed server keys", () => {
  const previous = process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
  try {
    delete process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
    assert.throws(() => encryptExchangeCredential("sample-secret", "connection:123:api-key"), /required/);
    process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY = "not-a-key";
    assert.throws(() => encryptExchangeCredential("sample-secret", "connection:123:api-key"), /base64-encoded/);
  } finally {
    if (previous === undefined) delete process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY;
    else process.env.EXCHANGE_CREDENTIALS_ENCRYPTION_KEY = previous;
  }
});
