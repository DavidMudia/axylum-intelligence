import { db } from "@backend/db";
import { auditLog, systemState } from "@backend/db/schema";
import { eq } from "drizzle-orm";

export type OperatingState = {
  mode: "paper" | "live";
  killSwitch: boolean;
  liveAvailable: boolean;
};

export async function getValue(key: string, fallback: string) {
  const rows = await db.select().from(systemState).where(eq(systemState.key, key)).limit(1);
  return rows[0]?.value ?? fallback;
}

export async function setValue(key: string, value: string) {
  await db
    .insert(systemState)
    .values({ key, value })
    .onConflictDoUpdate({ target: systemState.key, set: { value, updatedAt: new Date() } });
}

export async function getOperatingState(): Promise<OperatingState> {
  const [mode, kill] = await Promise.all([getValue("mode", "paper"), getValue("kill_switch", "false")]);
  return {
    mode: mode === "live" ? "live" : "paper",
    killSwitch: kill === "true",
    // Live execution requires exchange trading credentials, which are not configured.
    liveAvailable: false,
  };
}

export async function audit(actor: string, action: string, detail: string, severity: "info" | "warn" | "critical" = "info") {
  await db.insert(auditLog).values({ actor, action, detail, severity });
}
