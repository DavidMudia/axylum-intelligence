import { and, eq, sql } from "drizzle-orm";
import type { PaystackTransaction } from "./paystack";
import { db } from "@backend/db";
import { payments, revenueLedger, subscriptionPlans, subscriptions, users } from "@backend/db/schema";
import { addBillingMonth } from "./subscription-lifecycle";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function activateVerifiedPayment(
  tx: DatabaseTransaction,
  input: { userId: string; reference: string; transaction: PaystackTransaction },
): Promise<{ alreadyProcessed: boolean; subscriptionId: string }> {
  const { transaction, reference, userId } = input;
  const [payment] = await tx.select().from(payments)
    .where(and(eq(payments.userId, userId), eq(payments.reference, reference))).for("update").limit(1);
  if (!payment) throw new Error("Payment reference was not initialized for this account.");
  if (payment.status === "success") {
    const [existing] = await tx.select({ id: subscriptions.id }).from(subscriptions)
      .where(eq(subscriptions.userId, userId)).limit(1);
    if (!existing) throw new Error("Payment is complete but the subscription record is missing.");
    return { alreadyProcessed: true, subscriptionId: existing.id };
  }
  if (transaction.status !== "success" ||
      transaction.reference !== reference ||
      transaction.amount !== payment.amountMinor ||
      transaction.currency !== payment.currency) {
    throw new Error("Verified Paystack payment does not match the initialized payment.");
  }

  const [user] = await tx.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user || transaction.customer?.email?.toLowerCase() !== user.email.toLowerCase()) {
    throw new Error("Verified Paystack customer does not match the account.");
  }
  if (transaction.metadata?.userId && transaction.metadata.userId !== userId) {
    throw new Error("Verified Paystack metadata does not match the account.");
  }
  if (transaction.metadata?.planId && transaction.metadata.planId !== payment.planId) {
    throw new Error("Verified Paystack metadata does not match the selected plan.");
  }

  const [plan] = await tx.select({ amountMinor: subscriptionPlans.amountMinor }).from(subscriptionPlans)
    .where(eq(subscriptionPlans.id, payment.planId)).limit(1);
  if (!plan || plan.amountMinor !== payment.amountMinor) throw new Error("Subscription price changed after checkout initialization.");

  const paidAt = transaction.paid_at ? new Date(transaction.paid_at) : new Date();
  if (Number.isNaN(paidAt.getTime())) throw new Error("Paystack payment timestamp is invalid.");
  const [existing] = await tx.select().from(subscriptions).where(eq(subscriptions.userId, userId)).for("update").limit(1);
  const periodStart = existing?.currentPeriodEnd && existing.currentPeriodEnd > paidAt
    ? existing.currentPeriodEnd : paidAt;
  const periodEnd = addBillingMonth(periodStart);
  const receiptBaseUrl = process.env.APP_BASE_URL;
  const receiptUrl = receiptBaseUrl
    ? new URL(`/billing/receipt?reference=${encodeURIComponent(reference)}`, receiptBaseUrl).toString()
    : null;
  const [subscription] = existing
    ? await tx.update(subscriptions).set({
      planId: payment.planId,
      source: "paystack",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      trialEndsAt: null,
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      canceledAt: null,
      providerSubscriptionCode: transaction.subscription?.subscription_code ?? existing.providerSubscriptionCode,
      updatedAt: new Date(),
    }).where(eq(subscriptions.id, existing.id)).returning({ id: subscriptions.id })
    : await tx.insert(subscriptions).values({
      userId,
      planId: payment.planId,
      source: "paystack",
      status: "active",
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      providerSubscriptionCode: transaction.subscription?.subscription_code ?? null,
    }).returning({ id: subscriptions.id });

  await tx.update(payments).set({
    subscriptionId: subscription.id,
    providerTransactionId: String(transaction.id),
    status: "success",
    paidAt,
    receiptUrl,
    updatedAt: new Date(),
  }).where(eq(payments.id, payment.id));
  await tx.insert(revenueLedger).values({
    userId,
    paymentId: payment.id,
    revenueType: "subscription",
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    status: "verified",
    auditDetails: { provider: "paystack", transactionId: transaction.id, reference },
  }).onConflictDoNothing({ target: revenueLedger.paymentId });
  await tx.execute(sql`select pg_notify('axylum_subscription_updated', ${userId})`);
  return { alreadyProcessed: false, subscriptionId: subscription.id };
}
