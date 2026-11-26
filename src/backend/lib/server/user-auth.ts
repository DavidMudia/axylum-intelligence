import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "@backend/db";
import { systemState, userSessions, users } from "@backend/db/schema";

const COOKIE_NAME = "axylum_session";
const SESSION_SECONDS = 8 * 60 * 60;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 5;
const MAX_SIGNUP_ATTEMPTS = 5;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_LENGTH = 128;
const SCRYPT_COST = 1 << 15;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const BOOTSTRAP_LOCK_ID = 71824601;

type Attempt = { count: number; resetAt: number };
export type AuthUser = { id: string; email: string; role: string };
const attempts = new Map<string, Attempt>();

class AuthFailure extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return left.length === right.length && timingSafeEqual(leftHash, rightHash);
}

function sessionCookie(token: string, maxAge: number): string {
  const secure = isProduction() ? " Secure;" : "";
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${maxAge}`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=") || null;
  }
  return null;
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return !isProduction();
  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const requestHost = forwardedHost?.split(",")[0].trim() ?? request.headers.get("host");
    return Boolean(
      requestHost &&
      originUrl.host.toLowerCase() === requestHost.toLowerCase() &&
      (!isProduction() || originUrl.protocol === "https:"),
    );
  } catch {
    return false;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH;
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: SCRYPT_MAX_MEMORY,
  });
  return `scrypt$${SCRYPT_COST}$${SCRYPT_BLOCK_SIZE}$${SCRYPT_PARALLELIZATION}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, cost, blockSize, parallelization, saltText, hashText, extra] = encoded.split("$");
  if (algorithm !== "scrypt" || extra !== undefined || !cost || !blockSize || !parallelization || !saltText || !hashText) return false;
  const params = [Number(cost), Number(blockSize), Number(parallelization)];
  if (!params.every(Number.isSafeInteger) || params[0] !== SCRYPT_COST || params[1] !== SCRYPT_BLOCK_SIZE || params[2] !== SCRYPT_PARALLELIZATION) return false;
  try {
    const salt = Buffer.from(saltText, "base64url");
    const expected = Buffer.from(hashText, "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = scryptSync(password, salt, SCRYPT_KEY_LENGTH, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
      maxmem: SCRYPT_MAX_MEMORY,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function addressKey(request: Request, action: "login" | "signup"): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return `${action}:${forwarded || "unknown"}`;
}

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now();
  for (const [entry, attempt] of attempts) {
    if (attempt.resetAt <= now) attempts.delete(entry);
  }
  if (attempts.size > 10_000) {
    const oldest = attempts.keys().next().value;
    if (oldest) attempts.delete(oldest);
  }
  const attempt = attempts.get(key);
  if (attempt && attempt.count >= limit && attempt.resetAt > now) return false;
  attempts.set(key, {
    count: attempt && attempt.resetAt > now ? attempt.count + 1 : 1,
    resetAt: attempt && attempt.resetAt > now ? attempt.resetAt : now + LOGIN_WINDOW_MS,
  });
  return true;
}

function clearRateLimit(key: string): void {
  attempts.delete(key);
}

function operatorCredentialsConfigured(): boolean {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.AUTH_SESSION_SECRET;
  return Boolean(username && password && secret && secret.length >= 32);
}

function bootstrapSecretConfigured(secret: string | undefined): secret is string {
  return Boolean(secret && /^[a-f0-9]{64}$/i.test(secret));
}

export function isUniqueConstraintViolation(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  while (typeof current === "object" && current !== null && !seen.has(current)) {
    seen.add(current);
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function newSessionCookie(userId: string): Promise<{ cookie: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const sessionId = createHash("sha256").update(token).digest("hex");
  await db.delete(userSessions).where(lt(userSessions.expiresAt, new Date()));
  await db.insert(userSessions).values({ id: sessionId, userId, expiresAt });
  return { cookie: sessionCookie(token, SESSION_SECONDS), expiresAt };
}

export async function getSessionUser(request: Request): Promise<AuthUser | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token || token.length > 128) return null;
  const sessionId = createHash("sha256").update(token).digest("hex");
  const [session] = await db
    .select({ id: users.id, email: users.email, role: users.role })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(and(eq(userSessions.id, sessionId), gt(userSessions.expiresAt, new Date())))
    .limit(1);
  return session ?? null;
}

export async function getSignupStatus(): Promise<{
  signupAvailable: boolean;
  bootstrapRequired: boolean;
  bootstrapConfigured: boolean;
  bootstrapAvailable: boolean;
}> {
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  const [bootstrapUsed] = await db
    .select({ key: systemState.key })
    .from(systemState)
    .where(eq(systemState.key, "auth_admin_bootstrap_consumed"))
    .limit(1);
  const bootstrapSecret = process.env.AUTH_BOOTSTRAP_ADMIN_SECRET;
  const bootstrapAvailable = !operatorCredentialsConfigured() && !bootstrapUsed && bootstrapSecretConfigured(bootstrapSecret);
  const bootstrapRequired = !admin && !operatorCredentialsConfigured() && isProduction();
  return {
    signupAvailable: true,
    bootstrapRequired,
    bootstrapConfigured: !bootstrapRequired || bootstrapAvailable,
    bootstrapAvailable,
  };
}

