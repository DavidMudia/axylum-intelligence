import { isDatabaseConfigurationError, isMissingDatabaseRelationError } from "@backend/db/config";

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
    if (isMissingDatabaseRelationError(error)) {
      return Response.json(
        {
          error: "A required database table is missing. Apply the database migrations for this deployment, then retry.",
          code: "database_migration_required",
        },
        { status: 503 },
      );
    }
    throw error;
  }
}
