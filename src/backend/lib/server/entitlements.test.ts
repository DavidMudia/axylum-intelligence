import assert from "node:assert/strict";
import test from "node:test";
import {
  featureDenied,
  isSubscriptionAccessCurrent,
  paperTradingSessionDenialReason,
  type Entitlement,
} from "./entitlements";

const free: Entitlement = {
  planId: "free",
  planName: "Free",
  status: "active",
  source: "free",
  isComplimentary: false,
  features: { mt5_demo: false, market_intelligence: true },
  periodEndsAt: null,
};

test("entitlement checks allow included features and explicitly deny restricted features", async () => {
  assert.equal(featureDenied(free, "market_intelligence"), null);
  const denied = featureDenied(free, "mt5_demo");
  assert.equal(denied?.status, 402);
  assert.deepEqual(await denied?.json(), {
    error: "This feature requires a higher subscription plan.",
    code: "subscription_upgrade_required",
    requiredFeature: "mt5_demo",
    currentPlan: "free",
  });
});

test("paper sessions require an active user and an available entitlement that includes paper trading", () => {
  const entitled = { ...free, features: { ...free.features, paper_trading: true } };
  assert.equal(paperTradingSessionDenialReason("active", entitled), null);
  assert.equal(paperTradingSessionDenialReason("suspended", entitled), "user_not_active");
  assert.equal(paperTradingSessionDenialReason("active", free), "paper_trading_not_included");
  assert.equal(paperTradingSessionDenialReason("active", {
    ...free,
    status: "unavailable",
    source: "unavailable",
  }), "subscription_unavailable");
});

test("missing billing tables are reported as unavailable instead of granting a plan", async () => {
  const unavailable: Entitlement = {
    planId: "unavailable",
    planName: "Subscription service unavailable",
    status: "unavailable",
    source: "unavailable",
    isComplimentary: false,
    features: {},
    periodEndsAt: null,
  };
  const denied = featureDenied(unavailable, "mt5_demo");
  assert.equal(denied?.status, 503);
  assert.deepEqual(await denied?.json(), {
    error: "Subscription tables are not installed. Apply the pending database migrations before using this feature.",
    code: "subscription_schema_unavailable",
    requiredFeature: "mt5_demo",
  });
});

test("subscription lifecycle access respects fixed trial, period, cancellation and grace dates", () => {
  const now = new Date("2025-03-15T12:00:00.000Z");
  const current = (status: string, values: {
    currentPeriodEnd?: Date | null;
    trialEndsAt?: Date | null;
    graceEndsAt?: Date | null;
  } = {}) => isSubscriptionAccessCurrent({
    status,
    currentPeriodEnd: values.currentPeriodEnd ?? null,
    trialEndsAt: values.trialEndsAt ?? null,
    graceEndsAt: values.graceEndsAt ?? null,
  }, now);

  assert.equal(current("active"), true);
  assert.equal(current("active", { currentPeriodEnd: new Date("2025-03-16T12:00:00.000Z") }), true);
  assert.equal(current("active", { currentPeriodEnd: now }), false);
  assert.equal(current("trialing", { trialEndsAt: new Date("2025-03-16T12:00:00.000Z") }), true);
  assert.equal(current("trialing", { trialEndsAt: now }), false);
  assert.equal(current("canceled", { currentPeriodEnd: new Date("2025-03-16T12:00:00.000Z") }), true);
  assert.equal(current("canceled", { currentPeriodEnd: now }), false);
  assert.equal(current("past_due", { graceEndsAt: new Date("2025-03-16T12:00:00.000Z") }), true);
  assert.equal(current("past_due", { graceEndsAt: now }), false);
  assert.equal(current("expired"), false);
});

