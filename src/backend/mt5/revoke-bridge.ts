import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { mt5Accounts, mt5Bridges } from "@backend/db/schema";
import { createMt5BridgeToken, hashMt5BridgeToken } from "./bridge-auth";

async function main(): Promise<void> {
  const [id] = process.argv.slice(2);
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Usage: npm run mt5:bridge:revoke -- <bridge-id>");
  }
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const [bridge] = await db.update(mt5Bridges).set({
      tokenHash: hashMt5BridgeToken(createMt5BridgeToken()),
      status: "offline",
      lastError: "Bridge token revoked",
      updatedAt: new Date(),
    }).where(eq(mt5Bridges.id, id)).returning({ id: mt5Bridges.id });
    if (!bridge) throw new Error("Bridge was not found.");
    await db.update(mt5Accounts).set({
      connected: false,
      updatedAt: new Date(),
    }).where(eq(mt5Accounts.bridgeId, id));
    console.log(`Revoked bridge ${bridge.id}.`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
