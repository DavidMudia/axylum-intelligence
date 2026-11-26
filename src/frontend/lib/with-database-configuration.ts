import { isDatabaseConfigurationError } from "@backend/db/config";

export async function withDatabaseConfiguration<T>(handler: () => Promise<T>): Promise<T | Response> {
  try {
    return await handler();
  } catch (error) {
    if (isDatabaseConfigurationError(error)) {
      return Response.json(
        { error: error.message, code: "database_not_configured" },
        { status: 503 },
      );
    }
    throw error;
  }
}
