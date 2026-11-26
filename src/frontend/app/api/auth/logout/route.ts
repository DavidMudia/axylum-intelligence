import { withDatabaseConfiguration } from "@/lib/with-database-configuration";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withDatabaseConfiguration(async () => {
    const { logoutUser } = await import("@backend/lib/server/user-auth");
    const response = await logoutUser(request);
    if (response.ok) {
      const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
      response.headers.append(
        "Set-Cookie",
        `axylum_operator=; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=0`,
      );
    }
    return response;
  });
}
