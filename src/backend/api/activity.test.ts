import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "./activity";

test("activity endpoint reports that no live event producer is configured", async () => {
  const response = await GET();
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.available, false);
  assert.deepEqual(body.events, []);
  assert.match(body.reason, /producer is not configured/i);
});
