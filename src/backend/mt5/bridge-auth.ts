import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@backend/db";
import { mt5Bridges } from "@backend/db/schema";

const CLOCK_SKEW_SECONDS = 300;

export type AuthenticatedMt5Bridge = {
  id: string;
  ownerUserId: string;
};

export function createMt5BridgeToken(): string {
  return randomBytes(32).toString("hex");
}

export function hashMt5BridgeToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function signMt5BridgeBody(token: string, timestamp: string, body: string): string {
  return createHmac("sha256", token).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

export function verifyMt5BridgeSignature(
  token: string,
  timestamp: string,
  signature: string,
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(token) || !/^\d{10}$/.test(timestamp) || !/^[a-f0-9]{64}$/i.test(signature)) {
    return false;
  }
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > CLOCK_SKEW_SECONDS) {
    return false;
  }
  const expected = Buffer.from(signMt5BridgeBody(token, timestamp, body), "hex");
  const supplied = Buffer.from(signature, "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

export async function authenticateMt5BridgeRequest(
  request: Request,
  rawBody: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<AuthenticatedMt5Bridge | null> {
  const authorization = request.headers.get("authorization");
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  const timestamp = request.headers.get("x-axylum-timestamp") ?? "";
  const signature = request.headers.get("x-axylum-signature") ?? "";
  if (!verifyMt5BridgeSignature(token, timestamp, signature, rawBody, nowSeconds)) return null;

  const [bridge] = await db
    .select({ id: mt5Bridges.id, ownerUserId: mt5Bridges.ownerUserId })
    .from(mt5Bridges)
    .where(eq(mt5Bridges.tokenHash, hashMt5BridgeToken(token)))
    .limit(1);
  return bridge && request.headers.get("x-axylum-bridge-id") === bridge.id ? bridge : null;
}
