import { eq } from "drizzle-orm";
import { db } from "@backend/db";
import { isMissingDatabaseRelationError } from "@backend/db/config";
import { complimentarySlots, subscriptionPlans, subscriptions } from "@backend/db/schema";

export type Entitlement = {
  planId: string;
  planName: string;
  status: string;
  source: "complimentary" | "subscription" | "free" | "unavailable";
  isComplimentary: boolean;
  features: Record<string, boolean | number>;
  periodEndsAt: Date | null;
};

function isCurrent(subscription: {
  status: string;
  currentPeriodEnd: Date | null;
  trialEndsAt: Date | null;
  graceEndsAt: Date | null;
}, now: Date): boolean {
  if (subscription.status === "trialing") return Boolean(subscription.trialEndsAt && subscription.trialEndsAt > now);
  if (subscription.status === "active") return !subscription.currentPeriodEnd || subscription.currentPeriodEnd > now;
  if (subscription.status === "canceled") return Boolean(subscription.currentPeriodEnd && subscription.currentPeriodEnd > now);
  if (subscription.status === "past_due") return Boolean(subscription.graceEndsAt && subscription.graceEndsAt > now);
  return false;
}

async function loadEntitlement(userId: string, now: Date): Promise<Entitlement> {
  const [complimentary] = await db.select({ slotNumber: complimentarySlots.slotNumber })
    .from(complimentarySlots).where(eq(complimentarySlots.userId, userId)).limit(1);
  if (complimentary) {
    const [professional] = await db.select({
      id: subscriptionPlans.id,
      name: subscriptionPlans.name,
      features: subscriptionPlans.features,
    }).from(subscriptionPlans).where(eq(subscriptionPlans.id, "professional")).limit(1);
    if (!professional) throw new Error("Professional plan is missing; apply the subscription migrations.");
    return {
      planId: professional.id,
      planName: professional.name,
      status: "active",
      source: "complimentary",
      isComplimentary: true,
      features: professional.features,
      periodEndsAt: null,
    };
  }

  const [current] = await db.select({
    planId: subscriptions.planId,
    status: subscriptions.status,
    source: subscriptions.source,
    currentPeriodEnd: subscriptions.currentPeriodEnd,
    trialEndsAt: subscriptions.trialEndsAt,
    graceEndsAt: subscriptions.graceEndsAt,
    planName: subscriptionPlans.name,
    features: subscriptionPlans.features,
  }).from(subscriptions).innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
    .where(eq(subscriptions.userId, userId)).limit(1);

  if (current && isCurrent(current, now)) {
    return {
      planId: current.planId,
      planName: current.planName,
      status: current.status,
      source: current.source === "free" ? "free" : "subscription",
      isComplimentary: false,
      features: current.features,
      periodEndsAt: current.status === "trialing" ? current.trialEndsAt : current.currentPeriodEnd,
    };
  }

  const [free] = await db.select({
    id: subscriptionPlans.id,
    name: subscriptionPlans.name,
    features: subscriptionPlans.features,
  }).from(subscriptionPlans).where(eq(subscriptionPlans.id, "free")).limit(1);
  if (!free) throw new Error("Free plan is missing; apply the subscription migrations.");
  return {
    planId: free.id,
    planName: free.name,
    status: "active",
    source: "free",
    isComplimentary: false,
    features: free.features,
    periodEndsAt: null,
  };
}

export async function resolveEntitlement(userId: string, now = new Date()): Promise<Entitlement> {
  try {
    return await loadEntitlement(userId, now);
  } catch (error) {
    if (!isMissingDatabaseRelationError(error)) throw error;
    return {
      planId: "unavailable",
      planName: "Subscription service unavailable",
      status: "unavailable",
      source: "unavailable",
      isComplimentary: false,
      features: {},
      periodEndsAt: null,
    };
  }
}

export function featureDenied(entitlement: Entitlement, feature: string): Response | null {
  if (entitlement.status === "unavailable") {
    return Response.json({
      error: "Subscription tables are not installed. Apply the pending database migrations before using this feature.",
      code: "subscription_schema_unavailable",
      requiredFeature: feature,
    }, { status: 503 });
  }
  if (entitlement.features[feature] === true) return null;
  return Response.json({
    error: "This feature requires a higher subscription plan.",
    code: "subscription_upgrade_required",
    requiredFeature: feature,
    currentPlan: entitlement.planId,
  }, { status: 402 });
}
