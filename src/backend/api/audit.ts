import { db } from "@backend/db";
import { auditLog } from "@backend/db/schema";
import { desc } from "drizzle-orm";
import { AUDIT_SEED } from "@backend/lib/ops";

export const dynamic = "force-dynamic";

export async function GET() {
  const existing = await db.select({ id: auditLog.id }).from(auditLog).limit(1);
  if (!existing.length) {
    const now = Date.now();
    await db.insert(auditLog).values(
      AUDIT_SEED.map((a, i) => ({ ...a, createdAt: new Date(now - (AUDIT_SEED.length - i) * 17 * 60_000) })),
    );
  }
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(40);
  return Response.json({ entries: rows });
}
