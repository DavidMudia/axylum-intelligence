export class DatabaseConfigurationError extends Error {
  readonly code = "DATABASE_URL_REQUIRED";

  constructor() {
    super("DATABASE_URL is required");
    this.name = "DatabaseConfigurationError";
  }
}

export function isDatabaseConfigurationError(error: unknown): error is DatabaseConfigurationError {
  return (
    error instanceof DatabaseConfigurationError ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "DATABASE_URL_REQUIRED")
  );
}

export function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new DatabaseConfigurationError();
  return databaseUrl;
}
