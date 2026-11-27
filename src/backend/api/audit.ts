import { db } from "@backend/db";
import { auditLog } from "@backend/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(40);
  return Response.json({ entries: rows });
}
