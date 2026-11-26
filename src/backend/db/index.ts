import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl } from "./config";

const databaseUrl = getDatabaseUrl();

const globalForDb = globalThis as typeof globalThis & {
  __axylumPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__axylumPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__axylumPostgresqlPool = pool;
}

pool.on("error", (error) => {
  console.error(`[database] idle PostgreSQL client error: ${error.message}`);
});

export const db = drizzle(pool);
