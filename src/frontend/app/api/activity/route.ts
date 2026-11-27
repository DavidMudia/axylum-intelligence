export const dynamic = "force-dynamic";

export async function GET() {
  const { GET: getActivity } = await import("@backend/api/activity");
  return getActivity();
}
