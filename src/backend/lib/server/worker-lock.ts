import { Pool, type PoolClient } from "pg";

export async function acquireWorkerLock(pool: Pool, key: number, name: string): Promise<() => Promise<void>> {
  const directUrl = process.env.DATABASE_URL_UNPOOLED;
  const lockPool = directUrl ? new Pool({ connectionString: directUrl, max: 1 }) : pool;
  const ownsLockPool = lockPool !== pool;
  let client: PoolClient | undefined;
  try {
    client = await lockPool.connect();
    const result = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
    if (!result.rows[0]?.acquired) {
      throw new Error(`Another ${name} worker already holds the PostgreSQL advisory lock.`);
    }
  } catch (error) {
    client?.release();
    if (ownsLockPool) await lockPool.end();
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
      if (ownsLockPool) await lockPool.end();
    }
  };
}
