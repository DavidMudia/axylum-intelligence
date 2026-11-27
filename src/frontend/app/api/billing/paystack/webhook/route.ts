import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import {
  paymentWebhookEvents,
  payments,
  subscriptionPlans,
  subscriptions,
  users,
} from "@backend/db/schema";
import { activateVerifiedPayment } from "@backend/lib/server/subscription-billing";
import {
  encryptPaystackEmailToken,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from "@backend/lib/server/paystack";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 256 * 1024;
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

async function readBoundedBody(request: Request): Promise<string | null> {
  const reader = request.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function recordString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const rawBody = await readBoundedBody(request);
    if (rawBody === null) return Response.json({ error: "Webhook payload is too large" }, { status: 413 });
    if (!verifyPaystackWebhookSignature(rawBody, request.headers.get("x-paystack-signature"))) {
      return Response.json({ error: "Invalid webhook signature" }, { status: 401 });
    }
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Webhook payload must be valid JSON" }, { status: 400 });
    }
    if (typeof payload.event !== "string" || typeof payload.data !== "object" || payload.data === null || Array.isArray(payload.data)) {
      return Response.json({ error: "Webhook payload shape is invalid" }, { status: 400 });
    }
    const data = payload.data as Record<string, unknown>;
    const payloadHash = createHash("sha256").update(rawBody).digest("hex");

    if (payload.event === "charge.success") {
      const reference = recordString(data.reference);
      if (!reference) return Response.json({ error: "Payment reference is missing" }, { status: 400 });
      let verified;
      try {
        verified = await verifyPaystackTransaction(reference);
      } catch {
        return Response.json({ error: "Unable to verify webhook transaction with Paystack" }, { status: 503 });
      }
      if (verified.status !== "success" || verified.reference !== reference || !Number.isSafeInteger(verified.id)) {
        return Response.json({ error: "Paystack transaction verification failed" }, { status: 422 });
      }
      const eventKey = `transaction:${verified.id}`;
      const result = await db.transaction(async (tx) => {
        const [event] = await tx.insert(paymentWebhookEvents).values({
          eventKey,
          eventType: payload.event as string,
          payloadHash,
        }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
        if (!event) return { duplicate: true as const };

        const [pending] = await tx.select({
          userId: payments.userId,
          planId: payments.planId,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
        }).from(payments).where(eq(payments.reference, reference)).for("update").limit(1);
        let userId = pending?.userId;
        let planId = pending?.planId;
        if (!pending) {
          const subscriptionCode = verified.subscription?.subscription_code
            ?? recordString((data.subscription as Record<string, unknown> | undefined)?.subscription_code);
          if (!subscriptionCode) return { ignored: true as const };
          const [subscription] = await tx.select({
            id: subscriptions.id,
            userId: subscriptions.userId,
            planId: subscriptions.planId,
          }).from(subscriptions).where(eq(subscriptions.providerSubscriptionCode, subscriptionCode)).for("update").limit(1);
          if (!subscription) return { ignored: true as const };
          const [plan] = await tx.select({
            amountMinor: subscriptionPlans.amountMinor,
            currency: subscriptionPlans.currency,
          }).from(subscriptionPlans).where(eq(subscriptionPlans.id, subscription.planId)).limit(1);
          if (!plan || plan.amountMinor !== verified.amount || plan.currency !== verified.currency) {
            return { ignored: true as const };
          }
          userId = subscription.userId;
          planId = subscription.planId;
          await tx.insert(payments).values({
            userId,
            subscriptionId: subscription.id,
            planId,
            reference,
            amountMinor: verified.amount,
            currency: verified.currency,
            status: "pending",
          }).onConflictDoNothing({ target: payments.reference });
        }
        if (!userId || !planId) return { ignored: true as const };
        const result = await activateVerifiedPayment(tx, {
          userId,
          reference,
          transaction: {
            ...verified,
            subscription: verified.subscription ?? {
              subscription_code: recordString((data.subscription as Record<string, unknown> | undefined)?.subscription_code) ?? undefined,
            },
          },
        });
        await tx.update(paymentWebhookEvents).set({ processedAt: new Date() }).where(eq(paymentWebhookEvents.id, event.id));
        return { duplicate: false as const, ...result };
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    if (payload.event === "subscription.create") {
      const subscriptionCode = recordString(data.subscription_code);
      const emailToken = recordString(data.email_token);
      const customer = typeof data.customer === "object" && data.customer !== null
        ? data.customer as Record<string, unknown> : null;
      const email = recordString(customer?.email)?.toLowerCase();
      if (!subscriptionCode || !emailToken || !email) {
        return Response.json({ error: "Subscription creation payload is incomplete" }, { status: 400 });
      }
      const customerCode = recordString(customer?.customer_code);
      const eventKey = `subscription.create:${subscriptionCode}`;
      const result = await db.transaction(async (tx) => {
        const [event] = await tx.insert(paymentWebhookEvents).values({
          eventKey,
          eventType: payload.event as string,
          payloadHash,
        }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
        if (!event) return { duplicate: true as const };
        const [account] = await tx.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (!account) return { ignored: true as const };
        const [subscription] = await tx.select({ id: subscriptions.id, source: subscriptions.source })
          .from(subscriptions).where(eq(subscriptions.userId, account.id)).for("update").limit(1);
        if (!subscription) return { ignored: true as const };
        const [pendingPayment] = await tx.select({ id: payments.id }).from(payments)
          .where(and(eq(payments.userId, account.id), eq(payments.status, "pending"))).limit(1);
        if (subscription.source !== "paystack" && !pendingPayment) return { ignored: true as const };
        const encrypted = encryptPaystackEmailToken(emailToken, account.id);
        await tx.update(subscriptions).set({
          providerSubscriptionCode: subscriptionCode,
          providerCustomerCode: customerCode,
          providerEmailTokenCiphertext: encrypted.ciphertext,
          providerEmailTokenNonce: encrypted.nonce,
          providerEmailTokenTag: encrypted.tag,
          updatedAt: new Date(),
        }).where(eq(subscriptions.id, subscription.id));
        await tx.update(paymentWebhookEvents).set({ processedAt: new Date() }).where(eq(paymentWebhookEvents.id, event.id));
        return { processed: true as const };
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    if (payload.event === "invoice.payment_failed" || payload.event === "subscription.not_renew" || payload.event === "subscription.disable") {
      const subscriptionData = typeof data.subscription === "object" && data.subscription !== null
        ? data.subscription as Record<string, unknown> : data;
      const subscriptionCode = recordString(subscriptionData.subscription_code);
      if (!subscriptionCode) return Response.json({ error: "Subscription code is missing" }, { status: 400 });
      const eventId = recordString(data.id) ?? payloadHash;
      const eventKey = `${payload.event}:${eventId}`;
      const result = await db.transaction(async (tx) => {
        const [event] = await tx.insert(paymentWebhookEvents).values({
          eventKey,
          eventType: payload.event as string,
          payloadHash,
        }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
        if (!event) return { duplicate: true as const };
        const [subscription] = await tx.select({
          id: subscriptions.id,
          userId: subscriptions.userId,
          planId: subscriptions.planId,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        })
          .from(subscriptions).where(eq(subscriptions.providerSubscriptionCode, subscriptionCode)).for("update").limit(1);
        if (!subscription) return { ignored: true as const };
        const now = new Date();
        if (payload.event === "invoice.payment_failed") {
          const [plan] = await tx.select({
            amountMinor: subscriptionPlans.amountMinor,
            currency: subscriptionPlans.currency,
          }).from(subscriptionPlans).where(eq(subscriptionPlans.id, subscription.planId)).limit(1);
          if (!plan) return { ignored: true as const };
          const reference = recordString(data.reference) ?? eventKey;
          const amountMinor = typeof data.amount === "number" && Number.isSafeInteger(data.amount) && data.amount >= 0
            ? data.amount : plan.amountMinor;
          const currency = recordString(data.currency) ?? plan.currency;
          await tx.insert(payments).values({
            userId: subscription.userId,
            subscriptionId: subscription.id,
            planId: subscription.planId,
            reference,
            amountMinor,
            currency,
            status: "failed",
          }).onConflictDoNothing({ target: payments.reference });
          const paymentPeriodAlreadyCovered = Boolean(subscription.currentPeriodEnd && subscription.currentPeriodEnd > now);
          if (!paymentPeriodAlreadyCovered && subscription.status !== "canceled" && subscription.status !== "expired") {
            await tx.update(subscriptions).set({
              status: "past_due",
              graceEndsAt: new Date(now.getTime() + GRACE_PERIOD_MS),
              updatedAt: now,
            }).where(eq(subscriptions.id, subscription.id));
          }
        } else {
          await tx.update(subscriptions).set({
            cancelAtPeriodEnd: true,
            canceledAt: now,
            updatedAt: now,
          }).where(eq(subscriptions.id, subscription.id));
        }
        await tx.update(paymentWebhookEvents).set({ processedAt: now }).where(eq(paymentWebhookEvents.id, event.id));
        return { processed: true as const };
      });
      return Response.json(result, { headers: { "Cache-Control": "no-store" } });
    }

    return Response.json({ received: true, ignored: true });
  });
}