async function establishSession(userId: string, user: Pick<AuthUser, "email" | "role">): Promise<Response> {
  const session = await newSessionCookie(userId);
  return Response.json(
    { authenticated: true, user },
    { headers: { "Set-Cookie": session.cookie, "Cache-Control": "no-store" } },
  );
}

export async function loginUser(
  request: Request,
  body: { email?: unknown; password?: unknown },
): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const key = addressKey(request, "login");
  if (!checkRateLimit(key, MAX_LOGIN_ATTEMPTS)) {
    return Response.json({ error: "Too many sign-in attempts. Try again in 15 minutes." }, { status: 429 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string" ||
      body.email.length > 254 || body.password.length > PASSWORD_MAX_LENGTH) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const email = normalizeEmail(body.email);
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !verifyPassword(body.password, user.passwordHash)) {
    return Response.json({ error: "Invalid email or password" }, { status: 401 });
  }
  clearRateLimit(key);
  return establishSession(user.id, { email: user.email, role: user.role });
}

export async function registerUser(
  request: Request,
  body: { email?: unknown; password?: unknown; bootstrapSecret?: unknown },
): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const key = addressKey(request, "signup");
  if (!checkRateLimit(key, MAX_SIGNUP_ATTEMPTS)) {
    return Response.json({ error: "Too many sign-up attempts. Try again in 15 minutes." }, { status: 429 });
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }
  const email = normalizeEmail(body.email);
  if (!isValidEmail(email)) return Response.json({ error: "Enter a valid email address" }, { status: 400 });
  if (!isValidPassword(body.password)) {
    return Response.json({ error: `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters` }, { status: 400 });
  }
  if (body.bootstrapSecret !== undefined && typeof body.bootstrapSecret !== "string") {
    return Response.json({ error: "Invalid bootstrap secret" }, { status: 400 });
  }
  if (typeof body.bootstrapSecret === "string" && body.bootstrapSecret.length > 512) {
    return Response.json({ error: "Invalid bootstrap secret" }, { status: 400 });
  }

  const passwordHash = hashPassword(body.password);
  let created: AuthUser;
  try {
    [created] = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(${BOOTSTRAP_LOCK_ID})`);
      const [admin] = await tx.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
      const [bootstrapUsed] = await tx
        .select({ key: systemState.key })
        .from(systemState)
        .where(eq(systemState.key, "auth_admin_bootstrap_consumed"))
        .limit(1);
      const expected = process.env.AUTH_BOOTSTRAP_ADMIN_SECRET;
      const bootstrapAvailable = !operatorCredentialsConfigured() && !bootstrapUsed && bootstrapSecretConfigured(expected);
      const submittedBootstrapSecret = typeof body.bootstrapSecret === "string" ? body.bootstrapSecret : "";
      const bootstrapRequested = submittedBootstrapSecret.length > 0;
      if (bootstrapRequested && (!bootstrapAvailable || !secureEqual(submittedBootstrapSecret, expected ?? ""))) {
        throw new AuthFailure(403, "The administrator setup code is invalid or has already been used.", "admin_bootstrap_invalid");
      }
      let role = "user";
      if (!admin && !operatorCredentialsConfigured()) {
        if (isProduction()) {
          if (!bootstrapSecretConfigured(expected)) {
            throw new AuthFailure(503, "Configure AUTH_BOOTSTRAP_ADMIN_SECRET before creating the first production account.", "admin_bootstrap_not_configured");
          }
          if (!bootstrapRequested) {
            throw new AuthFailure(403, "The first production account requires the administrator setup code.", "admin_bootstrap_required");
          }
        }
        role = "admin";
      }
      if (bootstrapRequested) role = "admin";
      const [user] = await tx.insert(users).values({ email, passwordHash, role }).returning({
        id: users.id,
        email: users.email,
        role: users.role,
      });
      if (bootstrapRequested) {
        await tx.insert(systemState).values({
          key: "auth_admin_bootstrap_consumed",
          value: "true",
        }).onConflictDoNothing({ target: systemState.key });
      }
      return [user];
    });
  } catch (error) {
    if (error instanceof AuthFailure) {
      return Response.json({ error: error.message, code: error.code }, { status: error.status });
    }
    if (isUniqueConstraintViolation(error)) {
      return Response.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    throw error;
  }
  clearRateLimit(key);
  return establishSession(created.id, { email: created.email, role: created.role });
}

export async function logoutUser(request: Request): Promise<Response> {
  if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  const token = readCookie(request, COOKIE_NAME);
  if (token && token.length <= 128) {
    const sessionId = createHash("sha256").update(token).digest("hex");
    await db.delete(userSessions).where(eq(userSessions.id, sessionId));
  }
  const secure = isProduction() ? " Secure;" : "";
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`, "Cache-Control": "no-store" } },
  );
}

export async function authorizeUser(request: Request, mutation = false): Promise<Response | null> {
  if (mutation && !isSameOriginRequest(request)) {
    return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
  }
  if (!(await getSessionUser(request))) {
    return Response.json({ error: "Sign-in required" }, { status: 401 });
  }
  return null;
}
