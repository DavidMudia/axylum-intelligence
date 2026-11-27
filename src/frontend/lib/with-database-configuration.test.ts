import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseConfigurationError } from "@backend/db/config";
import { withDatabaseConfiguration } from "./with-database-configuration";

test("returns a clear service-unavailable response when database configuration is missing", async () => {
  const response = await withDatabaseConfiguration(async () => {
    throw new DatabaseConfigurationError();
  });

  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "DATABASE_URL is required",
    code: "database_not_configured",
  });
});

test("does not suppress unrelated backend errors", async () => {
  await assert.rejects(
    withDatabaseConfiguration(async () => {
      throw new Error("database connection refused");
    }),
    /database connection refused/,
  );
});

test("reports a missing database relation as an unapplied-migration response", async () => {
  const missingRelation = Object.assign(new Error("query failed"), {
    cause: Object.assign(new Error('relation "subscription_plans" does not exist'), { code: "42P01" }),
  });
  const response = await withDatabaseConfiguration(async () => {
    throw missingRelation;
  });

  assert.ok(response instanceof Response);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: "A required database table is missing. Apply the database migrations for this deployment, then retry.",
    code: "database_migration_required",
  });
});
