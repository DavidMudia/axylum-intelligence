import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { complimentaryAccountEvents, complimentarySlots, payments, subscriptionPlans, subscriptions, users } from "@backend/db/schema";
import { authorizeAdministrator, authorizePlatformOwner } from "@backend/lib/server/operator-auth";
import { getSessionUser, isUniqueConstraintViolation, isValidEmail, normalizeEmail } from "@backend/lib/server/user-auth";
import { db } from "@backend/db";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const denied = await authorizeAdministrator(request);
    if (denied) return denied;
    const [slots, events, [usersCount], [paidCount], [mrr], [verifiedRevenue]] = await Promise.all([
      db.select({
        slotNumber: complimentarySlots.slotNumber,
        founderSlot: complimentarySlots.founderSlot,
        userId: complimentarySlots.userId,
        email: users.email,
        assignedAt: complimentarySlots.assignedAt,
      }).from(complimentarySlots).leftJoin(users, eq(complimentarySlots.userId, users.id))
        .orderBy(complimentarySlots.slotNumber),
      db.select().from(complimentaryAccountEvents).orderBy(sql`${complimentaryAccountEvents.createdAt} desc`).limit(100),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(distinct ${subscriptions.userId})::int` })
        .from(subscriptions).leftJoin(complimentarySlots, eq(subscriptions.userId, complimentarySlots.userId))
        .where(and(
          eq(subscriptions.status, "active"),
          eq(subscriptions.source, "paystack"),
          isNull(complimentarySlots.userId),
          or(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.currentPeriodEnd, new Date())),
        )),
      db.select({ total: sql<number>`coalesce(sum(${subscriptionPlans.amountMinor}), 0)::int` })
        .from(subscriptions).innerJoin(subscriptionPlans, eq(subscriptions.planId, subscriptionPlans.id))
        .leftJoin(complimentarySlots, eq(subscriptions.userId, complimentarySlots.userId))
        .where(and(
          eq(subscriptions.status, "active"),
          eq(subscriptions.source, "paystack"),
          isNull(complimentarySlots.userId),
          or(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.currentPeriodEnd, new Date())),
        )),
      db.select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` }).from(payments)
        .leftJoin(complimentarySlots, eq(payments.userId, complimentarySlots.userId))
        .where(and(eq(payments.status, "success"), gt(payments.paidAt, sql`now() - interval '30 days'`), isNull(complimentarySlots.userId))),
    ]);
    return Response.json({
      slots,
      events,
      metrics: {
        totalUsers: usersCount.count,
        payingSubscribers: paidCount.count,
        monthlyRecurringRevenueMinor: mrr.total,
        verifiedRevenue30dMinor: verifiedRevenue.total,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const denied = await authorizePlatformOwner(request, true);
    if (denied) return denied;
    const actor = await getSessionUser(request);
    if (!actor) return Response.json({ error: "Sign-in required" }, { status: 401 });
    if (actor.role !== "owner") return Response.json({ error: "Platform owner access required" }, { status: 403 });
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    if (body.action === "assign") {
      if (typeof body.email !== "string" || body.email.length > 254) {
        return Response.json({ error: "A valid user email is required" }, { status: 400 });
      }
      const email = normalizeEmail(body.email);
      if (!isValidEmail(email)) return Response.json({ error: "A valid user email is required" }, { status: 400 });
      try {
        const assigned = await db.transaction(async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(71824603)`);
          const [target] = await tx.select({ id: users.id, email: users.email }).from(users)
            .where(eq(users.email, email)).for("update").limit(1);
          if (!target) return { error: "User not found", status: 404 } as const;
          const [alreadyAssigned] = await tx.select({ slotNumber: complimentarySlots.slotNumber })
            .from(complimentarySlots).where(eq(complimentarySlots.userId, target.id)).limit(1);
          if (alreadyAssigned) return { error: "This account already has complimentary access", status: 409 } as const;
          const [currentSubscription] = await tx.select({
            id: subscriptions.id,
            source: subscriptions.source,
            status: subscriptions.status,
          }).from(subscriptions).where(eq(subscriptions.userId, target.id)).for("update").limit(1);
          if (currentSubscription?.source === "paystack" &&
              (currentSubscription.status === "active" || currentSubscription.status === "past_due")) {
            return { error: "Cancel the user's active Paystack subscription before assigning complimentary access", status: 409 } as const;
          }
          const [pendingPayment] = await tx.select({ id: payments.id }).from(payments)
            .where(and(eq(payments.userId, target.id), eq(payments.status, "pending"))).limit(1);
          if (pendingPayment) {
            return { error: "Resolve or wait for the user's pending Paystack checkout before assigning complimentary access", status: 409 } as const;
          }
          const [slot] = await tx.select({ slotNumber: complimentarySlots.slotNumber })
            .from(complimentarySlots)
            .where(and(eq(complimentarySlots.founderSlot, false), sql`${complimentarySlots.userId} is null`))
            .orderBy(complimentarySlots.slotNumber).for("update").limit(1);
          if (!slot) return { error: "All four assignable Professional slots are in use", status: 409 } as const;
          await tx.update(complimentarySlots).set({
            userId: target.id,
            assignedAt: new Date(),
            assignedBy: actor.id,
            updatedAt: new Date(),
          }).where(eq(complimentarySlots.slotNumber, slot.slotNumber));
          await tx.insert(complimentaryAccountEvents).values({
            slotNumber: slot.slotNumber,
            targetUserId: target.id,
            targetEmail: target.email,
            actorUserId: actor.id,
            action: "assigned",
          });
          if (currentSubscription?.source === "free" || currentSubscription?.source === "trial") {
            await tx.delete(subscriptions).where(eq(subscriptions.userId, target.id));
          }
          return { slotNumber: slot.slotNumber, email: target.email } as const;
        });
        if ("error" in assigned) return Response.json({ error: assigned.error }, { status: assigned.status });
        return Response.json({ assigned });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          return Response.json({ error: "This account already has complimentary access" }, { status: 409 });
        }
        throw error;
      }
    }

    if (body.action === "revoke") {
      const slotNumber = Number(body.slotNumber);
      if (!Number.isInteger(slotNumber) || slotNumber < 2 || slotNumber > 5) {
        return Response.json({ error: "Only assignable complimentary slots 2 through 5 can be revoked" }, { status: 400 });
      }
      const revoked = await db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(71824603)`);
        const [slot] = await tx.select({
          slotNumber: complimentarySlots.slotNumber,
          userId: complimentarySlots.userId,
        }).from(complimentarySlots).where(eq(complimentarySlots.slotNumber, slotNumber)).for("update").limit(1);
        if (!slot || !slot.userId) return null;
        const [target] = await tx.select({ email: users.email }).from(users).where(eq(users.id, slot.userId)).limit(1);
        if (!target) return null;
        await tx.update(complimentarySlots).set({
          userId: null,
          assignedAt: null,
          assignedBy: null,
          updatedAt: new Date(),
        }).where(eq(complimentarySlots.slotNumber, slotNumber));
        await tx.insert(complimentaryAccountEvents).values({
          slotNumber,
          targetUserId: slot.userId,
          targetEmail: target.email,
          actorUserId: actor.id,
          action: "revoked",
        });
        const [existingSubscription] = await tx.select({ id: subscriptions.id }).from(subscriptions)
          .where(eq(subscriptions.userId, slot.userId)).limit(1);
        if (!existingSubscription) {
          await tx.insert(subscriptions).values({
            userId: slot.userId,
            planId: "free",
            status: "active",
            source: "free",
          });
        }
        return { slotNumber, email: target.email };
      });
      if (!revoked) return Response.json({ error: "Complimentary slot is not assigned" }, { status: 409 });
      return Response.json({ revoked });
    }
    return Response.json({ error: "Action must be assign or revoke" }, { status: 400 });
  });
}
