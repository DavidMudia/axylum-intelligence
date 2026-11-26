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
