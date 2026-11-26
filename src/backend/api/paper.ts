import { desc, eq } from "drizzle-orm";
import { db } from "@backend/db";
import { engineHealth, paperAccounts } from "@backend/db/schema";
import { audit, getValue, setValue } from "@backend/lib/server/state";
import { getPaperPortfolio, getRecentDecisions, getRiskConfig, PAPER_ACCOUNT_ID } from "@backend/intelligence/service";

export const dynamic = "force-dynamic";
const states = new Set(["stopped", "running", "paused"]);

export async function GET() {
  const [state, portfolio, decisions, health] = await Promise.all([
    getValue("paper_trading_state", "stopped"),
    getPaperPortfolio(),
    getRecentDecisions(50),
    db.select().from(engineHealth).where(eq(engineHealth.engine, "paper-trading")).orderBy(desc(engineHealth.updatedAt)).limit(1),
  ]);
  return Response.json({ state, portfolio, decisions, engine: health[0] ?? null });
}

export async function POST(request: Request) {
  let body: { action?: string };
  try {
    body = await request.json() as { action?: string };
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  const current = await getValue("paper_trading_state", "stopped");
  if (body.action === "emergency_halt") {
    await db.update(paperAccounts).set({ halted: true, updatedAt: new Date() }).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID));
    await audit("operator", "paper_trading.emergency_halt", "Emergency halt enabled; new entries are blocked and protective exits remain allowed.", "critical");
    return Response.json({ halted: true });
  }
  if (body.action === "clear_halt") {
    if (current !== "stopped") return Response.json({ error: "Stop paper trading before clearing an emergency halt" }, { status: 409 });
    const [account] = await db.select().from(paperAccounts).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID)).limit(1);
    if (!account) return Response.json({ error: "Paper account is missing" }, { status: 404 });
    const risk = await getRiskConfig();
    const portfolio = await getPaperPortfolio();
    const dailyLoss = Number(account.dayStartEquity) > 0
      ? (Number(account.dayStartEquity) - portfolio.summary.equity) / Number(account.dayStartEquity) * 100
      : 100;
    const drawdown = Number(account.peakEquity) > 0
      ? (Number(account.peakEquity) - portfolio.summary.equity) / Number(account.peakEquity) * 100
      : 100;
    if (dailyLoss >= risk.maxDailyLossPct || drawdown >= risk.maxDrawdownPct) {
      return Response.json({ error: "Risk limits are still breached; halt cannot be cleared yet." }, { status: 409 });
    }
    await db.update(paperAccounts).set({ halted: false, updatedAt: new Date() }).where(eq(paperAccounts.id, PAPER_ACCOUNT_ID));
    await audit("operator", "paper_trading.halt_cleared", "Emergency halt cleared after risk-limit revalidation.");
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
  await setValue("paper_trading_state", next);
  await audit("operator", `paper_trading.${body.action}`, `Paper trading state changed from ${current} to ${next}.`);
  return Response.json({ state: next, message: "State persisted; the separate paper-trading worker will apply it on its next cycle." });
}
