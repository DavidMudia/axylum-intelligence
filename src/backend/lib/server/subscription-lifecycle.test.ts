import assert from "node:assert/strict";
import test from "node:test";
import { addBillingMonth, calculateTrialEndDate } from "./subscription-lifecycle";

test("trial end dates use a fixed day duration", () => {
  assert.equal(
    calculateTrialEndDate(new Date("2025-03-15T12:00:00.000Z"), 7).toISOString(),
    "2025-03-22T12:00:00.000Z",
  );
  assert.throws(() => calculateTrialEndDate(new Date("2025-03-15T12:00:00.000Z"), 0), RangeError);
});

test("monthly renewal dates preserve UTC time and clamp to the last calendar day", () => {
  assert.equal(
    addBillingMonth(new Date("2025-01-31T12:34:56.000Z")).toISOString(),
    "2025-02-28T12:34:56.000Z",
  );
  assert.equal(
    addBillingMonth(new Date("2024-01-31T12:34:56.000Z")).toISOString(),
    "2024-02-29T12:34:56.000Z",
  );
});
