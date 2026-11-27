import { and, desc, eq, gt, ilike, isNull, or, sql } from "drizzle-orm";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";
import { db } from "@backend/db";
import {
  complimentarySlots,
  paperAccounts,
  payments,
  subscriptionPlans,
  subscriptions,
  userSessions,
  users,
} from "@backend/db/schema";
import { audit } from "@backend/lib/server/state";
import { authorizeAdministrator } from "@backend/lib/server/operator-auth";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { isSameOriginRequest } from "@backend/lib/server/request-origin";
import { getPaystackCheckoutConfiguration } from "@backend/lib/server/paystack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const PAGE_SIZE = 25;

function boundedPage(value: string | null): number {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const denied = await authorizeAdministrator(request);
    if (denied) return denied;
    const url = new URL(request.url);
    const page = boundedPage(url.searchParams.get("page"));
    const search = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
    const status = url.searchParams.get("status");
    const planId = url.searchParams.get("plan");
    const filters = [];
    if (search) filters.push(ilike(users.email, `%${search.replace(/[%_]/g, "\\$&")}%`));
    if (status === "active" || status === "suspended") filters.push(eq(users.status, status));
    if (planId && ["free", "starter", "professional"].includes(planId)) {
      filters.push(eq(subscriptions.planId, planId));
    }
    const where = filters.length ? and(...filters) : undefined;
    const [accounts, [total], plans, subscriptionBreakdown, [userCount], [paidCount], [mrr], [verifiedRevenue], [failedPayments], [suspendedCount], recentPayments] = await Promise.all([
      db.select({
        id: users.id,
        email: users.email,
        role: users.role,
        status: users.status,
        createdAt: users.createdAt,
        planId: subscriptions.planId,
        planName: subscriptionPlans.name,
        subscriptionStatus: subscriptions.status,
        subscriptionSource: subscriptions.source,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        complimentarySlot: complimentarySlots.slotNumber,
      }).from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .leftJoin(complimentarySlots, eq(complimentarySlots.userId, users.id))
        .where(where)
        .orderBy(desc(users.createdAt), users.email)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ count: sql<number>`count(distinct ${users.id})::int` }).from(users)
        .leftJoin(subscriptions, eq(subscriptions.userId, users.id))
        .where(where),
      db.select({
        id: subscriptionPlans.id,
        name: subscriptionPlans.name,
        description: subscriptionPlans.description,
        amountMinor: subscriptionPlans.amountMinor,
        enabled: subscriptionPlans.enabled,
      }).from(subscriptionPlans).orderBy(subscriptionPlans.amountMinor),
      db.select({
        planId: subscriptions.planId,
        status: subscriptions.status,
        source: subscriptions.source,
        count: sql<number>`count(*)::int`,
      }).from(subscriptions).groupBy(subscriptions.planId, subscriptions.status, subscriptions.source),
      db.select({ count: sql<number>`count(*)::int` }).from(users),
      db.select({ count: sql<number>`count(distinct ${subscriptions.userId})::int` })
        .from(subscriptions)
        .leftJoin(complimentarySlots, eq(complimentarySlots.userId, subscriptions.userId))
        .where(and(
          eq(subscriptions.status, "active"),
          eq(subscriptions.source, "paystack"),
          isNull(complimentarySlots.userId),
          or(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.currentPeriodEnd, new Date())),
        )),
      db.select({ total: sql<number>`coalesce(sum(${subscriptionPlans.amountMinor}), 0)::int` })
        .from(subscriptions)
        .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .leftJoin(complimentarySlots, eq(complimentarySlots.userId, subscriptions.userId))
        .where(and(
          eq(subscriptions.status, "active"),
          eq(subscriptions.source, "paystack"),
          isNull(complimentarySlots.userId),
          or(isNull(subscriptions.currentPeriodEnd), gt(subscriptions.currentPeriodEnd, new Date())),
        )),
      db.select({ total: sql<number>`coalesce(sum(${payments.amountMinor}), 0)::int` }).from(payments)
        .where(and(eq(payments.status, "success"), gt(payments.paidAt, sql`now() - interval '30 days'`))),
      db.select({ count: sql<number>`count(*)::int` }).from(payments).where(eq(payments.status, "failed")),
      db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.status, "suspended")),
      db.select({
        id: payments.id,
        userId: payments.userId,
        email: users.email,
        planId: payments.planId,
        reference: payments.reference,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        status: payments.status,
        paidAt: payments.paidAt,
        createdAt: payments.createdAt,
      }).from(payments).innerJoin(users, eq(users.id, payments.userId))
        .orderBy(desc(payments.createdAt)).limit(50),
    ]);
    return Response.json({
      accounts,
      page,
      pageSize: PAGE_SIZE,
      total: total.count,
      plans,
      subscriptionBreakdown,
      payments: recentPayments,
      paystackCheckoutAvailable: getPaystackCheckoutConfiguration().available,
      metrics: {
        totalUsers: userCount.count,
        payingSubscribers: paidCount.count,
        monthlyRecurringRevenueMinor: mrr.total,
        verifiedRevenue30dMinor: verifiedRevenue.total,
        failedPayments: failedPayments.count,
        suspendedUsers: suspendedCount.count,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  });
}

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const denied = await authorizeAdministrator(request, true);
    if (denied) return denied;
    const actor = await getSessionUser(request);
    if (!actor) return Response.json({ error: "A platform account session is required for this action" }, { status: 401 });
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (typeof body.userId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.userId)) {
      return Response.json({ error: "A valid userId is required" }, { status: 400 });
    }
    const userId = body.userId;
    if (body.action === "set_role") {
      if (actor.role !== "owner") return Response.json({ error: "Only the platform owner can change administrator roles" }, { status: 403 });
      if (body.role !== "admin" && body.role !== "user") {
        return Response.json({ error: "Role must be admin or user; platform owner cannot be assigned" }, { status: 400 });
      }
      const role = body.role;
      if (userId === actor.id) return Response.json({ error: "You cannot change your own role" }, { status: 409 });
      const [target] = await db.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return Response.json({ error: "User not found" }, { status: 404 });
      if (target.role === "owner") return Response.json({ error: "The platform owner role cannot be changed here" }, { status: 409 });
      await db.update(users).set({ role, updatedAt: new Date() }).where(eq(users.id, userId));
      await audit(actor.id, role === "admin" ? "user.admin_granted" : "user.admin_revoked", `Administrator role updated for user ${userId}.`);
      return Response.json({ userId, role });
    }

    if (body.action === "set_status") {
      if (body.status !== "active" && body.status !== "suspended") {
        return Response.json({ error: "Status must be active or suspended" }, { status: 400 });
      }
      const status = body.status;
      if (userId === actor.id) return Response.json({ error: "You cannot suspend or reactivate your own account" }, { status: 409 });
      const result = await db.transaction(async (tx) => {
        const [target] = await tx.select({ role: users.role, status: users.status })
          .from(users).where(eq(users.id, userId)).for("update").limit(1);
        if (!target) return { error: "User not found", status: 404 } as const;
        if (target.role === "owner") return { error: "The platform owner account cannot be suspended", httpStatus: 409 } as const;
        if (target.role === "admin" && actor.role !== "owner") {
          return { error: "Only the platform owner can suspend an administrator", httpStatus: 403 } as const;
        }
        await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
        if (status === "suspended") {
          await tx.update(paperAccounts).set({ sessionStatus: "stopped", updatedAt: new Date() })
            .where(eq(paperAccounts.ownerUserId, userId));
          await tx.delete(userSessions).where(eq(userSessions.userId, userId));
        }
        return { updatedStatus: status } as const;
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: result.httpStatus });
      await audit(actor.id, `user.${status}`, `User ${userId} was ${status}.`);
      return Response.json({ userId, status: result.updatedStatus });
    }

    if (body.action === "return_to_free") {
      const result = await db.transaction(async (tx) => {
        const [subscription] = await tx.select().from(subscriptions)
          .where(eq(subscriptions.userId, userId)).for("update").limit(1);
        if (!subscription) return { error: "Subscription not found", httpStatus: 404 } as const;
        if (subscription.source === "paystack") {
          return {
            error: "Paid plan changes require a verified Paystack subscription update; no provider request was made.",
            httpStatus: 409,
          } as const;
        }
        await tx.update(subscriptions).set({
          planId: "free",
          status: "active",
          source: "free",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          trialEndsAt: null,
          graceEndsAt: null,
          cancelAtPeriodEnd: false,
          canceledAt: null,
          pendingPlanId: null,
          pendingPlanEffectiveAt: null,
          updatedAt: new Date(),
        }).where(eq(subscriptions.id, subscription.id));
        return { status: "free" } as const;
      });
      if ("error" in result) return Response.json({ error: result.error }, { status: result.httpStatus });
      await audit(actor.id, "subscription.returned_to_free", `Subscription for user ${userId} returned to Free without creating a payment record.`);
      return Response.json({ userId, planId: "free" });
    }

    if (body.action === "set_plan") {
      return Response.json({
        error: "Administrators cannot grant paid access. Paid upgrades require verified provider payment; complimentary Professional access is allocated only through the owner-only complimentary workflow.",
        code: "paid_access_requires_verified_payment",
      }, { status: 409 });
    }
    return Response.json({ error: "Action must be set_status, set_role, return_to_free or set_plan" }, { status: 400 });
  });
}
