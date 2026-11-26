import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE_NAME = "axylum_operator";
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const failedLogins = new Map<string, { count: number; resetAt: number }>();

function productionAuthConfig() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!username || !password || !secret || secret.length < 32) {
    throw new Error("Production operator authentication requires ADMIN_USERNAME, ADMIN_PASSWORD and an AUTH_SESSION_SECRET of at least 32 characters.");
  }
  return { username, password, secret };
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return left.length === right.length && timingSafeEqual(leftHash, rightHash);
}

function signature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function parseCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

function hasValidSession(request: Request): boolean {
  const { secret } = productionAuthConfig();
  const value = parseCookie(request, COOKIE_NAME);
  if (!value) return false;
  const [payload, suppliedSignature, extra] = value.split(".");
  if (!payload || !suppliedSignature || extra) return false;
  const expected = signature(payload, secret);
  if (!secureEqual(expected, suppliedSignature)) return false;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string; exp?: number };
    const { username } = productionAuthConfig();
    return decoded.sub === username && typeof decoded.exp === "number" && decoded.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";
  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const requestHost = forwardedHost?.split(",")[0].trim() ?? request.headers.get("host");
    return Boolean(
      requestHost &&
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      (process.env.NODE_ENV !== "production" || originUrl.protocol === "https:"),
    );
  } catch {
    return false;
  }
}

export function isOperatorAuthEnabled(): boolean {
  return process.env.NODE_ENV === "production";
}

export function getOperatorAuthStatus(): { required: boolean; configured: boolean; error?: string } {
  if (!isOperatorAuthEnabled()) return { required: false, configured: true };
  try {
    productionAuthConfig();
    return { required: true, configured: true };
  } catch (error) {
    return {
      required: true,
      configured: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function authorizeOperator(request: Request, mutation = false): Response | null {
  if (!isOperatorAuthEnabled()) return null;
  try {
    productionAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, code: "operator_auth_not_configured" }, { status: 503 });
  }
  if (mutation && !isSameOrigin(request)) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!hasValidSession(request)) {
    return Response.json({ error: "Operator sign-in required" }, { status: 401 });
  }
  return null;
}

export function operatorSessionResponse(request: Request): Response {
  if (!isOperatorAuthEnabled()) return Response.json({ authenticated: true, mode: "local-development" });
  const authError = authorizeOperator(request);
  if (authError) {
    return Response.json({ authenticated: false }, { status: authError.status });
  }
  return Response.json({ authenticated: true, mode: "production" }, { headers: { "Cache-Control": "no-store" } });
}

export function loginOperator(request: Request, body: { username?: unknown; password?: unknown }): Response {
  if (!isOperatorAuthEnabled()) {
    return Response.json({ error: "Operator sign-in is only enabled in production." }, { status: 404 });
  }
  if (!isSameOrigin(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  let config: ReturnType<typeof productionAuthConfig>;
  try {
    config = productionAuthConfig();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message, code: "operator_auth_not_configured" }, { status: 503 });
  }
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const address = forwardedFor || "unknown";
  const now = Date.now();
  for (const [key, attempt] of failedLogins) {
    if (attempt.resetAt <= now) failedLogins.delete(key);
  }
  const attempt = failedLogins.get(address);
  if (attempt && attempt.count >= MAX_LOGIN_ATTEMPTS && attempt.resetAt > now) {
    return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  }
  if (typeof body.username !== "string" || typeof body.password !== "string" ||
      body.username.length > 256 || body.password.length > 256 ||
      !secureEqual(body.username, config.username) || !secureEqual(body.password, config.password)) {
    const resetAt = attempt?.resetAt && attempt.resetAt > now ? attempt.resetAt : now + LOGIN_WINDOW_MS;
    failedLogins.set(address, { count: (attempt?.resetAt === resetAt ? attempt.count : 0) + 1, resetAt });
    return Response.json({ error: "Incorrect username or password" }, { status: 401 });
  }
  failedLogins.delete(address);

  const payload = Buffer.from(JSON.stringify({ sub: config.username, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })).toString("base64url");
  const cookie = `${COOKIE_NAME}=${payload}.${signature(payload, config.secret)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  return Response.json({ authenticated: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}

export function logoutOperator(): Response {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`, "Cache-Control": "no-store" } },
  );
}

