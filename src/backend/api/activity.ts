import { getActivity } from "@backend/lib/server/activity";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ events: await getActivity() });
  } catch {
    return Response.json({ events: [] }, { status: 500 });
  }
}
