import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { email?: unknown; password?: unknown; bootstrapSecret?: unknown };
  try {
    body = await request.json() as { email?: unknown; password?: unknown; bootstrapSecret?: unknown };
  } catch {
    return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
  }
  return withDatabaseConfiguration(async () => {
    const { registerUser } = await import("@backend/lib/server/user-auth");
    return registerUser(request, body);
  });
}
