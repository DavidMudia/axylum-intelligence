import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isValidEmail, isValidPassword, normalizeEmail, verifyPassword } from "./user-auth";

test("account email validation normalizes case and rejects malformed addresses", () => {
  assert.equal(normalizeEmail(" Person@Example.com "), "person@example.com");
  assert.equal(isValidEmail("person@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail(""), false);
});

test("account passwords require at least 12 characters and are verified from salted scrypt hashes", () => {
  const password = "correct horse battery staple";
  const hash = hashPassword(password);
  assert.equal(isValidPassword(password), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(verifyPassword(password, hash), true);
  assert.equal(verifyPassword("different password", hash), false);
});
