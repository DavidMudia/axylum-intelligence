import type { Pool, PoolClient } from "pg";

export async function acquireWorkerLock(pool: Pool, key: number, name: string): Promise<() => Promise<void>> {
  const client: PoolClient = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
    if (!result.rows[0]?.acquired) {
      throw new Error(`Another ${name} worker already holds the PostgreSQL advisory lock.`);
    }
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [key]);
    } finally {
      client.release();
    }
  };
}
