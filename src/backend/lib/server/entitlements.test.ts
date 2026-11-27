import assert from "node:assert/strict";
import test from "node:test";
import { featureDenied, type Entitlement } from "./entitlements";

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

