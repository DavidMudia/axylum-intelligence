import "dotenv/config";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { complimentaryAccountEvents, complimentarySlots, payments, subscriptions, users } from "@backend/db/schema";

async function main(): Promise<void> {
  const email = (process.env.AXYLUM_FOUNDER_EMAIL ?? "").trim().toLowerCase();
  const confirmation = (process.env.AXYLUM_FOUNDER_CONFIRM_EMAIL ?? "").trim().toLowerCase();
  if (!email || email !== confirmation) {
    throw new Error("Set AXYLUM_FOUNDER_EMAIL and AXYLUM_FOUNDER_CONFIRM_EMAIL to the same founder account email.");
  }

  const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL is required.");

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const db = drizzle(pool);
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(71824602)`);
      const [founder] = await tx.select({ id: users.id, email: users.email, role: users.role })
        .from(users).where(eq(users.email, email)).for("update").limit(1);
      if (!founder) throw new Error("The confirmed founder account does not exist; register that account before provisioning.");

      const [existingOwner] = await tx.select({ id: users.id }).from(users)
        .where(eq(users.role, "owner")).limit(1);
      if (existingOwner && existingOwner.id !== founder.id) {
        throw new Error("A different platform owner is already provisioned.");
      }

      const [slot] = await tx.select({
        slotNumber: complimentarySlots.slotNumber,
        userId: complimentarySlots.userId,
      }).from(complimentarySlots).where(eq(complimentarySlots.slotNumber, 1)).for("update").limit(1);
      if (!slot) throw new Error("Founder complimentary slot is missing; apply the subscription migrations first.");
      if (slot.userId && slot.userId !== founder.id) throw new Error("Founder complimentary slot is assigned to another user.");

      const [existingSlot] = await tx.select({ slotNumber: complimentarySlots.slotNumber })
        .from(complimentarySlots).where(eq(complimentarySlots.userId, founder.id)).limit(1);
      if (existingSlot && existingSlot.slotNumber !== 1) {
        throw new Error("Founder account is assigned to a non-founder complimentary slot.");
      }
      if (founder.role === "owner" && slot.userId === founder.id) return;

      const [currentSubscription] = await tx.select({
        source: subscriptions.source,
        status: subscriptions.status,
      }).from(subscriptions).where(eq(subscriptions.userId, founder.id)).for("update").limit(1);
      const [pendingPayment] = await tx.select({ id: payments.id }).from(payments)
        .where(and(eq(payments.userId, founder.id), eq(payments.status, "pending"))).limit(1);
      if (pendingPayment) throw new Error("Resolve or wait for pending Paystack checkout before provisioning the founder account.");
      if (currentSubscription?.source === "paystack" &&
          (currentSubscription.status === "active" || currentSubscription.status === "past_due")) {
        throw new Error("Cancel the founder account's active Paystack subscription before provisioning complimentary access.");
      }
      await tx.update(users).set({ role: "owner", updatedAt: new Date() }).where(eq(users.id, founder.id));
      await tx.update(complimentarySlots).set({
        userId: founder.id,
        assignedAt: new Date(),
        assignedBy: founder.id,
        updatedAt: new Date(),
      }).where(eq(complimentarySlots.slotNumber, 1));
      if (currentSubscription?.source === "free" || currentSubscription?.source === "trial") {
        await tx.delete(subscriptions).where(eq(subscriptions.userId, founder.id));
      }
      await tx.insert(complimentaryAccountEvents).values({
        slotNumber: 1,
        targetUserId: founder.id,
        targetEmail: founder.email,
        actorUserId: founder.id,
        action: "founder_provisioned",
      });
    });
    console.log("Founder account provisioned with permanent Professional complimentary access.");
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
