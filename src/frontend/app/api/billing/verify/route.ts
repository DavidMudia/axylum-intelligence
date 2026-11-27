import { and, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { payments } from "@backend/db/schema";
import { activateVerifiedPayment } from "@backend/lib/server/subscription-billing";
import { verifyPaystackTransaction } from "@backend/lib/server/paystack";
import { getSessionUser, isSameOriginRequest } from "@backend/lib/server/user-auth";
import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    if (!isSameOriginRequest(request)) return Response.json({ error: "Cross-origin request rejected" }, { status: 403 });
    const user = await getSessionUser(request);
    if (!user) return Response.json({ error: "Sign-in required" }, { status: 401 });
    let body: { reference?: unknown };
    try {
      body = await request.json() as { reference?: unknown };
    } catch {
      return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }
    if (typeof body.reference !== "string" || !/^ax_[a-f0-9]{32}$/.test(body.reference)) {
      return Response.json({ error: "Invalid payment reference" }, { status: 400 });
    }
    const [payment] = await db.select({ status: payments.status }).from(payments)
      .where(and(eq(payments.userId, user.id), eq(payments.reference, body.reference))).limit(1);
    if (!payment) return Response.json({ error: "Payment reference not found" }, { status: 404 });
    if (payment.status === "success") {
      return Response.json({ verified: true, alreadyProcessed: true }, { headers: { "Cache-Control": "no-store" } });
    }

    let transaction;
    try {
      transaction = await verifyPaystackTransaction(body.reference);
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Unable to verify payment with Paystack",
      }, { status: 503 });
    }
    if (transaction.status !== "success") {
      if (transaction.status === "failed" || transaction.status === "abandoned") {
        await db.update(payments).set({ status: "failed", updatedAt: new Date() })
          .where(and(eq(payments.userId, user.id), eq(payments.reference, body.reference), eq(payments.status, "pending")));
      }
      return Response.json({ error: "Paystack has not verified a successful payment" }, { status: 402 });
    }

    try {
      const result = await db.transaction((tx) => activateVerifiedPayment(tx, {
        userId: user.id,
        reference: body.reference as string,
        transaction,
      }));
      return Response.json({ verified: true, ...result }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({
        error: error instanceof Error ? error.message : "Verified payment could not be applied",
      }, { status: 409 });
    }
  });
}
