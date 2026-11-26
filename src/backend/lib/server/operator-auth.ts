import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isSameOriginRequest } from "./request-origin";

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

export function isOperatorAuthEnabled(): boolean {
  return getOperatorAuthStatus().configured;
}

export function getOperatorAuthStatus(): { required: boolean; configured: boolean; error?: string } {
  const required = process.env.NODE_ENV === "production";
  try {
    productionAuthConfig();
    return { required, configured: true };
  } catch (error) {
    return {
      required,
      configured: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function authorizeOperator(request: Request, mutation = false): Promise<Response | null> {
  if (mutation) return authorizeAdministrator(request, true);
  const legacyOperator = isOperatorAuthEnabled() && hasValidSession(request);
  if (legacyOperator) return null;
  const { getSessionUser } = await import("./user-auth");
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
  return null;
}

export async function authorizeAdministrator(request: Request, mutation = false): Promise<Response | null> {
  if (mutation && !isSameOriginRequest(request)) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  const legacyOperator = isOperatorAuthEnabled() && hasValidSession(request);
  if (legacyOperator) return null;
  const { getSessionUser } = await import("./user-auth");
  const user = await getSessionUser(request);
  if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
  if (user.role !== "admin") {
    return Response.json({ error: "Administrator access required" }, { status: 403 });
  }
  return null;
}

export async function operatorSessionResponse(request: Request): Promise<Response> {
  if (isOperatorAuthEnabled() && hasValidSession(request)) {
    const { username } = productionAuthConfig();
    return Response.json(
      { authenticated: true, user: { email: username, role: "admin" }, mode: "legacy-operator" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const { getSessionUser, getSignupStatus } = await import("./user-auth");
  const user = await getSessionUser(request);
  if (user) {
    return Response.json(
      { authenticated: true, user, mode: isOperatorAuthEnabled() ? "production" : "local-development" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  const signup = await getSignupStatus();
  const operatorAuth = getOperatorAuthStatus();
  return Response.json(
    { authenticated: false, ...signup, operatorLoginAvailable: operatorAuth.configured },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function loginOperator(request: Request, body: { username?: unknown; password?: unknown }): Response {
  if (!isOperatorAuthEnabled()) {
    return Response.json({ error: "Operator sign-in is only enabled in production." }, { status: 404 });
  }
  if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
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
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  const cookie = `${COOKIE_NAME}=${payload}.${signature(payload, config.secret)}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${SESSION_SECONDS}`;
  return Response.json({ authenticated: true }, { headers: { "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}

export function logoutOperator(): Response {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`, "Cache-Control": "no-store" } },
  );
}

