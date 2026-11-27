import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@backend/db";
import { subscriptions } from "@backend/db/schema";
import { sql } from "drizzle-orm";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || secret.length < 32 || !supplied) return false;
  const expectedHash = createHash("sha256").update(secret).digest();
  const suppliedHash = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expectedHash, suppliedHash);
}

export async function GET(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isAuthorized(request)) return Response.json({ error: "Cron authorization failed" }, { status: 401 });
    const now = new Date();
    const expired = await db.update(subscriptions).set({
      status: "expired",
      updatedAt: now,
    }).where(sql`
      not exists (
        select 1 from complimentary_slots
        where complimentary_slots.user_id = ${subscriptions.userId}
      )
      and (
        (${subscriptions.status} = 'trialing' and ${subscriptions.trialEndsAt} <= ${now})
        or (${subscriptions.status} = 'active' and ${subscriptions.source} = 'paystack' and ${subscriptions.currentPeriodEnd} <= ${now})
        or (${subscriptions.status} = 'past_due' and ${subscriptions.graceEndsAt} <= ${now})
        or (${subscriptions.status} = 'canceled' and ${subscriptions.currentPeriodEnd} <= ${now})
      )
    `).returning({ id: subscriptions.id });
    return Response.json({ expiredSubscriptions: expired.length }, { headers: { "Cache-Control": "no-store" } });
  });
}
