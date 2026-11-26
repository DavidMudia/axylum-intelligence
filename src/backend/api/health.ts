import { statfs } from "node:fs/promises";
import os from "node:os";
import { desc, sql } from "drizzle-orm";
import { db } from "@backend/db";
import { engineHealth } from "@backend/db/schema";
import { authorizeOperator, getOperatorAuthStatus, isOperatorAuthEnabled } from "@backend/lib/server/operator-auth";
import { getIngestionStatus } from "@backend/market-data/store";

export const dynamic = "force-dynamic";

async function getRuntimeMetrics() {
  const memory = process.memoryUsage();
  const cpuStart = process.cpuUsage();
  const startedAt = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 100));
  const elapsedMs = performance.now() - startedAt;
  const cpu = process.cpuUsage(cpuStart);
  const filesystem = await statfs(process.cwd());
  const databaseSizeResult = await db.execute<{ size_bytes: string }>(
    sql`select pg_database_size(current_database())::text as size_bytes`,
  );
  const filesystemBytes = Number(filesystem.blocks) * Number(filesystem.bsize);
  const filesystemAvailableBytes = Number(filesystem.bavail) * Number(filesystem.bsize);
  return {
    process: {
      cpuPercentOfOneCore: Number((((cpu.user + cpu.system) / (elapsedMs * 1000)) * 100).toFixed(2)),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
    },
    host: { totalMemoryBytes: os.totalmem(), freeMemoryBytes: os.freemem() },
    applicationFilesystem: {
      totalBytes: filesystemBytes,
      availableBytes: filesystemAvailableBytes,
      usedPercent: filesystemBytes ? Number((((filesystemBytes - filesystemAvailableBytes) / filesystemBytes) * 100).toFixed(2)) : null,
    },
    database: { sizeBytes: Number(databaseSizeResult.rows[0]?.size_bytes ?? 0) },
  };
}

export async function GET(request: Request) {
  try {
    const operatorAuth = getOperatorAuthStatus();
    if (!operatorAuth.configured) {
      return Response.json({
        database: { state: "unknown" },
        operatorAuth,
        error: "Production authentication is not configured.",
      }, { status: 503 });
    }
    await db.execute(sql`select 1`);
    const operatorResponse = authorizeOperator(request);
    if (isOperatorAuthEnabled() && operatorResponse) {
      return Response.json({ ok: true, database: { state: "healthy" }, checkedAt: new Date().toISOString() }, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    const [collector, engines, metrics] = await Promise.all([
      getIngestionStatus("BTCUSDT"),
      db.select().from(engineHealth).orderBy(desc(engineHealth.updatedAt)),
      getRuntimeMetrics(),
    ]);
    return Response.json({
      database: { state: "healthy" },
      collector,
      engines,
      metrics,
      operatorAuth,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ database: { state: "unavailable", error: message }, collector: null, engines: [] }, { status: 503 });
  }
}
