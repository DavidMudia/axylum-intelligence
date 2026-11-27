export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    available: false,
    reason: "A live activity-event producer is not configured.",
    events: [],
  });
}
