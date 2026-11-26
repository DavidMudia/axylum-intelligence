import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { mt5Bridges, users } from "@backend/db/schema";

async function main(): Promise<void> {
  const [emailArgument, nameArgument] = process.argv.slice(2);
  const email = emailArgument?.trim().toLowerCase();
  const name = nameArgument?.trim();
  if (!email || !name || name.length > 100) {
    throw new Error("Usage: npm run mt5:bridge:provision -- <admin-email> <bridge-name>");
  }
  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    const [owner] = await db.select({ id: users.id, role: users.role }).from(users)
      .where(and(eq(users.email, email), eq(users.role, "admin"))).limit(1);
    if (!owner) throw new Error("The specified admin account was not found.");

    const id = randomUUID();
    const token = randomBytes(32).toString("hex");
    const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
    await db.insert(mt5Bridges).values({
      id,
      ownerUserId: owner.id,
      name,
      tokenHash,
      status: "offline",
      updatedAt: new Date(),
    });

    console.log("Store this token only in the trusted Windows bridge environment; it cannot be retrieved later.");
    console.log(JSON.stringify({ bridgeId: id, token }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
