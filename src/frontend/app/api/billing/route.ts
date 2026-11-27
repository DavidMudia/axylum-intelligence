import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@backend/db";
import {
  complimentarySlots,
  payments,
  subscriptionPlans,
  subscriptions,
  users,
} from "@backend/db/schema";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { resolveEntitlement } from "@backend/lib/server/entitlements";
import {
  decryptPaystackEmailToken,
  initializePaystackTransaction,
  setPaystackSubscriptionEnabled,
} from "@backend/lib/server/paystack";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const [entitlement, plans, [subscription], recentPayments, [account]] = await Promise.all([
      resolveEntitlement(user.id),
      db.select({
        id: subscriptionPlans.id,
        name: subscriptionPlans.name,
        description: subscriptionPlans.description,
        currency: subscriptionPlans.currency,
        amountMinor: subscriptionPlans.amountMinor,
        trialDays: subscriptionPlans.trialDays,
        features: subscriptionPlans.features,
      }).from(subscriptionPlans).where(eq(subscriptionPlans.enabled, true)),
      db.select({
        id: subscriptions.id,
        planId: subscriptions.planId,
        status: subscriptions.status,
        source: subscriptions.source,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        graceEndsAt: subscriptions.graceEndsAt,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        pendingPlanId: subscriptions.pendingPlanId,
        pendingPlanEffectiveAt: subscriptions.pendingPlanEffectiveAt,
        canManageRenewal: sql<boolean>`(${subscriptions.providerEmailTokenCiphertext} is not null and ${subscriptions.providerEmailTokenNonce} is not null and ${subscriptions.providerEmailTokenTag} is not null)`,
      }).from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1),
      db.select({
        reference: payments.reference,
        planId: payments.planId,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status,
        paidAt: payments.paidAt,
        receiptUrl: payments.receiptUrl,
        createdAt: payments.createdAt,
      }).from(payments).where(eq(payments.userId, user.id))
        .orderBy(sql`${payments.createdAt} desc`).limit(50),
      db.select({ trialUsedAt: users.trialUsedAt }).from(users).where(eq(users.id, user.id)).limit(1),
    ]);
    const [slot] = await db.select({ slotNumber: complimentarySlots.slotNumber })
      .from(complimentarySlots).where(eq(complimentarySlots.userId, user.id)).limit(1);
    return Response.json({
      entitlement,
      subscription: subscription ?? null,
      plans,
      payments: recentPayments,
      trialAvailable: !account?.trialUsedAt && !slot && subscription?.source === "free" && subscription.status === "active",
    }, { headers: { "Cache-Control": "no-store" } });
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

    if (body.action === "trial") {
      const planId = body.planId;
      if (planId !== "starter" && planId !== "professional") {
        return Response.json({ error: "Choose Starter or Professional for the trial" }, { status: 400 });
      }
      const result = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${user.id}))`);
        const [account] = await tx.select({ trialUsedAt: users.trialUsedAt }).from(users)
          .where(eq(users.id, user.id)).for("update").limit(1);
        const [slot] = await tx.select({ slotNumber: complimentarySlots.slotNumber })
          .from(complimentarySlots).where(eq(complimentarySlots.userId, user.id)).limit(1);
        const [subscription] = await tx.select().from(subscriptions)
          .where(eq(subscriptions.userId, user.id)).for("update").limit(1);
        const [plan] = await tx.select({
          id: subscriptionPlans.id,
          trialDays: subscriptionPlans.trialDays,
        }).from(subscriptionPlans).where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.enabled, true))).limit(1);
        if (!account || !subscription || !plan) return { error: "Subscription account is not ready", status: 409 } as const;
        if (slot) return { error: "Complimentary accounts already have permanent Professional access", status: 409 } as const;
        if (account.trialUsedAt) return { error: "This account has already used its trial", status: 409 } as const;
        if (subscription.source !== "free" || subscription.status !== "active") {
          return { error: "A trial is available only to Free accounts", status: 409 } as const;
        }
        if (plan.trialDays <= 0) return { error: "Trial is not configured for this plan", status: 409 } as const;
        const now = new Date();
        const trialEndsAt = new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
        await tx.update(users).set({ trialUsedAt: now, updatedAt: now }).where(eq(users.id, user.id));
        await tx.update(subscriptions).set({
          planId,
          source: "trial",
          status: "trialing",
          currentPeriodStart: now,
          currentPeriodEnd: null,
          trialEndsAt,
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          updatedAt: now,
        }).where(eq(subscriptions.id, subscription.id));
        return { trialEndsAt } as const;
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: result.status });
      return Response.json({ trial: result }, { headers: { "Cache-Control": "no-store" } });
    }

    if (body.action === "cancel" || body.action === "resume") {
      const [subscription] = await db.select({
        id: subscriptions.id,
        status: subscriptions.status,
        source: subscriptions.source,
        providerSubscriptionCode: subscriptions.providerSubscriptionCode,
        providerEmailTokenCiphertext: subscriptions.providerEmailTokenCiphertext,
        providerEmailTokenNonce: subscriptions.providerEmailTokenNonce,
        providerEmailTokenTag: subscriptions.providerEmailTokenTag,
      }).from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
      if (!subscription || subscription.source !== "paystack" || !subscription.providerSubscriptionCode ||
          !subscription.providerEmailTokenCiphertext || !subscription.providerEmailTokenNonce || !subscription.providerEmailTokenTag) {
        return Response.json({ error: "Paystack renewal management is unavailable for this subscription" }, { status: 409 });
      }
      if (body.action === "cancel" && subscription.status !== "active") {
        return Response.json({ error: "Only an active subscription can be canceled" }, { status: 409 });
      }
      if (body.action === "resume" && subscription.status !== "active") {
        return Response.json({ error: "Only an active subscription can resume renewal" }, { status: 409 });
      }
      let emailToken: string;
      try {
        emailToken = decryptPaystackEmailToken({
          ciphertext: subscription.providerEmailTokenCiphertext,
          nonce: subscription.providerEmailTokenNonce,
          tag: subscription.providerEmailTokenTag,
          version: 1,
        }, user.id);
        await setPaystackSubscriptionEnabled({
          subscriptionCode: subscription.providerSubscriptionCode,
          emailToken,
          enabled: body.action === "resume",
        });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Paystack renewal update failed",
        }, { status: 502 });
      }
      await db.update(subscriptions).set({
        cancelAtPeriodEnd: body.action === "cancel",
        canceledAt: body.action === "cancel" ? new Date() : null,
        updatedAt: new Date(),
      }).where(eq(subscriptions.id, subscription.id));
      return Response.json({ renewalEnabled: body.action === "resume" });
    }

    if (body.action === "checkout") {
      const planId = body.planId;
      if (planId !== "starter" && planId !== "professional") {
        return Response.json({ error: "Choose Starter or Professional" }, { status: 400 });
      }
      const entitlement = await resolveEntitlement(user.id);
      if (entitlement.isComplimentary) {
        return Response.json({ error: "Complimentary Professional access does not require payment" }, { status: 409 });
      }
      const [plan] = await db.select({
        id: subscriptionPlans.id,
        amountMinor: subscriptionPlans.amountMinor,
      }).from(subscriptionPlans).where(and(eq(subscriptionPlans.id, planId), eq(subscriptionPlans.enabled, true))).limit(1);
      const [account] = await db.select({ email: users.email }).from(users).where(eq(users.id, user.id)).limit(1);
      if (!plan || !account) return Response.json({ error: "Selected plan is unavailable" }, { status: 404 });
      const [currentSubscription] = await db.select({
        source: subscriptions.source,
        status: subscriptions.status,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
      }).from(subscriptions).where(eq(subscriptions.userId, user.id)).limit(1);
      const now = new Date();
      const currentAccessEndsAt = currentSubscription?.status === "trialing"
        ? currentSubscription.trialEndsAt : currentSubscription?.currentPeriodEnd;
      const activeRecurring = currentSubscription?.source === "paystack" &&
        (currentSubscription.status === "active" || currentSubscription.status === "past_due") &&
        (!currentAccessEndsAt || currentAccessEndsAt > now);
      const cancellationInProgress = currentSubscription?.source === "paystack" &&
        currentSubscription.status === "canceled" && Boolean(currentAccessEndsAt && currentAccessEndsAt > now);
      if (activeRecurring || cancellationInProgress) {
        return Response.json({
          error: "A Paystack subscription is already active. Cancel renewal and wait until the current period ends before starting another plan to avoid duplicate charges.",
        }, { status: 409 });
      }

      const baseUrl = process.env.APP_BASE_URL;
      if (!baseUrl) return Response.json({ error: "APP_BASE_URL is not configured" }, { status: 503 });
      let callbackUrl: URL;
      try {
        const origin = new URL(baseUrl);
        if (origin.protocol !== "https:" && origin.hostname !== "localhost" && origin.hostname !== "127.0.0.1") {
          return Response.json({ error: "APP_BASE_URL must use HTTPS" }, { status: 503 });
        }
        callbackUrl = new URL("/billing", origin);
      } catch {
        return Response.json({ error: "APP_BASE_URL is invalid" }, { status: 503 });
      }

      const reference = `ax_${randomUUID().replace(/-/g, "")}`;
      let initialized: Awaited<ReturnType<typeof initializePaystackTransaction>>;
      try {
        initialized = await initializePaystackTransaction({
          email: account.email,
          planId,
          amountMinor: plan.amountMinor,
          reference,
          callbackUrl: callbackUrl.toString(),
          userId: user.id,
        });
      } catch (error) {
        return Response.json({
          error: error instanceof Error ? error.message : "Unable to initialize Paystack checkout",
        }, { status: 503 });
      }
      const recorded = await db.transaction(async (tx) => {
        const [lockedUser] = await tx.select({ id: users.id }).from(users)
          .where(eq(users.id, user.id)).for("update").limit(1);
        if (!lockedUser) return "Account not found";
        const [slot] = await tx.select({ slotNumber: complimentarySlots.slotNumber })
          .from(complimentarySlots).where(eq(complimentarySlots.userId, user.id)).limit(1);
        if (slot) return "Complimentary accounts do not need checkout";
        const [pendingPayment] = await tx.select({ id: payments.id }).from(payments)
          .where(and(eq(payments.userId, user.id), eq(payments.status, "pending"))).limit(1);
        if (pendingPayment) return "Another payment is still pending for this account";
        const [activeSubscription] = await tx.select({
          source: subscriptions.source,
          status: subscriptions.status,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
        }).from(subscriptions).where(eq(subscriptions.userId, user.id)).for("update").limit(1);
        if (activeSubscription?.source === "paystack" &&
            ((activeSubscription.status === "active" || activeSubscription.status === "past_due") &&
              (!activeSubscription.currentPeriodEnd || activeSubscription.currentPeriodEnd > new Date()) ||
              activeSubscription.status === "canceled" &&
              Boolean(activeSubscription.currentPeriodEnd && activeSubscription.currentPeriodEnd > new Date()))) {
          return "An active Paystack subscription already exists";
        }
        await tx.insert(payments).values({
          userId: user.id,
          planId,
          reference: initialized.reference,
          amountMinor: plan.amountMinor,
          currency: "NGN",
          status: "pending",
        });
        return null;
      });
      if (recorded) return Response.json({ error: recorded }, { status: 409 });
      return Response.json({
        authorizationUrl: initialized.authorizationUrl,
        reference: initialized.reference,
      }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json({ error: "Action must be trial, checkout, cancel or resume" }, { status: 400 });
  });
}
