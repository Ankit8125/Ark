import { randomBytes } from "node:crypto";
import { createPool, migrate } from "@ark/db";

export async function databaseFixture() {
  const connection = process.env.TEST_DATABASE_URL;
  if (!connection)
    throw new Error("Run pnpm db:test:prepare. TEST_DATABASE_URL is required.");
  let url: URL;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("TEST_DATABASE_URL is invalid; its value is withheld.");
  }
  if (
    url.pathname !== "/ark_test" ||
    !["127.0.0.1", "localhost"].includes(url.hostname)
  ) {
    throw new Error("Tests require the separate local ark_test database.");
  }
  const schema = `ark_test_${randomBytes(10).toString("hex")}`;
  const admin = createPool(connection);
  await admin.query(`CREATE SCHEMA "${schema}"`);
  url.searchParams.set("options", `-csearch_path=${schema}`);
  const pool = createPool(url.toString());
  try {
    await migrate(pool);
  } catch (error) {
    await pool.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
    throw error;
  }
  return {
    pool,
    admin,
    schema,
    connection: url.toString(),
    async close() {
      await pool.end();
      // Both the database name and generated schema prefix are checked before cleanup.
      if (!/^ark_test_[a-f0-9]{20}$/.test(schema))
        throw new Error("Unsafe test cleanup target.");
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}
