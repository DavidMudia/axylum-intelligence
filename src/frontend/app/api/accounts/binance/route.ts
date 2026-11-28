import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { exchangeConnections } from "@backend/db/schema";
import {
  assertExchangeCredentialEncryptionConfigured,
  decryptExchangeCredential,
  encryptExchangeCredential,
  ExchangeCredentialConfigurationError,
} from "@backend/lib/server/exchange-credentials";
import { BinanceConnectionError, validateBinanceReadOnlyCredentials } from "@backend/lib/server/binance-connection";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const connections = await db.select({
      id: exchangeConnections.id,
      exchange: exchangeConnections.exchange,
      label: exchangeConnections.label,
      permissions: exchangeConnections.permissions,
      status: exchangeConnections.status,
      createdAt: exchangeConnections.createdAt,
      updatedAt: exchangeConnections.updatedAt,
    }).from(exchangeConnections).where(and(
      eq(exchangeConnections.userId, user.id),
      eq(exchangeConnections.exchange, "binance"),
    ));
    return Response.json({ connections }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (body.action === "recheck") {
      if (typeof body.connectionId !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.connectionId)) {
        return Response.json({ error: "A valid connection ID is required" }, { status: 400 });
      }
      const [connection] = await db.select().from(exchangeConnections).where(and(
        eq(exchangeConnections.id, body.connectionId),
        eq(exchangeConnections.userId, user.id),
        eq(exchangeConnections.exchange, "binance"),
      )).limit(1);
      if (!connection) return Response.json({ error: "Binance connection not found" }, { status: 404 });
      try {
        const apiKey = decryptExchangeCredential({
          ciphertext: connection.apiKeyCiphertext,
          nonce: connection.encryptionNonce,
          tag: connection.encryptionTag,
          version: connection.encryptionVersion,
        }, `exchange:${connection.id}:api-key`);
        const apiSecret = decryptExchangeCredential({
          ciphertext: connection.apiSecretCiphertext,
          nonce: connection.apiSecretNonce,
          tag: connection.apiSecretTag,
          version: connection.encryptionVersion,
        }, `exchange:${connection.id}:api-secret`);
        await validateBinanceReadOnlyCredentials(apiKey, apiSecret);
        await db.update(exchangeConnections).set({ status: "connected", updatedAt: new Date() })
          .where(eq(exchangeConnections.id, connection.id));
        return Response.json({ status: "connected" }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        if (error instanceof BinanceConnectionError) {
          await db.update(exchangeConnections).set({ status: "error", updatedAt: new Date() })
            .where(eq(exchangeConnections.id, connection.id));
          return Response.json({ error: error.message, status: "error" }, { status: error.status });
        }
        throw error;
      }
    }
    if (typeof body.apiKey !== "string" || typeof body.apiSecret !== "string" ||
        typeof body.label !== "string" || body.apiKey.length < 8 || body.apiKey.length > 256 ||
        body.apiSecret.length < 8 || body.apiSecret.length > 256 ||
        /[\u0000-\u0020\u007f]/.test(body.apiKey) || /[\u0000-\u0020\u007f]/.test(body.apiSecret)) {
      return Response.json({ error: "Label, API key and API secret are required" }, { status: 400 });
    }
    const label = body.label.trim();
    if (!label || label.length > 80 || /[\u0000-\u001f]/.test(label)) {
      return Response.json({ error: "Label must contain between 1 and 80 printable characters" }, { status: 400 });
    }

    try {
      assertExchangeCredentialEncryptionConfigured();
    } catch (error) {
      if (error instanceof ExchangeCredentialConfigurationError) {
        return Response.json({
          error: "Encrypted credential storage is not configured correctly.",
          code: "credential_encryption_unavailable",
        }, { status: 503 });
      }
      throw error;
    }

    try {
      await validateBinanceReadOnlyCredentials(body.apiKey, body.apiSecret);
    } catch (error) {
      if (error instanceof BinanceConnectionError) {
        return Response.json({ error: error.message }, { status: error.status });
      }
      throw error;
    }

    const id = randomUUID();
    let encryptedKey;
    let encryptedSecret;
    try {
      encryptedKey = encryptExchangeCredential(body.apiKey, `exchange:${id}:api-key`);
      encryptedSecret = encryptExchangeCredential(body.apiSecret, `exchange:${id}:api-secret`);
    } catch (error) {
      if (error instanceof ExchangeCredentialConfigurationError) {
        return Response.json({
          error: "Encrypted credential storage is not configured correctly.",
          code: "credential_encryption_unavailable",
        }, { status: 503 });
      }
      throw error;
    }
    try {
      const [connection] = await db.insert(exchangeConnections).values({
        id,
        userId: user.id,
        exchange: "binance",
        label,
        apiKeyCiphertext: encryptedKey.ciphertext,
        apiSecretCiphertext: encryptedSecret.ciphertext,
        encryptionNonce: encryptedKey.nonce,
        encryptionTag: encryptedKey.tag,
        apiSecretNonce: encryptedSecret.nonce,
        apiSecretTag: encryptedSecret.tag,
        encryptionVersion: encryptedKey.version,
        permissions: "read_only",
        status: "connected",
      }).returning({
        id: exchangeConnections.id,
        exchange: exchangeConnections.exchange,
        label: exchangeConnections.label,
        permissions: exchangeConnections.permissions,
        status: exchangeConnections.status,
      });
      return Response.json({ connection }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "23505") {
        return Response.json({ error: "A Binance connection with this label already exists" }, { status: 409 });
      }
      const databaseErrorCode = typeof error === "object" && error !== null && "code" in error &&
        typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code)
        ? error.code
        : "unknown";
      console.error("Could not persist encrypted Binance credentials.", { databaseErrorCode });
      return Response.json({
        error: "Binance validated the credentials, but Axylum could not save the encrypted connection.",
        code: "binance_connection_persistence_failed",
      }, { status: 503 });
    }
  });
}
