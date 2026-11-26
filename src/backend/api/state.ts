import { audit, getOperatingState, setValue } from "@backend/lib/server/state";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await getOperatingState());
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { action?: string; value?: unknown };

  if (body.action === "killSwitch") {
    const value = body.value === true;
    await setValue("kill_switch", String(value));
    await audit(
      "operator",
      value ? "trading.emergency_shutdown" : "trading.shutdown_released",
      value
        ? "Emergency shutdown engaged: new order submission halted. Existing positions remain manageable."
        : "Emergency shutdown released by operator.",
      value ? "critical" : "warn",
    );
    return Response.json(await getOperatingState());
  }

  if (body.action === "mode") {
    if (body.value === "live") {
      await audit("operator", "mode.live_denied", "Attempt to enable live trading denied: no exchange trading credentials configured.", "warn");
      return Response.json(
        { error: "Live trading is unavailable. No exchange trading credentials are configured, and execution is restricted to paper mode.", ...(await getOperatingState()) },
        { status: 403 },
      );
    }
    await setValue("mode", "paper");
    await audit("operator", "mode.paper", "Operating mode set to paper trading.");
    return Response.json(await getOperatingState());
  }

  return Response.json({ error: "Unknown action" }, { status: 400 });
}
