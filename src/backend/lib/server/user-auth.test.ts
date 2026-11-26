import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, isUniqueConstraintViolation, isValidEmail, isValidPassword, normalizeEmail, verifyPassword } from "./user-auth";
import { isSameOriginRequest } from "./request-origin";

test("production same-origin checks allow HTTP only on a matching loopback host", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");

  try {
    const localhost = new Request("http://localhost:5174/api/auth/login", {
      headers: { origin: "http://localhost:5174", host: "localhost:5174" },
    });
    const loopbackAddress = new Request("http://127.0.0.1:5174/api/auth/login", {
      headers: { origin: "http://127.0.0.1:5174", host: "127.0.0.1:5174" },
    });
    const insecureRemote = new Request("http://terminal.example.test/api/auth/login", {
      headers: { origin: "http://terminal.example.test", host: "terminal.example.test" },
    });
    const crossOrigin = new Request("https://terminal.example.test/api/auth/login", {
      headers: { origin: "https://attacker.example", host: "terminal.example.test" },
    });

    assert.equal(isSameOriginRequest(localhost), true);
    assert.equal(isSameOriginRequest(loopbackAddress), true);
    assert.equal(isSameOriginRequest(insecureRemote), false);
    assert.equal(isSameOriginRequest(crossOrigin), false);
  } finally {
    if (previousNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
  }
});

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

test("duplicate account errors are recognized when wrapped by the database driver", () => {
  const postgresError = Object.assign(new Error("duplicate key"), { code: "23505" });
  const drizzleError = Object.assign(new Error("query failed"), { cause: postgresError });
  const unrelatedError = Object.assign(new Error("connection failed"), { code: "ECONNRESET" });

  assert.equal(isUniqueConstraintViolation(postgresError), true);
  assert.equal(isUniqueConstraintViolation(drizzleError), true);
  assert.equal(isUniqueConstraintViolation(unrelatedError), false);
});
