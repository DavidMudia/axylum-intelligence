import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { payments, subscriptionPlans } from "@backend/db/schema";
import { getSessionUser } from "@backend/lib/server/user-auth";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    const reference = new URL(request.url).searchParams.get("reference");
    if (!reference || reference.length > 200) return Response.json({ error: "A valid reference is required" }, { status: 400 });
    const [receipt] = await db.select({
      reference: payments.reference,
      amountMinor: payments.amountMinor,
      currency: payments.currency,
      paidAt: payments.paidAt,
      status: payments.status,
      planName: subscriptionPlans.name,
    }).from(payments).innerJoin(subscriptionPlans, eq(payments.planId, subscriptionPlans.id))
      .where(and(eq(payments.userId, user.id), eq(payments.reference, reference), eq(payments.status, "success")))
      .limit(1);
    if (!receipt) return Response.json({ error: "Verified receipt not found" }, { status: 404 });
    return Response.json({ receipt }, { headers: { "Cache-Control": "no-store" } });
  });
}
