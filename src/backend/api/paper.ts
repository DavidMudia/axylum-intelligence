import { and, desc, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { engineHealth, paperAccounts } from "@backend/db/schema";
import { audit, setValue } from "@backend/lib/server/state";
import { getPaperPortfolio, getRecentDecisions, getRiskConfig } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";
const states = new Set(["stopped", "running", "paused"]);

export async function GET(ownerUserId: string) {
  const [state, portfolio, decisions, health] = await Promise.all([
    db.select({ sessionStatus: paperAccounts.sessionStatus }).from(paperAccounts)
      .where(eq(paperAccounts.ownerUserId, ownerUserId)).limit(1),
    getPaperPortfolio(ownerUserId),
    getRecentDecisions(ownerUserId, 50),
    db.select().from(engineHealth).where(eq(engineHealth.engine, "paper-trading")).orderBy(desc(engineHealth.updatedAt)).limit(1),
  ]);
  return Response.json({ state: state[0]?.sessionStatus ?? "stopped", portfolio, decisions, engine: health[0] ?? null });
}

export async function POST(request: Request, ownerUserId: string) {
  let body: { action?: string };
  try {
    body = await request.json() as { action?: string };
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const [account] = await db.select().from(paperAccounts)
    .where(eq(paperAccounts.ownerUserId, ownerUserId)).limit(1);
  if (!account) return Response.json({ error: "Paper account is missing" }, { status: 404 });
  const current = account.sessionStatus;
  if (body.action === "emergency_halt") {
    await db.update(paperAccounts).set({ halted: true, updatedAt: new Date() }).where(and(
      eq(paperAccounts.id, account.id),
      eq(paperAccounts.ownerUserId, ownerUserId),
    ));
    await audit(ownerUserId, "paper_trading.emergency_halt", "Emergency halt enabled; new entries are blocked and protective exits remain allowed.", "critical");
    return Response.json({ halted: true });
  }
  if (body.action === "clear_halt") {
    if (current !== "stopped") return Response.json({ error: "Stop paper trading before clearing an emergency halt" }, { status: 409 });
    const risk = await getRiskConfig(ownerUserId);
    const portfolio = await getPaperPortfolio(ownerUserId);
    const dailyLoss = Number(account.dayStartEquity) > 0
      ? (Number(account.dayStartEquity) - portfolio.summary.equity) / Number(account.dayStartEquity) * 100
      : 100;
    const drawdown = Number(account.peakEquity) > 0
      ? (Number(account.peakEquity) - portfolio.summary.equity) / Number(account.peakEquity) * 100
      : 100;
    if (dailyLoss >= risk.maxDailyLossPct || drawdown >= risk.maxDrawdownPct) {
      return Response.json({ error: "Risk limits are still breached; halt cannot be cleared yet." }, { status: 409 });
    }
    await db.update(paperAccounts).set({ halted: false, updatedAt: new Date() }).where(and(
      eq(paperAccounts.id, account.id),
      eq(paperAccounts.ownerUserId, ownerUserId),
    ));
    await audit(ownerUserId, "paper_trading.halt_cleared", "Emergency halt cleared after risk-limit revalidation.");
    return Response.json({ halted: false });
  }
  const transitions: Record<string, string> = {
    start: "running",
    resume: "running",
    pause: "paused",
    stop: "stopped",
  };
  const next = body.action ? transitions[body.action] : undefined;
  if (!next || !states.has(next)) return Response.json({ error: "Action must be start, pause, resume, stop, emergency_halt or clear_halt" }, { status: 400 });
  if (body.action === "pause" && current !== "running") {
    return Response.json({ error: `Cannot pause while paper trading is ${current}` }, { status: 409 });
  }
  if (body.action === "resume" && current !== "paused") {
    return Response.json({ error: `Cannot resume while paper trading is ${current}` }, { status: 409 });
  }
  await db.update(paperAccounts).set({ sessionStatus: next, updatedAt: new Date() }).where(and(
    eq(paperAccounts.id, account.id),
    eq(paperAccounts.ownerUserId, ownerUserId),
  ));
  if (next === "running") await setValue("paper_trading_state", "running");
  await audit(ownerUserId, `paper_trading.${body.action}`, `Paper trading session changed from ${current} to ${next}.`);
  return Response.json({ state: next, message: "Your paper session state is saved; the shared worker will apply it on its next cycle." });
}
