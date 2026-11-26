import assert from "node:assert/strict";
import test from "node:test";
import { authorizeAdministrator, loginOperator, operatorSessionResponse } from "./operator-auth";

test("production operator login issues a signed secure cookie and rejects cross-origin requests", async () => {
  const previous = {
    nodeEnv: process.env.NODE_ENV,
    username: process.env.ADMIN_USERNAME,
    password: process.env.ADMIN_PASSWORD,
    secret: process.env.AUTH_SESSION_SECRET,
  };
  Reflect.set(process.env, "NODE_ENV", "production");
  process.env.ADMIN_USERNAME = "test-operator";
  process.env.ADMIN_PASSWORD = "test-password";
  process.env.AUTH_SESSION_SECRET = "a".repeat(64);

  try {
    const request = new Request("https://terminal.example.test/api/auth/login", {
      method: "POST",
      headers: { origin: "https://terminal.example.test", host: "terminal.example.test", "x-forwarded-for": "192.0.2.1" },
    });
    const wrong = loginOperator(request, { username: "test-operator", password: "wrong" });
    assert.equal(wrong.status, 401);

    const crossOrigin = loginOperator(new Request(request.url, {
      method: "POST",
      headers: { origin: "https://attacker.example", host: "terminal.example.test" },
    }), { username: "test-operator", password: "test-password" });
    assert.equal(crossOrigin.status, 403);

    const response = loginOperator(request, { username: "test-operator", password: "test-password" });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie");
    assert.match(cookie ?? "", /HttpOnly; Secure; SameSite=Strict/);
    const cookieHeader = cookie!.split(";")[0];
    const sessionRequest = new Request("https://terminal.example.test/api/auth/session", {
      headers: { cookie: cookieHeader, host: "terminal.example.test" },
    });
    const session = await operatorSessionResponse(sessionRequest);
    assert.equal(session.status, 200);
    assert.equal((await session.json() as { user: { role: string } }).user.role, "admin");

    const authorized = await authorizeAdministrator(new Request(request.url, {
      headers: { cookie: cookieHeader, origin: "https://terminal.example.test", host: "terminal.example.test" },
    }), true);
    assert.equal(authorized, null);
    const crossOriginMutation = await authorizeAdministrator(new Request(request.url, {
      headers: { cookie: cookieHeader, origin: "https://attacker.example", host: "terminal.example.test" },
    }), true);
    assert.equal(crossOriginMutation?.status, 403);
  } finally {
    if (previous.nodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
    else Reflect.set(process.env, "NODE_ENV", previous.nodeEnv);
    if (previous.username === undefined) delete process.env.ADMIN_USERNAME;
    else process.env.ADMIN_USERNAME = previous.username;
    if (previous.password === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous.password;
    if (previous.secret === undefined) delete process.env.AUTH_SESSION_SECRET;
    else process.env.AUTH_SESSION_SECRET = previous.secret;
  }
});
