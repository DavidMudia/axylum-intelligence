import { Pool, type PoolClient } from "pg";

export async function acquireWorkerLock(
  pool: Pool,
  key: number,
  name: string,
  onConnectionError: (error: Error) => void,
): Promise<() => Promise<void>> {
  const directUrl = process.env.DATABASE_URL_UNPOOLED;
  const lockPool = directUrl ? new Pool({ connectionString: directUrl, max: 1 }) : pool;
  const ownsLockPool = lockPool !== pool;
  let connectionFailed = false;
  const handleConnectionError = (error: Error) => {
    if (connectionFailed) return;
    connectionFailed = true;
    onConnectionError(error);
  };
  if (ownsLockPool) lockPool.on("error", handleConnectionError);
  let client: PoolClient | undefined;
  try {
    const acquiredClient = await lockPool.connect();
    client = acquiredClient;
    acquiredClient.on("error", handleConnectionError);
    const result = await acquiredClient.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [key]);
    if (!result.rows[0]?.acquired) {
      throw new Error(`Another ${name} worker already holds the PostgreSQL advisory lock.`);
    }

    let heartbeatPending = false;
    const heartbeat = setInterval(() => {
      if (heartbeatPending || connectionFailed) return;
      heartbeatPending = true;
      void acquiredClient.query("SELECT 1").catch((error: unknown) => {
        handleConnectionError(error instanceof Error ? error : new Error(String(error)));
      }).finally(() => {
        heartbeatPending = false;
      });
    }, 30_000);
    heartbeat.unref();

    let released = false;
    return async () => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try {
        if (!connectionFailed) {
          await acquiredClient.query("SELECT pg_advisory_unlock($1)", [key]);
        }
      } finally {
        acquiredClient.release(connectionFailed ? new Error("Worker lock connection failed") : undefined);
        if (ownsLockPool) {
          await lockPool.end();
          lockPool.removeListener("error", handleConnectionError);
        }
      }
    };
  } catch (error) {
    client?.release();
    if (ownsLockPool) {
      await lockPool.end();
      lockPool.removeListener("error", handleConnectionError);
    }
    throw error;
  }
}
