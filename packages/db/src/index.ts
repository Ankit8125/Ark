import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import type { Pool, PoolClient } from "pg";

export const expectedMigrationVersion = "003_agents";
const migrations = ["001_identity", "002_workspaces", expectedMigrationVersion];

export function createPool(connectionString: string): Pool {
  return new pg.Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
  });
}

export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  let discardClient = false;
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original failure; an uncertain connection must not be reused.
      discardClient = true;
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}

export async function migrate(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    // Serialize migration writers, including the first creation of the ledger.
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext(current_database()), hashtext(current_schema() || ':ark:migrations'))",
    );
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = await client.query<{ version: string; checksum: string }>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    );
    if (applied.rows.some((row) => !migrations.includes(row.version)))
      throw new Error(
        "Database has unknown migrations. Use matching application code.",
      );
    for (const version of migrations) {
      const sql = await readFile(
        new URL(`../migrations/${version}.sql`, import.meta.url),
        "utf8",
      );
      const checksum = createHash("sha256")
        .update(sql.replaceAll("\r\n", "\n"))
        .digest("hex");
      const existing = applied.rows.find((row) => row.version === version);
      if (existing) {
        if (existing.checksum !== checksum)
          throw new Error(
            `Migration checksum mismatch: ${version}. Add a new migration instead of editing an applied one.`,
          );
        continue;
      }
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [version, checksum],
      );
    }
  });
}
